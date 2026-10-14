// Swish Schedule — Express + SQL Server backend
// Serves the built Vite SPA and exposes a REST API under /api
import express from 'express';
import { pool, initDatabase, verifySchema } from './db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import webpush from 'web-push';
import admin from 'firebase-admin';
// v14's default export is flattened (admin.cert, not admin.credential.cert),
// and messaging is its own modular entry point rather than admin.messaging().
import { getMessaging } from 'firebase-admin/messaging';
import compression from 'compression';
import QRCode from 'qrcode';
import { WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8080;

// Timezone used when formatting clock times inside notification text.
const TZ = process.env.APP_TIMEZONE || 'Asia/Kuwait';

// Which calendar day a timestamp belongs to, in the timezone the business
// actually works in — not the server's UTC. A punch at 01:00 Kuwait time is
// still that day's shift, and UTC would file it under the previous one.
const dayKeyInAppTz = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: TZ });

// Shared secret for the fingerprint bridge (see /attendance/device-sync).
// Unset means the endpoint stays closed rather than open with no key.
const ATTENDANCE_BRIDGE_KEY = process.env.ATTENDANCE_BRIDGE_KEY || '';

// Two punches further apart than this belong to different shifts. Chosen
// from the real terminal history: consecutive punches cluster tightly at
// 6-12h (a shift) and 12h+ (the gap between shifts), with almost nothing in
// between, so any value from ~12h to ~16h separates them cleanly. 14h sits in
// the middle of that empty band.
const SHIFT_GAP_MS = 14 * 60 * 60 * 1000;

// Derives in/out by grouping punches into shifts rather than calendar days: a
// punch within SHIFT_GAP_MS of the previous one continues the same shift,
// anything further apart starts a new one. Inside a shift the kinds alternate
// IN, OUT, IN, OUT from the first punch. Pairing by calendar day was wrong for
// every overnight shift — the after-midnight clock-out landed on a new day
// and became a clock-IN. Punches within DUPLICATE_PUNCH_MS collapse to one,
// since that is someone pressing twice, not a shift lasting seconds.
//
// The terminal also stores its own in/out label per punch, but that label is
// only what mode the unit was in when the finger touched it — the mode is
// sticky and defaults to Check-In, so an exit made without switching it is
// recorded as a second check-in. Against every shift where the truth is
// certain (exactly two punches, hours apart) the device label was right
// 91.5% of the time and alternation 100%, and the device's errors run in both
// directions (IN,IN and OUT,OUT). So alternation decides whenever a shift has
// two or more punches. Its one blind spot is a shift with a single punch,
// where it can only assume IN; there the device label is the sole signal and
// is still 85% consistent with the person's usual hours, so it breaks that tie.
const DUPLICATE_PUNCH_MS = 3 * 60 * 1000;
function pairIntoShifts(sortedTs, deviceKinds = new Map()) {
  const out = [];
  let shift = [];
  let prev = null;
  const flush = () => {
    if (shift.length === 1 && deviceKinds.get(shift[0]) === 'OUT') {
      out.push({ ts: shift[0], kind: 'OUT' });
    } else {
      shift.forEach((ts, i) => out.push({ ts, kind: i % 2 === 0 ? 'IN' : 'OUT' }));
    }
    shift = [];
  };
  for (const ts of sortedTs) {
    if (prev !== null && ts - prev < DUPLICATE_PUNCH_MS) continue;
    if (prev !== null && ts - prev >= SHIFT_GAP_MS) flush();
    shift.push(ts);
    prev = ts;
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// Lateness: the roster's expectation vs what the terminal recorded
// ---------------------------------------------------------------------------

// Minutes after the scheduled start before an arrival counts as late.
// Chosen by the user after seeing the real distribution: the median arrival
// across 811 matched days is 1.8 minutes EARLY, so the floor is walk-to-the-
// device jitter, not lateness. Flagging anything over 0 would mark 43% of
// days; over 10 marks 18% (~5 a day across the floor), which is reviewable.
const LATE_GRACE_MIN = Number(process.env.LATE_GRACE_MIN || 10);

// How far from the scheduled start a punch may sit and still be read as this
// shift's arrival. Wide enough for a badly-set roster, narrow enough that a
// neighbouring shift's punches cannot be mistaken for this one's.
const ARRIVAL_WINDOW_MS = 6 * 60 * 60 * 1000;

// Leaving this many minutes before the scheduled end is worth a manager's
// attention. Measured over two months: 17 departures fall 10-29 min early
// (ordinary end-of-shift drift, not worth a decision), 29 fall 30-59 min and
// 22 fall 1-3h — those are the ones a team leader currently forgets to record.
const EARLY_LEAVE_MIN = 30;

// Past this, "left early" stops being the only reading: someone who punched
// out for an errand and never punched the real exit looks identical. The
// finding is still shown, but it says so instead of proposing a verdict.
const EARLY_LEAVE_AMBIGUOUS_MIN = 180;

// How long after a shift starts before silence counts as absence rather than
// someone running late. An hour, at the owner's request — the grace period
// governs a punch that did arrive, this governs one that never did.
const ABSENCE_AFTER_MS = 60 * 60 * 1000;

// Beyond this, "late" is the wrong word: someone who arrives 2h late AND
// leaves 2h after the scheduled end worked a different shift than the one on
// the roster. Reported as a roster problem, never as a punctuality one.
const SHIFT_MISMATCH_MS = 60 * 60 * 1000;

// Day types that mean "expected on site, on this device". Gate on the TYPE,
// never on the presence of a shift object: switching a day to DAY_OFF in the
// roster UI leaves the old times behind, so 347 of 511 DAY_OFF rows still
// carry a start time. WORK_FROM_HOME, TRAINING and TASK are working days that
// produce no punch here, so they are excluded rather than reported absent.
const ATTENDANCE_DAY_TYPES = new Set([
  'NORMAL_SHIFT', 'TARDY', 'EARLY_LEAVE', 'DELAY_WAS_PERMISSION', 'CANCEL_OFF',
]);

// Types where a human already recorded a reason for the deviation. The device
// number is shown beside theirs, but nothing is ever suggested over it.
const EXCUSED_DAY_TYPES = new Set(['DELAY_WAS_PERMISSION', 'EARLY_LEAVE']);

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 24 * 60 * 60 * 1000;

// Kuwait is +03:00 year round with no DST, so pinning the offset literally is
// safe and keeps the result independent of the server's own clock zone.
const atKuwait = (dateStr, hhmm) => Date.parse(`${dateStr}T${hhmm}:00+03:00`);
const addDays = (dateStr, n) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};

// Turns one roster row into the real instants it covers.
//
// The subtlety is the night shift. Managers file a 01:00-09:00 rota on the
// date the night BEGINS, so the row dated the 9th means 01:00 on the 10th —
// reading it literally puts the arrival three hours "early" and files it
// against the wrong day. But an early DAY shift (05:00-17:00, common on the
// branch roster) means exactly what it says. The two are told apart by what
// else the person is scheduled for: shifting is only right when the shifted
// window does not collide with another of their own shifts.
function anchorShift(dateStr, shift, otherWindows = []) {
  const start = shift?.startTime;
  const end = shift?.endTime;
  if (!HHMM.test(start || '') || !HHMM.test(end || '')) return null;

  const build = (d) => {
    const s = atKuwait(d, start);
    let e = atKuwait(d, end);
    if (e <= s) e += DAY_MS; // crosses midnight
    return { start: s, end: e };
  };

  const literal = build(dateStr);
  if (Number(start.slice(0, 2)) >= 6) return literal;

  const shifted = build(addDays(dateStr, 1));
  const collides = otherWindows.some((w) => shifted.start < w.end && w.start < shifted.end);
  return collides ? literal : shifted;
}

// Rebuilds attendance_daily for the given people and date range.
//
// Everything is decided from the schedule's own instants, never from the
// calendar day a punch happens to land on: a 23:50 arrival for a 00:30 shift
// belongs to the shift, not to the previous date.
async function recomputeLateness({ userIds, fromDate, toDate }) {
  const ids = [...new Set(userIds || [])].filter(Boolean);
  if (!ids.length || !fromDate || !toDate) return { rows: 0, people: 0 };

  // An employeeId shared by two accounts makes every punch ambiguous: the
  // sync attributes it to whichever row the database returned last. Guessing
  // which human it was would put one person's lateness on another's record,
  // so those accounts are skipped entirely until the duplicate is resolved.
  const { rows: userRows } = await pool.query(
    `SELECT id, data->>'employeeId' AS eid FROM users WHERE id = ANY($1)`, [ids]
  );
  const { rows: dupRows } = await pool.query(
    `SELECT data->>'employeeId' AS eid FROM users
      WHERE coalesce(data->>'employeeId','') <> ''
      GROUP BY data->>'employeeId' HAVING count(*) > 1`
  );
  const ambiguous = new Set(dupRows.map((r) => r.eid));

  // Only people the terminal actually knows. Most of the company is not
  // enrolled on it (the branches clock in by QR), and reporting them absent
  // every day would bury the handful of real findings.
  const { rows: onDeviceRows } = await pool.query(
    `SELECT DISTINCT user_id FROM attendance WHERE user_id = ANY($1) AND id LIKE 'fp-%'`, [ids]
  );
  const onDevice = new Set(onDeviceRows.map((r) => r.user_id));

  const eligible = userRows
    .filter((u) => onDevice.has(u.id) && !ambiguous.has((u.eid || '').trim()))
    .map((u) => u.id);
  if (!eligible.length) return { rows: 0, people: 0 };

  const { rows: schedRows } = await pool.query(
    `SELECT user_id, date, data FROM schedules
      WHERE user_id = ANY($1) AND date >= $2 AND date <= $3`,
    [eligible, fromDate, toDate]
  );

  // Punches are read a day wider than the schedule range on each side so a
  // shift anchored at the edge still finds its own arrival and departure.
  const punchLo = atKuwait(addDays(fromDate, -2), '00:00');
  const punchHi = atKuwait(addDays(toDate, 3), '00:00');
  const { rows: punchRows } = await pool.query(
    `SELECT user_id, kind, ts FROM attendance
      WHERE user_id = ANY($1) AND ts >= $2 AND ts < $3 ORDER BY ts`,
    [eligible, punchLo, punchHi]
  );
  const punchesByUser = new Map();
  for (const p of punchRows) {
    if (!punchesByUser.has(p.user_id)) punchesByUser.set(p.user_id, []);
    punchesByUser.get(p.user_id).push({ ts: Number(p.ts), kind: p.kind });
  }

  const { rows: syncRows } = await pool.query(`SELECT last_sync_at FROM sync_state WHERE id = 'fingerprint'`);
  const lastSyncAt = syncRows.length ? Number(syncRows[0].last_sync_at) : 0;
  const now = Date.now();
  const graceMs = LATE_GRACE_MIN * 60 * 1000;

  const byUser = new Map();
  for (const r of schedRows) {
    if (!ATTENDANCE_DAY_TYPES.has(r.data?.type)) continue;
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id).push(r);
  }

  const out = [];
  for (const [userId, rows] of byUser) {
    // Windows for the unambiguous rows first, so an early-morning row can be
    // tested for collision against them before deciding how to read it.
    const plainWindows = [];
    for (const r of rows) {
      const st = r.data?.shift?.startTime;
      if (HHMM.test(st || '') && Number(st.slice(0, 2)) >= 6) {
        const w = anchorShift(r.date, r.data.shift);
        if (w) plainWindows.push(w);
      }
    }

    const shifts = [];
    for (const r of rows) {
      const w = anchorShift(r.date, r.data?.shift, plainWindows);
      if (w) shifts.push({ date: r.date, type: r.data.type, ...w });
    }
    shifts.sort((a, b) => a.start - b.start);

    const punches = punchesByUser.get(userId) || [];
    const usedArrival = new Set();

    for (const s of shifts) {
      const winLo = s.start - ARRIVAL_WINDOW_MS;
      const winHi = s.start + ARRIVAL_WINDOW_MS;
      const spanLo = winLo;
      const spanHi = s.end + ARRIVAL_WINDOW_MS;
      const inSpan = punches.filter((p) => p.ts >= spanLo && p.ts <= spanHi);

      // The arrival is the first clock-IN inside the window around the
      // scheduled start — deliberately NOT "the first punch of the 14-hour
      // group". Two shifts less than 14 hours apart chain into a single
      // group whose first punch is the PREVIOUS shift's arrival, which threw
      // away 5.9% of real arrivals when it was tried that way.
      let arrival = punches.find((p) => p.kind === 'IN' && p.ts >= winLo && p.ts <= winHi && !usedArrival.has(p.ts));
      let status = null;

      if (!arrival) {
        if (!inSpan.length) {
          // Silence means nothing until enough of the shift has passed that
          // the person is not merely running late, and until the bridge has
          // reported in past the start of it.
          if (now < s.start + ABSENCE_AFTER_MS) status = 'PENDING';
          else if (!lastSyncAt || lastSyncAt < s.start) status = 'NOT_SYNCED';
          else status = 'NO_PUNCH';
        } else {
          // Punches exist but none reads as an arrival — usually a missed
          // clock-in. Shown for review, never asserted as late or absent.
          status = 'ONLY_OUT';
        }
      }

      let offsetMin = null, earlyLeaveMin = null, departure = null;
      if (arrival) {
        usedArrival.add(arrival.ts);
        offsetMin = Math.round((arrival.ts - s.start) / 60000);
        const outs = inSpan.filter((p) => p.kind === 'OUT' && p.ts > arrival.ts);
        departure = outs.length ? outs[outs.length - 1] : null;
        if (departure) {
          const early = Math.round((s.end - departure.ts) / 60000);
          if (early > 0) earlyLeaveMin = early;
        }

        if (EXCUSED_DAY_TYPES.has(s.type)) {
          status = 'EXCUSED';
        } else if (inSpan.length === 1 && now > s.end) {
          // A single punch on a FINISHED shift carries no evidence of which
          // end of the shift it was: alternation assumes IN, and it is just as
          // likely a forgotten clock-in followed by a real clock-out. While
          // the shift is still running, though, one punch is simply someone
          // who arrived and has not left yet, and their arrival time is as
          // trustworthy as anyone's — treating that as unknowable would hide
          // every late arrival on the day a manager most wants to see it.
          status = 'LONE_PUNCH';
        } else if (
          arrival.ts - s.start > SHIFT_MISMATCH_MS &&
          departure && departure.ts - s.end > SHIFT_MISMATCH_MS
        ) {
          // Late by the same amount they stayed late: they worked a shift,
          // just not the one written on the roster.
          status = 'SHIFT_MISMATCH';
        } else if (offsetMin > LATE_GRACE_MIN) {
          status = 'LATE';
        } else if (earlyLeaveMin !== null && earlyLeaveMin >= EARLY_LEAVE_MIN) {
          // Arrived fine but went home before the shift was over. The arrival
          // story takes precedence when both are true — a late arrival is the
          // more serious record — but the departure figure is stored either
          // way, so the screen can offer both decisions on the same row.
          status = 'LEFT_EARLY';
        } else {
          status = 'ON_TIME';
        }
      }

      out.push({
        userId, date: s.date,
        scheduledStart: s.start, scheduledEnd: s.end,
        arrivalTs: arrival ? arrival.ts : null,
        departureTs: departure ? departure.ts : null,
        offsetMin, earlyLeaveMin,
        punchCount: inSpan.length,
        status, dayType: s.type,
      });
    }
  }

  // Rows that no longer describe a working day (the roster changed, or the
  // day was cleared) must not linger as findings.
  await pool.query(
    `DELETE FROM attendance_daily d
      WHERE d.user_id = ANY($1) AND d.date >= $2 AND d.date <= $3
        AND NOT EXISTS (
          SELECT 1 FROM UNNEST($4::text[], $5::text[]) AS k(uid, dt)
           WHERE k.uid = d.user_id AND k.dt = d.date
        )`,
    [eligible, fromDate, toDate, out.map((o) => o.userId), out.map((o) => o.date)]
  );

  if (out.length) {
    await pool.query(
      `INSERT INTO attendance_daily
         (user_id, date, scheduled_start, scheduled_end, arrival_ts, departure_ts,
          offset_min, early_leave_min, punch_count, status, day_type, computed_at)
       SELECT * FROM UNNEST($1::text[], $2::text[], $3::bigint[], $4::bigint[], $5::bigint[],
                            $6::bigint[], $7::int[], $8::int[], $9::int[], $10::text[], $11::text[], $12::bigint[])
       ON CONFLICT (user_id, date) DO UPDATE SET
         scheduled_start = EXCLUDED.scheduled_start,
         scheduled_end   = EXCLUDED.scheduled_end,
         arrival_ts      = EXCLUDED.arrival_ts,
         departure_ts    = EXCLUDED.departure_ts,
         offset_min      = EXCLUDED.offset_min,
         early_leave_min = EXCLUDED.early_leave_min,
         punch_count     = EXCLUDED.punch_count,
         status          = EXCLUDED.status,
         day_type        = EXCLUDED.day_type,
         computed_at     = EXCLUDED.computed_at`,
      [
        out.map((o) => o.userId), out.map((o) => o.date),
        out.map((o) => o.scheduledStart), out.map((o) => o.scheduledEnd),
        out.map((o) => o.arrivalTs), out.map((o) => o.departureTs),
        out.map((o) => o.offsetMin), out.map((o) => o.earlyLeaveMin),
        out.map((o) => o.punchCount), out.map((o) => o.status),
        out.map((o) => o.dayType), out.map(() => now),
      ]
    );
  }
  return { rows: out.length, people: byUser.size };
}

// Findings also age on their own, with no new punch involved: a shift that
// had not started yet is PENDING, and only the passage of time turns it into
// an absence. Recomputing only when a sync arrives means that when the bridge
// stops — as it did for 32 hours on 2026-09-18 — the board silently freezes
// on whatever it last decided instead of admitting the day is unreported.
const LATENESS_SWEEP_MS = 15 * 60 * 1000;
const LATENESS_SWEEP_DAYS = 4;
async function sweepLateness() {
  try {
    const { rows } = await pool.query(`SELECT DISTINCT user_id FROM attendance WHERE id LIKE 'fp-%'`);
    if (!rows.length) return;
    const today = dayKeyInAppTz(Date.now());
    const result = await recomputeLateness({
      userIds: rows.map((r) => r.user_id),
      fromDate: addDays(today, -LATENESS_SWEEP_DAYS),
      toDate: addDays(today, 1),
    });
    if (result.rows) console.log(`[lateness] refreshed ${result.rows} finding(s) for ${result.people} person(s)`);
  } catch (e) {
    console.error('[lateness] sweep failed:', e.message);
  }
}

// ---------------------------------------------------------------------------
// XonTel: when did each agent actually start taking calls?
// ---------------------------------------------------------------------------
//
// XonTel is reachable from the public internet, so the server polls it
// directly — no office bridge. Auth is a static token from
// /api/v1/account/login. XONTEL_TOKEN can be set directly; if
// XONTEL_USERNAME/PASSWORD are set instead, the server logs in ONCE and keeps
// that token in sync_state across restarts, because XonTel allows a single
// session per account and a fresh login is refused (session_exists) while the
// previous one lives. Two services sharing one account must therefore share
// one token and never log in independently — which is why the account used
// by the QA system must not also be given to this one with a password.
// No default: the PBX answers only from inside the office network, so a
// cloud deployment cannot reach 37.34.150.252 at all and a hardcoded IP would
// only produce confusing timeouts. It is reached through a Cloudflare tunnel,
// and because that is a *quick* tunnel its hostname changes every time
// cloudflared restarts — hence the admin-editable override below, and
// XONTEL_DISCOVER_URL, which lets this server follow whichever address the QA
// system is already using instead of the two being updated by hand separately.
const XONTEL_ENV_BASE_URL = (process.env.XONTEL_BASE_URL || '').replace(/\/+$/, '');
const XONTEL_DISCOVER_URL = (process.env.XONTEL_DISCOVER_URL || '').replace(/\/+$/, '');
let xontelBaseUrlOverride = null;
function xontelBaseUrl() {
  return xontelBaseUrlOverride || XONTEL_ENV_BASE_URL;
}

// Asks the QA system which address it is currently using. Only ever widens
// what we know: a failure leaves the configured URL untouched.
async function xontelDiscoverBaseUrl() {
  if (!XONTEL_DISCOVER_URL) return null;
  try {
    const res = await fetch(XONTEL_DISCOVER_URL, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const j = await res.json();
    const url = String(j?.base_url || '').replace(/\/+$/, '');
    if (!/^https?:\/\//.test(url) || url === xontelBaseUrl()) return null;
    xontelBaseUrlOverride = url;
    await xontelSaveState({ baseUrl: url, discoveredAt: Date.now() });
    console.log(`[xontel] base URL followed from the QA system: ${url}`);
    return url;
  } catch {
    return null;
  }
}
const XONTEL_POLL_MS = 5 * 60 * 1000;
const XONTEL_POLL_DAYS = 1;
// The real vocabulary, read from account/agentstatus/filters: Eating, Pray,
// Complain, Break, Toilet, Survey, Coaching, Reviews, Reportings, Punching,
// "in call", "in chat", offline, ready, Pause.
//
// Only `offline` means "not signed in". Every other state — including the
// break kinds — is something an agent can only be in once they have logged
// in, so the first non-offline session of a shift IS the login. Overridable
// once the floor's own habits are better understood.
const XONTEL_IDLE_STATUSES = new Set(
  (process.env.XONTEL_IDLE_STATUSES || 'offline')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
);
// Being signed in and being reachable are different questions, and the first
// draft of this conflated them. `offline` decides whether someone is signed
// in at all, which is what login and logout mean. These decide whether they
// could actually take a call — everything else (Break, Eating, Pray, Toilet,
// Coaching, Reportings, Punching…) is signed-in-but-away.
const XONTEL_AVAILABLE_STATUSES = new Set(
  (process.env.XONTEL_AVAILABLE_STATUSES || 'ready,in call,in chat')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
);
// A page of 2000 comes back in ~8s. Rows repeat roughly twenty-fold inside a
// page (the API joins something it should not), so a page yields fewer than a
// hundred distinct sessions and a whole day takes ~14 of them.
const XONTEL_PAGE_SIZE = 2000;
const XONTEL_MAX_PAGES = 40;

function xontelHasCredentials() {
  return !!(process.env.XONTEL_TOKEN || (process.env.XONTEL_USERNAME && process.env.XONTEL_PASSWORD));
}
// Credentials alone are not enough: without a reachable address there is
// nothing to send them to.
function xontelConfigured() {
  return !!(xontelBaseUrl() && xontelHasCredentials());
}
let xontelToken = process.env.XONTEL_TOKEN || null;
let xontelLoginInFlight = null;
let xontelLastError = null;

async function xontelState() {
  const { rows } = await pool.query(`SELECT * FROM sync_state WHERE id = 'xontel'`);
  return rows[0] || null;
}
async function xontelSaveState(patch) {
  const cur = (await xontelState())?.detail || {};
  const detail = { ...cur, ...patch };
  await pool.query(
    `INSERT INTO sync_state (id, last_sync_at, detail) VALUES ('xontel', $1, $2::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       last_sync_at = COALESCE($1, sync_state.last_sync_at), detail = EXCLUDED.detail`,
    [patch.lastSyncAt ?? null, J(detail)]
  );
}

async function xontelLogin() {
  if (!process.env.XONTEL_USERNAME || !process.env.XONTEL_PASSWORD) return null;
  try {
    const res = await fetch(`${xontelBaseUrl()}/api/v1/account/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: process.env.XONTEL_USERNAME, password: process.env.XONTEL_PASSWORD }),
    });
    const body = await res.text().catch(() => '');
    let parsed = null;
    try { parsed = JSON.parse(body); } catch { /* raw text below */ }
    if (!res.ok) {
      xontelLastError = parsed?.session_exists
        ? 'XonTel allows one session per account and that account is already signed in elsewhere. Sign in to it in a browser, accept "sign in anyway", then sign out; this reconnects by itself.'
        : (parsed?.error || body.slice(0, 200) || `HTTP ${res.status}`);
      console.error(`[xontel] login rejected (${res.status}): ${xontelLastError}`);
      return null;
    }
    xontelToken = parsed?.token || null;
    xontelLastError = null;
    await xontelSaveState({ token: xontelToken });
    return xontelToken;
  } catch (e) {
    xontelLastError = `cannot reach ${xontelBaseUrl() || "(no XONTEL_BASE_URL set)"}: ${e.message}`;
    console.error('[xontel] ' + xontelLastError);
    return null;
  }
}
// Never more than one login at a time: parallel attempts against a
// one-session PBX would refuse each other.
function xontelLoginOnce() {
  if (!xontelLoginInFlight) xontelLoginInFlight = xontelLogin().finally(() => { xontelLoginInFlight = null; });
  return xontelLoginInFlight;
}

async function xontelGet(path) {
  if (!xontelConfigured()) throw new Error('XonTel is not configured');
  if (!xontelToken) {
    const st = await xontelState();
    xontelToken = st?.detail?.token || null;
  }
  // A hung XonTel must not hang us: the 1-minute live tick and the 5-minute
  // sweep share one lock, and a request that never returns held it for
  // minutes on 2026-09-24 (breaks stopped mirroring while XonTel was down).
  // A 2000-row page takes ~8s, so 45s is generous.
  const call = (token) => fetch(`${xontelBaseUrl()}${path}`, {
    headers: token ? { Authorization: `Token ${token}` } : {},
    signal: AbortSignal.timeout(45000),
  });
  if (!xontelToken) await xontelLoginOnce();
  let res = await call(xontelToken);
  if (res.status === 401 || res.status === 403) {
    const fresh = await xontelLoginOnce();
    if (fresh) res = await call(fresh);
    else if (process.env.XONTEL_TOKEN) {
      // Running on a borrowed token and no password to recover with. This is
      // the expected failure of sharing one account: whenever the other
      // service re-logs in, XonTel issues it a new token and silently
      // invalidates this copy. Say exactly that, or it reads as an outage.
      throw new Error(
        'the shared XONTEL_TOKEN is no longer valid — the other service signed in again and XonTel issued it a new one. ' +
        'Copy the current token from the QA system (its database, xontel_settings where setting_key = \'token\') into XONTEL_TOKEN here. ' +
        'A second XonTel account would end this for good.'
      );
    }
  }
  if (!res.ok) throw new Error(`XonTel API ${res.status} on ${path}`);
  return res.json();
}

// The one write Swipr makes to XonTel: `PUT account/agentready/<agentId>`,
// what XonTel's own supervisor page calls to return an agent to ready. It is
// the only cross-agent status write the panel has — there is no call to put
// someone ELSE on a break (the agent's own break menu acts on the token's
// owner), which is why breaks only flow XonTel → Swipr, and only the END of a
// break flows back. The response body is kept in the error because a Web
// Application Firewall sits in front of XonTel and answers 403 with its own
// page, which must not be mistaken for an expired token.
async function xontelPut(path) {
  if (!xontelConfigured()) throw new Error('XonTel is not configured');
  if (!xontelToken) {
    const st = await xontelState();
    xontelToken = st?.detail?.token || null;
  }
  if (!xontelToken) await xontelLoginOnce();
  const call = (token) => fetch(`${xontelBaseUrl()}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Token ${token}` } : {}) },
    body: '{}',
    signal: AbortSignal.timeout(20000),
  });
  let res = await call(xontelToken);
  if (res.status === 401) {
    const fresh = await xontelLoginOnce();
    if (fresh) res = await call(fresh);
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    const waf = /Web Application Firewall/i.test(text);
    throw new Error(`XonTel ${res.status} on PUT ${path}${waf ? ' (blocked by the Web Application Firewall)' : `: ${text.replace(/\s+/g, ' ').slice(0, 160)}`}`);
  }
  try { return JSON.parse(text); } catch { return text; }
}

// The API is undocumented, so each field is looked up under the spellings it
// could plausibly carry, and the whole row is kept alongside.
const pick = (o, keys) => { for (const k of keys) { if (o && o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; } return null; };
// A row looks like:
//   {id, status:"in call", from_time:"2026-09-19 17:54:25", to_time:…,
//    duration:"00:00:31.876104", username:"Ahmed_Kamel", logout_reason:null,
//    user:{"50":"Ahmed_Kamel"}}
// The agent id is the KEY of that single-entry `user` object, not a field
// inside it — reading it as `user.id` yields nothing at all.
const xontelAgentOf = (row) => {
  const u = row?.user;
  if (u && typeof u === 'object' && !Array.isArray(u)) {
    const k = Object.keys(u)[0];
    if (k) return { id: String(k), name: String(u[k] ?? row?.username ?? '') || null };
  }
  const flat = pick(row, ['user', 'user_id', 'agent_id', 'agent']);
  return { id: flat === null ? '' : String(flat), name: pick(row, ['username', 'user_name', 'agent_name', 'name']) };
};
// XonTel timestamps carry no zone; the PBX runs on Kuwait time.
const xontelTs = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  const s = String(v).trim();
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(s)) { const t = Date.parse(s); return Number.isFinite(t) ? t : null; }
  const t = Date.parse(s.replace(' ', 'T') + '+03:00');
  return Number.isFinite(t) ? t : null;
};
const xontelDurationSec = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Math.round(v);
  // "00:00:31.876104" is the usual shape; plain "1:02:03" also appears.
  const m = String(v).match(/^(\d+):(\d\d):(\d\d(?:\.\d+)?)$/);
  if (m) return Math.round((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]));
  const n = Number(v); return Number.isFinite(n) ? Math.round(n) : null;
};

// Pulls every status session in [fromDate, toDate] and upserts it.
const xontelParse = (r) => {
  const agent = xontelAgentOf(r);
  const start = xontelTs(pick(r, ['from_time', 'start_time', 'start', 'created_at', 'time']));
  if (!agent.id || start === null) return null;
  const status = String(pick(r, ['status', 'event', 'state']) ?? 'unknown');
  return {
    id: String(pick(r, ['id', 'pk']) ?? `${agent.id}:${start}:${status}`),
    agentId: agent.id, agentName: agent.name, status, start,
    end: xontelTs(pick(r, ['to_time', 'end_time', 'end'])),
    dur: xontelDurationSec(pick(r, ['duration', 'total_duration'])),
    raw: r,
  };
};

// Pulls status sessions and upserts them.
//
// `pagination=false` hangs the server outright (there are 7.6M rows), so this
// always pages. The API returns newest first, which is what makes a routine
// poll cheap: only the newest sessions can have changed, so paging stops as
// soon as a page brings nothing new. `full` disables that for a backfill,
// where older pages must be read even though the first ones look familiar.
async function xontelSync({ fromDate, toDate, full = false, pageSize = XONTEL_PAGE_SIZE }) {
  const now = Date.now();
  let received = 0, stored = 0, pages = 0;

  for (let page = 1; page <= XONTEL_MAX_PAGES; page++) {
    const data = await xontelGet(
      `/api/v1/account/agentstatus?from_date=${fromDate}&to_date=${toDate}&page=${page}&size=${pageSize}`
    );
    const rows = Array.isArray(data) ? data : (data?.results || []);
    pages++;
    received += rows.length;
    if (!rows.length) break;

    // Rows repeat ~20x within a page; collapse before touching the database.
    const byId = new Map();
    for (const r of rows) { const p = xontelParse(r); if (p) byId.set(p.id, p); }
    const out = [...byId.values()];

    let changed = 0;
    if (out.length) {
      const { rows: res } = await pool.query(
        `INSERT INTO xontel_sessions (id, xontel_agent_id, xontel_agent_name, status, start_ts, end_ts, duration_sec, raw, fetched_at)
         SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::bigint[], $6::bigint[], $7::int[], $8::jsonb[], $9::bigint[])
         ON CONFLICT (id) DO UPDATE SET
           xontel_agent_id = EXCLUDED.xontel_agent_id, xontel_agent_name = EXCLUDED.xontel_agent_name,
           status = EXCLUDED.status, start_ts = EXCLUDED.start_ts, end_ts = EXCLUDED.end_ts,
           duration_sec = EXCLUDED.duration_sec, raw = EXCLUDED.raw, fetched_at = EXCLUDED.fetched_at
         -- Only a row that actually differs counts as new; an unchanged one
         -- returns nothing, which is the signal that this page is old news.
         WHERE xontel_sessions.status IS DISTINCT FROM EXCLUDED.status
            OR xontel_sessions.start_ts IS DISTINCT FROM EXCLUDED.start_ts
            OR xontel_sessions.end_ts IS DISTINCT FROM EXCLUDED.end_ts
         RETURNING id`,
        [out.map((o) => o.id), out.map((o) => o.agentId), out.map((o) => o.agentName), out.map((o) => o.status),
         out.map((o) => o.start), out.map((o) => o.end), out.map((o) => o.dur), out.map((o) => J(o.raw)), out.map(() => now)]
      );
      changed = res.length;
      stored += changed;
    }

    const totalPages = Number(data?.pages?.total_pages ?? 0);
    if (totalPages && page >= totalPages) break;
    if (!full && changed === 0) break;
  }

  await xontelSaveState({ lastSyncAt: now, lastError: null, lastCount: stored, lastRange: `${fromDate}..${toDate}`, lastPages: pages });
  xontelLastError = null;
  return { received, stored, pages };
}

// The CDR stamps calls in 12-hour time: "2026-09-19 02:49:59pm".
const xontelCdrTs = (v) => {
  const m = String(v ?? '').match(/^(\d{4}-\d\d-\d\d)[ T](\d{1,2}):(\d\d):(\d\d)\s*(am|pm)?$/i);
  if (!m) return xontelTs(v);
  let h = Number(m[2]);
  const ap = (m[5] || '').toLowerCase();
  if (ap === 'pm' && h !== 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  const t = Date.parse(`${m[1]}T${String(h).padStart(2, '0')}:${m[3]}:${m[4]}+03:00`);
  return Number.isFinite(t) ? t : null;
};

// Unlike the status feed, the CDR is well behaved: no duplicate rows, proper
// paging, newest first — so the same early exit applies.
async function xontelSyncCalls({ fromDate, toDate, full = false }) {
  const now = Date.now();
  let received = 0, stored = 0, pages = 0;

  for (let page = 1; page <= XONTEL_MAX_PAGES; page++) {
    const data = await xontelGet(`/api/v1/cdr/?from_date=${fromDate}&to_date=${toDate}&page=${page}&size=500`);
    const rows = Array.isArray(data) ? data : (data?.results || []);
    pages++;
    received += rows.length;
    if (!rows.length) break;

    const out = [];
    for (const r of rows) {
      const start = xontelCdrTs(r?.cdr_time);
      const id = r?.id ?? r?.uniqueid;
      if (start === null || id === undefined || id === null) continue;
      const dur = xontelDurationSec(r.duration) ?? 0;
      // billsec is the answered portion; a missed call has none.
      const talk = Number.isFinite(Number(r.billsec)) ? Math.max(0, Math.round(Number(r.billsec))) : 0;
      out.push({
        id: String(id),
        agentId: r.agent_id === null || r.agent_id === undefined ? null : String(r.agent_id),
        agentName: r.agent ?? null,
        start, dur, talk,
        direction: r.call_type ?? null,
        status: r.call_status?.value ?? r.call_status ?? null,
        number: r.caller_number ?? r.src ?? null,
        queue: r.dst ?? null,
        rec: r.record_file_url ?? null,
      });
    }

    let changed = 0;
    if (out.length) {
      const { rows: res } = await pool.query(
        `INSERT INTO xontel_calls (id, xontel_agent_id, agent_name, start_ts, duration_sec, talk_sec,
                                   direction, status, caller_number, queue, recording_url, fetched_at)
         SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::bigint[], $5::int[], $6::int[],
                              $7::text[], $8::text[], $9::text[], $10::text[], $11::text[], $12::bigint[])
         ON CONFLICT (id) DO UPDATE SET
           xontel_agent_id = EXCLUDED.xontel_agent_id, agent_name = EXCLUDED.agent_name,
           start_ts = EXCLUDED.start_ts, duration_sec = EXCLUDED.duration_sec, talk_sec = EXCLUDED.talk_sec,
           direction = EXCLUDED.direction, status = EXCLUDED.status, caller_number = EXCLUDED.caller_number,
           queue = EXCLUDED.queue, recording_url = EXCLUDED.recording_url, fetched_at = EXCLUDED.fetched_at
         WHERE xontel_calls.start_ts IS DISTINCT FROM EXCLUDED.start_ts
            OR xontel_calls.talk_sec IS DISTINCT FROM EXCLUDED.talk_sec
            OR xontel_calls.status IS DISTINCT FROM EXCLUDED.status
         RETURNING id`,
        [out.map((o) => o.id), out.map((o) => o.agentId), out.map((o) => o.agentName), out.map((o) => o.start),
         out.map((o) => o.dur), out.map((o) => o.talk), out.map((o) => o.direction), out.map((o) => o.status),
         out.map((o) => o.number), out.map((o) => o.queue), out.map((o) => o.rec), out.map(() => now)]
      );
      changed = res.length;
      stored += changed;
    }

    const totalPages = Number(data?.pages?.total_pages ?? 0);
    if (totalPages && page >= totalPages) break;
    if (!full && changed === 0) break;
  }
  return { received, stored, pages };
}

// ---- Missed customer calls ---------------------------------------------------
// Two feeds, both found by watching XonTel's own Missed Calls page:
//   xontel_helper/missed_calls_dashboard — what that page lists: calls a
//     customer abandoned in a queue. A row is {id, caller, number, queue,
//     queue_number, status "Pending"|"Done", time "2026-10-01T16:00:14.785387",
//     assignee (the agent's display name, null while pending), uniqueid,
//     assigned_time, close}. Wrapped as {abandoned_calls_page_obj: {data,
//     total_pages, count, …}}. XonTel shows only a recent window of these
//     (81 rows on 2026-10-01), so the whole list is read on every poll and
//     kept; a call that flips to Done updates its row.
//   xontel_queue/missedcallhistory — one row per call-back an agent made:
//     {id, agent (XonTel username), call (the dashboard id above), caller,
//     call_status "Done"|"Busy"|"No Answer", assigned_time "2026-10-01 15:48:56"}.
//     Takes from_date/to_date, pages properly, newest first.
// Both carry Kuwait wall-clock times without a zone, like the status feed.
const XONTEL_MISSED_PAGE = 500;
async function xontelSyncMissed({ fromDate, toDate, full = false }) {
  const now = Date.now();
  let missed = 0, callbacks = 0, pages = 0;

  // The date range is only sent on a backfill; whether the dashboard honours
  // it is unknown, and the rows that do come back are kept either way.
  const dated = full ? `&from_date=${fromDate}&to_date=${toDate}` : '';
  for (let page = 1; page <= 10; page++) {
    const data = await xontelGet(`/api/v1/xontel_helper/missed_calls_dashboard?page=${page}&page_size=${XONTEL_MISSED_PAGE}${dated}`);
    const obj = data?.abandoned_calls_page_obj;
    const rows = Array.isArray(obj?.data) ? obj.data : [];
    pages++;
    if (!rows.length) break;
    const out = [];
    for (const r of rows) {
      const ts = xontelTs(r?.time);
      if (r?.id === undefined || r?.id === null || ts === null) continue;
      out.push({
        id: String(r.id), uniq: r.uniqueid ?? null,
        caller: r.caller ?? r.number ?? null, queue: r.queue ?? r.queue_number ?? null,
        status: String(r.status ?? 'Pending'), ts,
        assignee: r.assignee ?? null, assignedTs: xontelTs(r.assigned_time), closed: !!r.close, raw: r,
      });
    }
    if (out.length) {
      const { rows: res } = await pool.query(
        `INSERT INTO xontel_missed_calls (id, uniqueid, caller, queue, status, missed_ts, assignee, assigned_ts, closed, raw, fetched_at)
         SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::bigint[], $7::text[], $8::bigint[], $9::boolean[], $10::jsonb[], $11::bigint[])
         ON CONFLICT (id) DO UPDATE SET
           uniqueid = EXCLUDED.uniqueid, caller = EXCLUDED.caller, queue = EXCLUDED.queue, status = EXCLUDED.status,
           missed_ts = EXCLUDED.missed_ts, assignee = EXCLUDED.assignee, assigned_ts = EXCLUDED.assigned_ts,
           closed = EXCLUDED.closed, raw = EXCLUDED.raw, fetched_at = EXCLUDED.fetched_at
         WHERE xontel_missed_calls.status IS DISTINCT FROM EXCLUDED.status
            OR xontel_missed_calls.assignee IS DISTINCT FROM EXCLUDED.assignee
            OR xontel_missed_calls.assigned_ts IS DISTINCT FROM EXCLUDED.assigned_ts
            OR xontel_missed_calls.closed IS DISTINCT FROM EXCLUDED.closed
         RETURNING id`,
        [out.map((o) => o.id), out.map((o) => o.uniq), out.map((o) => o.caller), out.map((o) => o.queue), out.map((o) => o.status),
         out.map((o) => o.ts), out.map((o) => o.assignee), out.map((o) => o.assignedTs), out.map((o) => o.closed),
         out.map((o) => J(o.raw)), out.map(() => now)]
      );
      missed += res.length;
    }
    const totalPages = Number(obj?.total_pages ?? 0);
    if (totalPages && page >= totalPages) break;
  }

  for (let page = 1; page <= XONTEL_MAX_PAGES; page++) {
    const data = await xontelGet(`/api/v1/xontel_queue/missedcallhistory?from_date=${fromDate}&to_date=${toDate}&page=${page}&size=${XONTEL_MISSED_PAGE}`);
    const rows = Array.isArray(data?.results) ? data.results : [];
    pages++;
    if (!rows.length) break;
    const out = [];
    for (const r of rows) {
      const ts = xontelTs(r?.assigned_time);
      if (r?.id === undefined || r?.id === null || ts === null) continue;
      out.push({
        id: String(r.id), callId: r.call === null || r.call === undefined ? null : String(r.call),
        agent: r.agent ?? null, caller: r.caller ?? null, outcome: String(r.call_status ?? ''), ts, raw: r,
      });
    }
    let changed = 0;
    if (out.length) {
      const { rows: res } = await pool.query(
        `INSERT INTO xontel_callbacks (id, call_id, xontel_agent_name, caller, outcome, at_ts, raw, fetched_at)
         SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::bigint[], $7::jsonb[], $8::bigint[])
         ON CONFLICT (id) DO UPDATE SET
           call_id = EXCLUDED.call_id, xontel_agent_name = EXCLUDED.xontel_agent_name, caller = EXCLUDED.caller,
           outcome = EXCLUDED.outcome, at_ts = EXCLUDED.at_ts, raw = EXCLUDED.raw, fetched_at = EXCLUDED.fetched_at
         WHERE xontel_callbacks.outcome IS DISTINCT FROM EXCLUDED.outcome
            OR xontel_callbacks.at_ts IS DISTINCT FROM EXCLUDED.at_ts
            OR xontel_callbacks.call_id IS DISTINCT FROM EXCLUDED.call_id
         RETURNING id`,
        [out.map((o) => o.id), out.map((o) => o.callId), out.map((o) => o.agent), out.map((o) => o.caller),
         out.map((o) => o.outcome), out.map((o) => o.ts), out.map((o) => J(o.raw)), out.map(() => now)]
      );
      changed = res.length;
      callbacks += changed;
    }
    const totalPages = Number(data?.pages?.total_pages ?? 0);
    if (totalPages && page >= totalPages) break;
    if (!full && changed === 0) break;
  }

  await xontelSaveState({ missedAt: now, missedRange: `${fromDate}..${toDate}` });
  return { missed, callbacks, pages };
}

// One XonTel sync at a time: the 5-minute sweep and the 1-minute status tick
// both upsert xontel_sessions, and doubling up only doubles the load on a
// tunnel another service shares.
let xontelBusy = false;

async function xontelPoll() {
  if (!xontelHasCredentials() || xontelBusy) return;
  xontelBusy = true;
  try {
    // Follow the QA system's address first: a quick tunnel's hostname changes
    // on every cloudflared restart, and a stale one looks exactly like an outage.
    if (XONTEL_DISCOVER_URL) await xontelDiscoverBaseUrl();
    if (!xontelBaseUrl()) return;
    const today = dayKeyInAppTz(Date.now());
    const from = addDays(today, -XONTEL_POLL_DAYS);
    try {
      const r = await xontelSync({ fromDate: from, toDate: today });
      if (r.stored || r.pages > 1) console.log(`[xontel] synced ${r.stored} session(s) over ${r.pages} page(s)`);
    } catch (e) {
      xontelLastError = e.message;
      console.error('[xontel] poll failed:', e.message);
      await xontelSaveState({ lastError: e.message }).catch(() => {});
    }
    // Calls are pulled separately: a failure on one must not cost the other,
    // since only the calls can answer "how long were they actually talking".
    try {
      const c = await xontelSyncCalls({ fromDate: from, toDate: today });
      if (c.stored) console.log(`[xontel] synced ${c.stored} call(s) over ${c.pages} page(s)`);
    } catch (e) {
      console.error('[xontel] call poll failed:', e.message);
    }
    try {
      const m = await xontelSyncMissed({ fromDate: from, toDate: today });
      if (m.missed || m.callbacks) console.log(`[xontel] missed calls: ${m.missed} changed, ${m.callbacks} call-back(s)`);
    } catch (e) {
      console.error('[xontel] missed-call poll failed:', e.message);
    }
    await xontelRefineBreaks().catch((e) => console.error('[xontel] break refine failed:', e.message));
  } finally {
    xontelBusy = false;
  }
}

// A session the agent sits in for hours (Coaching, a long Complain) is only
// written to the feed when it CLOSES, and the feed is ordered newest-first by
// the session id, which is assigned when it STARTS — so a long session's row
// lands deep in the feed, past where the 5-minute poll's early-exit stops.
// Those agents' days came back with one stored session where there were
// really several hours of status. This reads every page of the recent window
// (full), so a long session is captured once it ends; on its own slower
// timer to keep the cost off the responsive polls.
async function xontelFullStatusSync() {
  if (!xontelConfigured() || xontelBusy) return;
  xontelBusy = true;
  try {
    const today = dayKeyInAppTz(Date.now());
    const r = await xontelSync({ fromDate: addDays(today, -1), toDate: today, full: true });
    if (r.stored) console.log(`[xontel] full status pass: ${r.stored} session(s) healed over ${r.pages} page(s)`);
  } catch (e) {
    console.error('[xontel] full status pass failed:', e.message);
  } finally {
    xontelBusy = false;
  }
}
const XONTEL_FULL_POLL_MS = 15 * 60 * 1000;

// One-time backfill of the history the early-exit poll left truncated. Runs
// once ever (a sync_state marker guards it across restarts), day by day with
// a full read of each day, releasing the lock between days so the break tick
// still runs. XONTEL_BACKFILL_FROM overrides the start; the data began
// 2026-09-17 when the link went live. Today and yesterday are covered by the
// regular full pass, so this stops at the day before yesterday.
const XONTEL_BACKFILL_FROM = process.env.XONTEL_BACKFILL_FROM || '2026-09-17';
async function xontelBackfillOnce() {
  if (!xontelConfigured()) return;
  const marker = (await pool.query(`SELECT detail FROM sync_state WHERE id = 'xontel_backfill'`)).rows[0]?.detail;
  const to = addDays(dayKeyInAppTz(Date.now()), -2);
  if (marker?.done && marker?.through >= to) return;              // already covered
  const from = XONTEL_BACKFILL_FROM;
  if (to < from) return;
  console.log(`[xontel] backfill starting: ${from}..${to}`);
  let days = 0, sessions = 0, calls = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    while (xontelBusy) await new Promise((r) => setTimeout(r, 2000));
    xontelBusy = true;
    try {
      const s = await xontelSync({ fromDate: d, toDate: d, full: true });
      const c = await xontelSyncCalls({ fromDate: d, toDate: d, full: true });
      sessions += s.stored; calls += c.stored; days++;
    } catch (e) {
      console.error(`[xontel] backfill ${d} failed:`, e.message);
    } finally {
      xontelBusy = false;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  await pool.query(
    `INSERT INTO sync_state (id, last_sync_at, detail) VALUES ('xontel_backfill', $1, $2::jsonb)
     ON CONFLICT (id) DO UPDATE SET last_sync_at = EXCLUDED.last_sync_at, detail = EXCLUDED.detail`,
    [Date.now(), J({ done: true, from, through: to, days, sessions, calls, at: Date.now() })]
  );
  console.log(`[xontel] backfill done: ${days} day(s), ${sessions} session(s), ${calls} call(s) healed`);
}

// The call-back log is small (a few thousand rows in all), so its whole
// history is re-read on every start — cheap, and self-healing after a gap.
// The dashboard's own window can't be widened from here, so missed calls
// older than what it still lists are known only through their call-backs.
async function xontelMissedBackfill() {
  if (!xontelConfigured()) return;
  while (xontelBusy) await new Promise((r) => setTimeout(r, 2000));
  xontelBusy = true;
  try {
    const today = dayKeyInAppTz(Date.now());
    const m = await xontelSyncMissed({ fromDate: XONTEL_BACKFILL_FROM, toDate: today, full: true });
    console.log(`[xontel] missed-call history: ${m.missed} call(s), ${m.callbacks} call-back(s) over ${m.pages} page(s)`);
  } catch (e) {
    console.error('[xontel] missed-call history failed:', e.message);
  } finally {
    xontelBusy = false;
  }
}

// ---- XonTel breaks → Swipr ----------------------------------------------------
// The floor takes its breaks on XonTel (Break, Toilet, Pray, Eating…), so
// those are mirrored into Swipr's own breaks table: Live Breaks, the Report,
// and the one-per-department rule all see them without the agent pressing a
// second button.
//
// The source is `xontel_helper/agents_status` — every agent's status RIGHT
// NOW — not the agentstatus session feed. That feed only ever lists sessions
// that have already ended (not one row in xontel_sessions has ever had an
// empty end), so the status someone is in at this moment is simply not in
// it. A first version built on it would never have fired. The finished
// sessions are still used afterwards, to correct each mirrored break to
// XonTel's exact start and end times (xontelRefineBreaks).
const XONTEL_FAST_POLL_MS = 60 * 1000;
const XONTEL_BREAK_STATUSES = new Set(
  (process.env.XONTEL_BREAK_STATUSES || 'break,eating,pray,toilet')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
);
const isXontelBreakStatus = (s) => XONTEL_BREAK_STATUSES.has(String(s || '').toLowerCase());

// Each agent's current status, keyed by XonTel agent id.
async function xontelLiveStatuses() {
  const data = await xontelGet('/api/v1/xontel_helper/agents_status');
  const all = Array.isArray(data?.all) ? data.all : [];
  const out = new Map();
  for (const a of all) {
    if (a?.id === undefined || a?.id === null) continue;
    out.set(String(a.id), { status: String(a.extension_status ?? ''), since: xontelTs(a.start_time) });
  }
  return out;
}

async function xontelFastPoll() {
  if (!xontelConfigured() || xontelBusy) return;
  xontelBusy = true;
  try {
    const live = await xontelLiveStatuses();
    // Kept for shift adherence: the one place that knows who is signed in
    // right now, since finished sessions are all the status feed reports.
    xontelLiveSnapshot = { at: Date.now(), byAgent: live };
    await xontelReconcileBreaks(live);
    await xontelSaveState({ liveAt: Date.now(), liveCount: live.size, liveError: null });
  } catch (e) {
    console.error('[xontel] live status tick failed:', e.message);
    await xontelSaveState({ liveError: e.message, liveErrorAt: Date.now() }).catch(() => {});
  } finally {
    xontelBusy = false;
  }
}

// Only ever called with a snapshot fetched a moment ago, so what it sees is
// current. A tick that fails changes nothing: no break is opened or closed on
// old information.
async function xontelReconcileBreaks(live) {
  const { rows: maps } = await pool.query(`SELECT user_id, xontel_agent_id FROM xontel_agent_map`);
  if (!maps.length) return;
  const userIds = maps.map((m) => m.user_id);
  const { rows: active } = await pool.query(
    `SELECT * FROM breaks WHERE ended_at IS NULL AND user_id = ANY($1)`, [userIds]
  );
  const activeOf = new Map(active.map((b) => [b.user_id, b]));
  const { rows: held } = await pool.query(
    `SELECT DISTINCT user_id FROM breaks WHERE xontel_hold = 1 AND user_id = ANY($1)`, [userIds]
  );
  const holding = new Set(held.map((h) => h.user_id));
  const now = Date.now();

  for (const m of maps) {
    const cur = live.get(String(m.xontel_agent_id));
    if (!cur) continue;                       // not in the snapshot: say nothing
    const onBreak = isXontelBreakStatus(cur.status);
    const b = activeOf.get(m.user_id);
    try {
      if (onBreak) {
        if (!b) {
          // A break ended from Swipr while XonTel still showed them away is
          // not reopened until XonTel has shown them back (see xontel_hold).
          if (!holding.has(m.user_id)) await xontelOpenBreak(m.user_id, cur, now);
        } else if (!b.xontel_session_id || b.xontel_status !== cur.status) {
          // Their own Swipr break (now also away on XonTel), or Break → Toilet:
          // link it, so XonTel going back to ready is what ends it.
          await pool.query(
            `UPDATE breaks SET xontel_session_id = coalesce(xontel_session_id, 'live'), xontel_status = $1
              WHERE id = $2 AND ended_at IS NULL`,
            [cur.status, b.id]
          );
        }
      } else {
        if (holding.has(m.user_id)) {
          await pool.query(`UPDATE breaks SET xontel_hold = 0 WHERE user_id = $1 AND xontel_hold = 1`, [m.user_id]);
        }
        // Back on XonTel. A break never seen away on XonTel is one pressed in
        // Swipr only, and XonTel's "ready" says nothing about it.
        if (b && b.xontel_session_id) {
          await pool.query(
            `UPDATE breaks SET ended_at = $1, ended_by_id = NULL, ended_by_name = 'XonTel', ended_by_role = 'XONTEL'
              WHERE id = $2 AND ended_at IS NULL`,
            [Math.max(now, Number(b.started_at)), b.id]
          );
        }
      }
    } catch (e) {
      console.error(`[xontel] break reconcile failed for ${m.user_id}:`, e.message);
    }
  }
}

async function xontelOpenBreak(userId, cur, now) {
  // XonTel's own start when it gives one; otherwise the first minute it was
  // seen, which xontelRefineBreaks later corrects from the finished session.
  const since = cur.since && cur.since <= now && cur.since > now - 12 * 60 * 60 * 1000 ? cur.since : now;
  const { rows } = await pool.query(
    `INSERT INTO breaks (id, user_id, started_at, source, xontel_session_id, xontel_status)
     VALUES ($1, $2, $3, 'xontel', 'live', $4)
     ON CONFLICT DO NOTHING RETURNING *`,
    [genId(), userId, since, cur.status]
  );
  if (!rows[0]) return;

  // Swipr cannot stop anyone pressing a status on XonTel, so a XonTel break
  // that breaks a rule is recorded anyway — and the leads are told. Only then:
  // Call Center alone logs 45-67 XonTel break spells a day, and a notice per
  // spell to ten leads would bury the ones that need acting on.
  const me = await getUserRow(userId);
  if (!me) return;
  const problems = [];
  const freeze = await activeFreezeFor(me);
  if (freeze) problems.push(`while breaks are paused until ${fmtClock(Number(freeze.ends_at))}`);
  const dept = !isBranchRole(me.role) ? nrm(me.companyName) : null;
  if (dept) {
    const { rows: peer } = await pool.query(
      `SELECT u.data->>'name' AS name FROM breaks b JOIN users u ON u.id = b.user_id
        WHERE b.ended_at IS NULL AND b.user_id <> $1 AND b.started_at <= $3
          AND u.data->>'role' = 'EMPLOYEE' AND lower(trim(u.data->>'companyName')) = $2
        ORDER BY b.started_at LIMIT 1`,
      [userId, dept, since]
    );
    if (peer[0]) problems.push(`while ${peer[0].name} was already on a break`);
  }
  if (!problems.length) return;
  const watchers = await breakWatchersFor(me);
  await Promise.all(watchers.map((w) =>
    notify(w.id, 'break', `${me.name} took a break on XonTel ${problems.join(' and ')}`,
      `${cur.status} since ${fmtClock(since)} · ${unitLine(me)}`)
  ));
}

// Once XonTel has closed the sessions behind a mirrored break, snap it to
// XonTel's own times: the live tick only knows to the minute. Takes the run
// of consecutive break-status sessions (Break then Toilet reads as one break)
// that overlaps it. Only breaks XonTel itself ended are moved at the end — a
// lead's End Break keeps the time the lead pressed it.
async function xontelRefineBreaks() {
  const { rows } = await pool.query(
    `SELECT b.id, b.source, b.started_at, b.ended_at, b.ended_by_role, m.xontel_agent_id
       FROM breaks b JOIN xontel_agent_map m ON m.user_id = b.user_id
      WHERE b.xontel_session_id = 'live' AND b.ended_at IS NOT NULL AND b.ended_at > $1`,
    [Date.now() - 6 * 60 * 60 * 1000]
  );
  for (const b of rows) {
    const lo = Number(b.started_at) - 3 * 60 * 1000;
    const hi = Number(b.ended_at) + 3 * 60 * 1000;
    const { rows: sess } = await pool.query(
      `SELECT id, status, start_ts, end_ts FROM xontel_sessions
        WHERE xontel_agent_id = $1 AND start_ts < $3 AND end_ts > $2 ORDER BY start_ts`,
      [b.xontel_agent_id, lo, hi]
    );
    const runs = [];
    for (const s of sess) {
      const last = runs[runs.length - 1];
      if (!isXontelBreakStatus(s.status)) { if (last) last.closed = true; continue; }
      if (last && !last.closed && Number(s.start_ts) - last.end <= 5000) last.end = Number(s.end_ts);
      else runs.push({ start: Number(s.start_ts), end: Number(s.end_ts), closed: false });
    }
    // The run that overlaps this break the most.
    const overlap = (r) => Math.min(r.end, Number(b.ended_at)) - Math.max(r.start, Number(b.started_at));
    const best = runs.filter((r) => overlap(r) > 0).sort((x, y) => overlap(y) - overlap(x))[0];
    if (!best) continue;
    // A Swipr-button break started when they pressed it, whatever XonTel says.
    const newStart = b.source === 'xontel' ? best.start : Number(b.started_at);
    const newEnd = b.ended_by_role === 'XONTEL' ? best.end : Number(b.ended_at);
    await pool.query(
      `UPDATE breaks SET started_at = $1, ended_at = $2, xontel_session_id = 'refined' WHERE id = $3`,
      [newStart, Math.max(newEnd, newStart), b.id]
    );
  }
}

// Swipr → XonTel: when a break ends here (the agent's End Break, or a lead's
// End Break for them), put the agent back to ready on XonTel too — but only
// if XonTel, asked right now, still has them on a break status. Someone
// ready, in a call, coaching or offline is never touched. Runs after the
// response is sent; the outcome of the last attempt is kept in sync_state.
async function xontelReturnToReady(userId, breakId) {
  if (!xontelConfigured()) return null;
  const { rows: mp } = await pool.query(`SELECT xontel_agent_id FROM xontel_agent_map WHERE user_id = $1`, [userId]);
  const agentId = mp[0]?.xontel_agent_id;
  if (!agentId) return null;
  let cur;
  try {
    cur = (await xontelLiveStatuses()).get(String(agentId));
  } catch (e) {
    await xontelSaveState({ lastReadyWrite: { at: Date.now(), agentId, userId, ok: false, error: `status check failed: ${e.message}` } }).catch(() => {});
    return { ok: false, error: `could not read their XonTel status: ${e.message}` };
  }
  if (!cur || !isXontelBreakStatus(cur.status)) return null;

  // Until XonTel shows them back, the break just ended here must not be
  // reopened by the live tick — whether or not this write gets through.
  if (breakId) await pool.query(`UPDATE breaks SET xontel_hold = true WHERE id = $1`, [breakId]);

  let result;
  try {
    await xontelPut(`/api/v1/account/agentready/${encodeURIComponent(agentId)}`);
    result = { ok: true, from: cur.status };
  } catch (e) {
    result = { ok: false, from: cur.status, error: e.message };
    console.error(`[xontel] agentready for ${agentId} failed:`, e.message);
  }
  await xontelSaveState({ lastReadyWrite: { at: Date.now(), agentId, userId, ...result } }).catch(() => {});
  return result;
}

// For a set of (user, window) pairs, the XonTel login/logout inside each
// window: the first non-idle session's start is "began taking calls", the
// last non-idle session's end is "stopped".
async function xontelWorkFor(items) {
  const userIds = [...new Set(items.map((i) => i.userId))];
  if (!userIds.length) return new Map();
  const { rows: maps } = await pool.query(`SELECT user_id, xontel_agent_id FROM xontel_agent_map WHERE user_id = ANY($1)`, [userIds]);
  const agentOf = new Map(maps.map((m) => [m.user_id, m.xontel_agent_id]));
  if (!agentOf.size) return new Map();
  const lo = Math.min(...items.map((i) => i.lo)), hi = Math.max(...items.map((i) => i.hi));
  const { rows: sess } = await pool.query(
    `SELECT xontel_agent_id, status, start_ts, end_ts FROM xontel_sessions
      WHERE xontel_agent_id = ANY($1) AND start_ts >= $2 AND start_ts <= $3 ORDER BY start_ts`,
    [[...new Set(agentOf.values())], lo, hi]
  );
  const byAgent = new Map();
  for (const s of sess) { if (!byAgent.has(s.xontel_agent_id)) byAgent.set(s.xontel_agent_id, []); byAgent.get(s.xontel_agent_id).push(s); }
  const out = new Map();
  for (const it of items) {
    const a = agentOf.get(it.userId);
    if (!a) continue;
    const working = (byAgent.get(a) || []).filter((s) =>
      !XONTEL_IDLE_STATUSES.has(String(s.status).toLowerCase()) && Number(s.start_ts) >= it.lo && Number(s.start_ts) <= it.hi);
    if (!working.length) { out.set(it.key, { mapped: true, loginTs: null, logoutTs: null }); continue; }
    const loginTs = Number(working[0].start_ts);
    const ends = working.map((s) => (s.end_ts === null ? null : Number(s.end_ts))).filter((e) => e !== null);
    out.set(it.key, { mapped: true, loginTs, logoutTs: ends.length ? Math.max(...ends) : null });
  }
  for (const it of items) if (!out.has(it.key)) out.set(it.key, { mapped: agentOf.has(it.userId), loginTs: null, logoutTs: null });
  return out;
}

const normalizeAgentName = (s) => String(s || '').toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
const nameTokens = (s) => normalizeAgentName(s).split(' ').filter((t) => t.length > 1);

// Small edit distance, capped — enough for the transliteration drift between
// the two systems ("Hussian" here, "hussein" there) without matching people
// who merely look alike.
function closeEnough(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 2 || Math.min(a.length, b.length) < 4) return false;
  const d = [];
  for (let i = 0; i <= a.length; i++) d[i] = [i];
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length] <= 2;
}
const hasToken = (tokens, t) => tokens.some((x) => closeEnough(x, t));

// How strongly a Swipr name and a XonTel agent name look like the same person.
// XonTel names are often a single word ("Malak", "Sherif"), so a first-name
// hit has to count — but only weakly, because first names repeat.
function nameScore(personName, agentName) {
  const p = nameTokens(personName), a = nameTokens(agentName);
  if (!p.length || !a.length) return 0;
  if (normalizeAgentName(personName) === normalizeAgentName(agentName)) return 100;
  const aInP = a.every((t) => hasToken(p, t));
  const pInA = p.every((t) => hasToken(a, t));
  // Two or more shared name parts is strong evidence either way round.
  if ((aInP && a.length >= 2) || (pInA && p.length >= 2)) return 90;
  // A one-word agent name has no second name to corroborate it, so here the
  // match must be EXACT. Allowing near-misses paired "Shouky Ayoub" with the
  // agent "Shokry", who is really Mohamed Shokry — two edits apart and a
  // different person. Fuzziness is only safe when another name part agrees.
  if (a.length === 1 && a[0] === p[0]) return 60;
  if (a.length === 1 && p.includes(a[0])) return 45;
  return 0;
}

// Pairs people with agents only where the choice is mutual and unambiguous:
// each must be the other's single best match. Two people who score equally
// against one agent get no suggestion at all, which is the right outcome —
// linking the wrong pair puts one person's logins on another's record.
function suggestAgentLinks(people, agents, alreadyTaken) {
  const free = agents.filter((a) => !alreadyTaken.has(a.id));
  const grid = new Map();
  for (const p of people) {
    const scored = free.map((a) => ({ a, s: nameScore(p.name, a.name) })).filter((x) => x.s > 0)
      .sort((x, y) => y.s - x.s);
    grid.set(p.userId, scored);
  }
  const out = new Map();
  for (const p of people) {
    const mine = grid.get(p.userId) || [];
    if (!mine.length) continue;
    const best = mine[0];
    if (mine.length > 1 && mine[1].s === best.s) continue;        // this person is torn
    // …and is anyone else an equally good claim on that agent?
    let contested = false;
    for (const q of people) {
      if (q.userId === p.userId) continue;
      const theirs = (grid.get(q.userId) || []).find((x) => x.a.id === best.a.id);
      if (theirs && theirs.s >= best.s) { contested = true; break; }
    }
    if (!contested) out.set(p.userId, best.a);
  }
  return out;
}

// Convenience wrappers. Both swallow their own errors: a lateness figure is
// derived information, and failing to refresh it must never turn a successful
// roster edit or punch correction into an error for the person who made it.
async function recomputeAround(userId, timestamps) {
  const ts = (timestamps || []).filter((t) => Number.isFinite(t));
  if (!userId || !ts.length) return;
  try {
    await recomputeLateness({
      userIds: [userId],
      fromDate: addDays(dayKeyInAppTz(Math.min(...ts)), -1),
      toDate: addDays(dayKeyInAppTz(Math.max(...ts)), 1),
    });
  } catch (e) {
    console.error('[lateness] recompute failed:', e.message);
  }
}

// A roster change moves the line that lateness is measured against, so the
// findings for those days are stale the moment it is saved.
async function recomputeForDates(userId, dates) {
  const list = (dates || []).filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (!userId || !list.length) return;
  try {
    await recomputeLateness({
      userIds: [userId],
      fromDate: addDays(list.reduce((a, b) => (a < b ? a : b)), -1),
      toDate: addDays(list.reduce((a, b) => (a > b ? a : b)), 1),
    });
  } catch (e) {
    console.error('[lateness] recompute failed:', e.message);
  }
}

// ---------------------------------------------------------------------------
// Web Push (browser notifications, delivered even when the app isn't open)
// ---------------------------------------------------------------------------
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const pushEnabled = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (pushEnabled) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
} else {
  console.warn('[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set — web push disabled.');
}

// ---------------------------------------------------------------------------
// Native push, Android app only (Firebase Cloud Messaging)
// ---------------------------------------------------------------------------
// A separate delivery channel from the Web Push above: the Android app is a
// Capacitor-wrapped WebView, which cannot register a service worker push
// subscription the way an actual mobile browser tab can. Reaching it when
// closed needs FCM instead — see nativePush.ts on the client and
// android/README.md for the full picture.
//
// The whole service-account JSON goes into one env var (its own file would
// need a volume mount Railway doesn't offer) — see android/KEYSTORE.md's
// sibling setup for where this comes from.
let fcmEnabled = false;
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({ credential: admin.cert(serviceAccount) });
    fcmEnabled = true;
  } catch (e) {
    console.error('[push] FIREBASE_SERVICE_ACCOUNT_JSON is set but invalid:', e.message);
  }
} else {
  console.warn('[push] FIREBASE_SERVICE_ACCOUNT_JSON not set — native Android push disabled.');
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
// The data layer is db.js (SQL Server). The application never issues DDL: every table, index and view comes from
// sql/schema.sql — run by the DBA / `npm run db:init`, or by the app itself when AUTO_INIT_DB=true.
const REQUIRED_OBJECTS = [
  'users', 'schedules', 'swap_requests', 'leave_requests', 'public_holidays', 'shift_templates', 'audit_log', 'notifications',
  'evaluations', 'breaks', 'break_freezes', 'overtime_sessions', 'kpi_targets', 'attendance', 'attendance_suppressed',
  'attendance_daily', 'sync_state', 'xontel_agent_map', 'xontel_sessions', 'xontel_calls', 'xontel_missed_calls',
  'xontel_callbacks', 'push_subscriptions', 'fcm_tokens', 'call_logs', 'sick_documents', 'call_recordings', '_migrations',
];
const QA_OBJECTS = ['qa_user_profile', 'qa_users', 'qa_evaluations', 'qa_attendance_records'];

async function initDb() {
  if (process.env.AUTO_INIT_DB === 'true') {
    const n = await initDatabase({ createDatabase: true });
    console.log(`[db] schema applied (${n} batches)`);
  }
  await verifySchema(process.env.QA_MODULE === 'off' ? REQUIRED_OBJECTS : [...REQUIRED_OBJECTS, ...QA_OBJECTS]);
  console.log('[db] schema ready');
}

// ---------------------------------------------------------------------------
// The one-off Firestore / week / department imports of the PostgreSQL edition are not part of this edition.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const genId = () => crypto.randomUUID();
const J = (obj) => JSON.stringify(obj);

// Strip the password before sending any user to the client.
function sanitizeUser(row) {
  const u = { ...row.data, id: row.id };
  delete u.password;
  return u;
}

async function getScheduleMap(client, userId) {
  const { rows } = await client.query('SELECT date, data FROM schedules WHERE user_id = $1', [userId]);
  const map = {};
  for (const r of rows) map[r.date] = r.data;
  return map;
}

async function getDay(client, userId, date) {
  const { rows } = await client.query('SELECT data FROM schedules WHERE user_id = $1 AND date = $2', [userId, date]);
  return rows[0] ? rows[0].data : undefined;
}

async function upsertDay(client, userId, date, data) {
  await client.query(
    `INSERT INTO schedules (user_id, date, data) VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (user_id, date) DO UPDATE SET data = EXCLUDED.data`,
    [userId, date, J({ ...data, date })]
  );
}

async function deleteDay(client, userId, date) {
  await client.query('DELETE FROM schedules WHERE user_id = $1 AND date = $2', [userId, date]);
}

// Resolve a user's display name (best-effort; falls back to the id).
async function getUserName(id) {
  try {
    const { rows } = await pool.query(`SELECT data->>'name' AS name FROM users WHERE id = $1`, [id]);
    return rows[0]?.name || id;
  } catch {
    return id;
  }
}

// Display names for day types (stored enum values never change).
const DAY_TYPE_LABELS = {
  TARDY: 'LATE',
  EARLY_LEAVE: 'LEAVE WITH PERMISSION',
  DELAY_WAS_PERMISSION: 'LATE WITH PERMISSION',
};
const dayTypeLabel = (t) => DAY_TYPE_LABELS[t] || String(t || '').replace(/_/g, ' ');

// Short human description of a schedule day for the audit summary.
function describeDay(day) {
  if (!day) return 'cleared';
  const ot = Number(day.overtimeHours) > 0 ? ` (+${day.overtimeHours}h overtime)` : '';
  if (day.shift && day.shift.startTime) {
    return `${dayTypeLabel(day.type)} ${day.shift.startTime}-${day.shift.endTime}${ot}`;
  }
  return (day.type ? dayTypeLabel(day.type) : 'updated') + ot;
}

// Record an audit-log entry. Never throws — logging must not break the action.
async function logAudit(req, { action, entityType, entityId, summary, details }) {
  try {
    await pool.query(
      `INSERT INTO audit_log (id, ts, actor_id, actor_name, action, entity_type, entity_id, summary, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        genId(),
        Date.now(),
        req.user?.id || null,
        req.user?.name || 'System',
        action,
        entityType || null,
        entityId || null,
        summary || null,
        J(details || {}),
      ]
    );
  } catch (e) {
    console.error('[audit] failed to record:', e.message);
  }
}

// Create an in-app notification for a user, and best-effort push it to their
// subscribed browsers so it shows even when the app/tab isn't open. Never throws.
async function notify(userId, type, title, body) {
  if (!userId) return;
  try {
    await pool.query(
      `INSERT INTO notifications (id, user_id, type, title, body, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [genId(), userId, type, title, body || null, Date.now()]
    );
  } catch (e) {
    console.error('[notify] failed:', e.message);
  }
  await pushToUser(userId, { title, body: body || '', type });
}

// Sends a Web Push message to every browser the user has subscribed on.
// Prunes subscriptions the push service reports as gone (410/404).
// Returns how many devices actually accepted the notification. Callers that
// record whether someone was reachable must use this count — every failure
// path here is swallowed, so "it didn't throw" says nothing about delivery.
// Every value in `payload` must already be a string — both delivery channels
// require that (FCM's data payload rejects anything else outright; the web
// side just JSON.stringifies it) — so this is a single contract both share.
async function pushToWeb(userId, payload) {
  if (!pushEnabled) return 0;
  try {
    const { rows } = await pool.query(
      'SELECT id, endpoint, keys FROM push_subscriptions WHERE user_id = $1',
      [userId]
    );
    if (!rows.length) return 0;
    const json = JSON.stringify(payload);
    const results = await Promise.all(rows.map(async (r) => {
      try {
        await webpush.sendNotification({ endpoint: r.endpoint, keys: r.keys }, json);
        return true;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [r.id]);
        } else {
          console.error('[push] web send failed:', e.message);
        }
        return false;
      }
    }));
    return results.filter(Boolean).length;
  } catch (e) {
    console.error('[push] web lookup failed:', e.message);
    return 0;
  }
}

// The Android app's own channel — see nativePush.ts and MainActivity's
// CALL_CHANNEL_ID. android.notification is only attached for calls: routing a
// routine notification (leave approved, schedule change) onto the loud,
// heads-up "Incoming calls" channel would make every notification behave like
// a phone ringing, not just calls.
async function pushToFcm(userId, payload) {
  if (!fcmEnabled) return 0;
  try {
    const { rows } = await pool.query('SELECT id, token FROM fcm_tokens WHERE user_id = $1', [userId]);
    if (!rows.length) return 0;
    const isCall = payload.type === 'call';
    const results = await Promise.all(rows.map(async (r) => {
      try {
        await getMessaging().send({
          token: r.token,
          notification: { title: payload.title, body: payload.body || '' },
          data: payload,
          android: {
            priority: 'high',
            ...(isCall ? { notification: { channelId: 'calls', sound: 'default' } } : {}),
          },
        });
        return true;
      } catch (e) {
        if (e.code === 'messaging/registration-token-not-registered' || e.code === 'messaging/invalid-registration-token') {
          await pool.query('DELETE FROM fcm_tokens WHERE id = $1', [r.id]);
        } else {
          console.error('[push] fcm send failed:', e.message);
        }
        return false;
      }
    }));
    return results.filter(Boolean).length;
  } catch (e) {
    console.error('[push] fcm lookup failed:', e.message);
    return 0;
  }
}

async function pushToUser(userId, payload) {
  const [web, fcm] = await Promise.all([pushToWeb(userId, payload), pushToFcm(userId, payload)]);
  return web + fcm;
}

// ---------------------------------------------------------------------------
// In-system voice calls — WebRTC signaling relay over WebSocket
// ---------------------------------------------------------------------------
// A call's live state lives only in this process's memory (`activeCalls`),
// not the database: it's a short-lived signaling session, not a record worth
// persisting past the "missed call" notification already written via notify().
// If this process restarts mid-call, the call simply drops — acceptable for
// a first version; nothing else in the app depends on call history.
const activeCalls = new Map(); // callId -> { callerId, callerName, calleeId, calleeName, offerSdp, status, declineToken, timer }
const wsClientsByUser = new Map(); // userId -> Set<WebSocket>

// How long a call rings before the caller is told nobody picked up.
const CALL_RING_TIMEOUT_MS = 45_000;
// Ping every connected socket this often. Must stay comfortably below the
// ~60s idle cutoff Railway's proxy applies, or long-open tabs get silently
// disconnected between calls.
const WS_HEARTBEAT_MS = 25_000;
// A web push fires once, so a closed app got a single blip where a phone call
// would ring. Re-sending it while the call is still ringing — combined with
// renotify in the service worker — re-alerts the phone each time, which is as
// close to a ringtone as the web allows.
const CALL_RING_REPEAT_MS = 9_000;
const CALL_RING_REPEATS = 4;
// Recordings are stored in Postgres, so they cost real money to keep. Anything
// older than this is deleted automatically — raise RECORDING_RETENTION_DAYS
// only with the storage bill in mind.
const RECORDING_RETENTION_DAYS = Number(process.env.RECORDING_RETENTION_DAYS) || 30;
const RECORDING_MAX_BYTES = 25 * 1024 * 1024;
const RETENTION_SWEEP_MS = 6 * 60 * 60 * 1000;

function wsSend(ws, obj) {
  try {
    if (ws.readyState !== ws.OPEN) return false;
    ws.send(JSON.stringify(obj));
    return true;
  } catch { return false; }
}

// Relays a message to every open tab/device a user currently has connected.
// Returns whether it actually reached at least one — a socket lingering in the
// set in a CLOSING/CLOSED state must not count as reachable, or a call gets
// reported as ringing when nothing was delivered.
function sendToUser(userId, obj) {
  const set = wsClientsByUser.get(userId);
  if (!set || !set.size) return false;
  let delivered = 0;
  for (const ws of set) if (wsSend(ws, obj)) delivered++;
  return delivered > 0;
}

function clearCallTimer(call) {
  if (call?.timer) clearTimeout(call.timer);
  // Stop the ring repeats too, so answering silences the phone rather than
  // leaving queued pushes to fire at someone already talking.
  if (call?.ringTimers) {
    for (const t of call.ringTimers) clearTimeout(t);
    call.ringTimers = [];
  }
}

// Call logging is best-effort: a failure to record history must never stop a
// call from connecting or hanging up.
async function logCallStart(callId, call, ringDelivered, pushSent) {
  try {
    await pool.query(
      `INSERT INTO call_logs (id, started_at, caller_id, caller_name, callee_id, callee_name, status, ring_delivered, push_sent)
       VALUES ($1,$2,$3,$4,$5,$6,'ringing',$7,$8)`,
      [callId, Date.now(), call.callerId, call.callerName, call.calleeId, call.calleeName, ringDelivered, pushSent],
    );
  } catch (e) { console.error('[call] log start failed:', e.message); }
}

async function logCallAnswered(callId, at) {
  try {
    await pool.query(`UPDATE call_logs SET status='answered', answered_at=$2 WHERE id=$1`, [callId, at]);
  } catch (e) { console.error('[call] log answer failed:', e.message); }
}

// A call that was answered is always 'answered' however it ended — the reason
// only decides the outcome of calls that never connected.
async function logCallEnd(callId, reason, endedByUserId) {
  try {
    const now = Date.now();
    await pool.query(
      `UPDATE call_logs
          SET ended_at = $2,
              ended_by = $3,
              status = CASE WHEN answered_at IS NOT NULL THEN 'answered' ELSE $4 END,
              duration_sec = CASE WHEN answered_at IS NOT NULL
                                  THEN GREATEST(0, (($2 - answered_at) / 1000)::INTEGER)
                                  ELSE 0 END
        WHERE id = $1 AND ended_at IS NULL`,
      [callId, now, endedByUserId || null, reason],
    );
  } catch (e) { console.error('[call] log end failed:', e.message); }
}

// Ends a call for both sides and forgets it. `reason` drives what each side
// is told: 'ended' (either side hung up), 'declined', 'missed' (ring timeout).
// `logAs` overrides the recorded outcome for cases the other side can't tell
// apart. Losing the connection looks identical to hanging up over the wire, but
// the log must not accuse someone of rejecting a call their network dropped.
function teardownCall(callId, reason, endedByUserId, logAs) {
  const call = activeCalls.get(callId);
  if (!call) return;
  clearCallTimer(call);
  activeCalls.delete(callId);
  // Hanging up a call that was still ringing is a cancel, not a normal end —
  // the log should not make it look like the two of them spoke.
  const outcome = logAs || (reason === 'ended' && call.status !== 'connected' ? 'canceled' : reason);
  logCallEnd(callId, outcome, endedByUserId);
  const payload = { type: `call:${reason}`, callId };
  if (endedByUserId !== call.callerId) sendToUser(call.callerId, payload);
  if (endedByUserId !== call.calleeId) sendToUser(call.calleeId, payload);
}

// Called when a caller's browser sends an SDP offer. Registers the call,
// relays it live to any of the callee's open tabs, and — regardless of
// whether they were reachable live — pushes an actionable notification so a
// closed app or locked phone still gets an "Incoming call" the user can
// answer or decline straight from the notification.
async function handleCallOffer(caller, calleeId, sdp) {
  if (calleeId === caller.id) return { error: 'You cannot call yourself.' };
  const callee = await getUserRow(calleeId);
  if (!callee) return { error: 'That employee could not be found.' };

  const callId = genId();
  const declineToken = genId();
  const call = {
    callerId: caller.id, callerName: caller.name,
    calleeId, calleeName: callee.name,
    offerSdp: sdp, status: 'ringing', declineToken,
  };
  call.timer = setTimeout(() => {
    const c = activeCalls.get(callId);
    if (!c || c.status !== 'ringing') return;
    activeCalls.delete(callId);
    logCallEnd(callId, 'missed', null);
    sendToUser(c.callerId, { type: 'call:missed', callId });
    sendToUser(c.calleeId, { type: 'call:missed', callId });
  }, CALL_RING_TIMEOUT_MS);
  activeCalls.set(callId, call);

  const ringDelivered = sendToUser(calleeId, {
    type: 'call:incoming', callId, callerId: caller.id, callerName: caller.name,
  });

  // Best-effort — a missing/misconfigured push setup must not block the call.
  // pushSent must mean "a device accepted it", not "the call didn't throw":
  // the admin log uses it to judge whether someone could have known.
  const ringPayload = {
    type: 'call', title: `${caller.name} is calling you`, body: 'Tap to answer',
    callId, callerId: caller.id, callerName: caller.name, declineToken,
  };

  let pushSent = false;
  try {
    const delivered = await pushToUser(calleeId, ringPayload);
    pushSent = delivered > 0;
  } catch (e) {
    console.error('[call] push failed:', e.message);
  }

  // Keep ringing. Each repeat stops the moment the call leaves 'ringing', so
  // answering or hanging up silences the phone immediately.
  if (pushSent) {
    call.ringTimers = [];
    for (let i = 1; i <= CALL_RING_REPEATS; i++) {
      call.ringTimers.push(setTimeout(() => {
        const c = activeCalls.get(callId);
        if (!c || c.status !== 'ringing') return;
        pushToUser(calleeId, ringPayload).catch(() => {});
      }, i * CALL_RING_REPEAT_MS));
    }
  }

  await logCallStart(callId, call, ringDelivered, pushSent);

  return { callId };
}

// ---------------------------------------------------------------------------
// TURN relay credentials (Twilio Network Traversal Service)
// ---------------------------------------------------------------------------
// Twilio's TURN credentials are deliberately short-lived, so the server mints
// them on demand and caches them. One token is shared by everyone until it
// nears expiry — that keeps the API calls to a couple a day rather than one
// per call setup.
const TWILIO_TOKEN_TTL_SEC = 14400;            // 4 hours
const TWILIO_REFRESH_EARLY_MS = 30 * 60 * 1000; // renew 30 min before expiry
let twilioIceCache = null;                      // { iceServers, expiresAt }
let cloudflareIceCache = null;

// Cloudflare Realtime TURN. Same ephemeral-credential model as Twilio and it
// already answers in the { iceServers } shape this endpoint returns.
async function getCloudflareIceServers() {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN;
  if (!keyId || !apiToken) return null;

  if (cloudflareIceCache && Date.now() < cloudflareIceCache.expiresAt - TWILIO_REFRESH_EARLY_MS) {
    return cloudflareIceCache.iceServers;
  }

  try {
    const resp = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: TWILIO_TOKEN_TTL_SEC }),
      },
    );
    if (!resp.ok) throw new Error(`Cloudflare responded ${resp.status}`);
    const data = await resp.json();
    const iceServers = data.iceServers;
    if (!Array.isArray(iceServers) || !iceServers.length) throw new Error('no iceServers in response');

    // Port 53 is blocked by Chrome and Firefox, so those URLs only cost the
    // browser a connection attempt that can never succeed. Match the port
    // exactly — a substring test would also strike out :5349, the TLS port
    // that restrictive networks depend on.
    const isPort53 = (u) => /:53(\?|$)/.test(u);
    const cleaned = iceServers.map((s) => {
      const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !isPort53(u));
      return { ...s, urls };
    }).filter((s) => s.urls.length);

    cloudflareIceCache = { iceServers: cleaned, expiresAt: Date.now() + TWILIO_TOKEN_TTL_SEC * 1000 };
    console.log(`[call] refreshed Cloudflare TURN credentials (${cleaned.length} servers)`);
    return cleaned;
  } catch (e) {
    console.error('[call] Cloudflare TURN credentials failed:', e.message);
    return cloudflareIceCache?.iceServers || null;
  }
}

async function getTwilioIceServers() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;

  if (twilioIceCache && Date.now() < twilioIceCache.expiresAt - TWILIO_REFRESH_EARLY_MS) {
    return twilioIceCache.iceServers;
  }

  try {
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Tokens.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ Ttl: String(TWILIO_TOKEN_TTL_SEC) }),
    });
    if (!resp.ok) throw new Error(`Twilio responded ${resp.status}`);
    const data = await resp.json();
    const iceServers = data.ice_servers || data.iceServers;
    if (!Array.isArray(iceServers) || !iceServers.length) throw new Error('no ice_servers in response');

    twilioIceCache = { iceServers, expiresAt: Date.now() + TWILIO_TOKEN_TTL_SEC * 1000 };
    console.log(`[call] refreshed Twilio TURN credentials (${iceServers.length} servers)`);
    return iceServers;
  } catch (e) {
    console.error('[call] Twilio TURN credentials failed:', e.message);
    // Serve a stale-but-probably-valid token rather than dropping to STUN only.
    return twilioIceCache?.iceServers || null;
  }
}

// Deletes recordings past the retention window. The call_logs rows stay — the
// history of who called whom is cheap; only the audio is expensive.
async function sweepOldRecordings() {
  try {
    const cutoff = Date.now() - RECORDING_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const { rowCount } = await pool.query('DELETE FROM call_recordings WHERE created_at < $1', [cutoff]);
    if (rowCount) console.log(`[call] retention sweep removed ${rowCount} recording(s) older than ${RECORDING_RETENTION_DAYS}d`);
  } catch (e) { console.error('[call] retention sweep failed:', e.message); }
}

// A restart forgets every in-flight call, which would otherwise leave rows
// open forever and make the admin log look like calls are still running.
async function closeDanglingCallLogs() {
  try {
    const { rowCount } = await pool.query(
      `UPDATE call_logs
          SET ended_at = started_at,
              status = CASE WHEN answered_at IS NOT NULL THEN 'answered' ELSE 'interrupted' END
        WHERE ended_at IS NULL`,
    );
    if (rowCount) console.log(`[call] closed ${rowCount} call log row(s) left open by a restart`);
  } catch (e) { console.error('[call] dangling log cleanup failed:', e.message); }
}

// Wrap async route handlers so thrown errors hit the error middleware.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------------------------------------------------------------------------
// Auth (JWT)
// ---------------------------------------------------------------------------
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
if (!process.env.JWT_SECRET) {
  console.warn('[auth] JWT_SECRET not set — using an insecure dev secret. Set JWT_SECRET in production.');
}
const MGMT = ['MANAGER', 'SUPERVISOR', 'ADMIN'];
// Roles that may write schedules (each within its own scope).
const BRANCH_MGMT = ['BRANCH_MANAGER', 'AREA_MANAGER', 'OPERATION_MANAGER'];
const SCHED_MGMT = [...MGMT, ...BRANCH_MGMT];
const BRANCH_ROLES = ['BRANCH_EMPLOYEE', ...BRANCH_MGMT];
const isBranchRole = (r) => BRANCH_ROLES.includes(r);
// Branch/area managers may additionally manage (create/edit/delete) their
// own employees' accounts — not just schedules. Operation Manager is not
// included here; it keeps schedule-only authority over the roles below it.
const BRANCH_USER_MGMT = ['BRANCH_MANAGER', 'AREA_MANAGER', 'OPERATION_MANAGER'];
const USER_MGMT = [...MGMT, ...BRANCH_USER_MGMT];

// ---- Scoping ----------------------------------------------------------------
// Two parallel hierarchies:
//  - Call-center: admin sees everything; supervisors/team-leaders/employees
//    are scoped to their own department (companyName).
//  - Field operations: branch employees/managers are scoped to one
//    (brand, branch); area managers to (brand, branches[]); operation
//    managers to brands[]. Branch users never see department users and
//    vice versa.
const isAdmin = (req) => req.user?.role === 'ADMIN';
const scopeDept = (req) => (isAdmin(req) ? null : (req.user?.companyName || '').trim().toLowerCase());
const nrm = (s) => String(s || '').trim().toLowerCase();

async function deptUserIdSet(dept) {
  if (!dept) return new Set();
  const { rows } = await pool.query(`SELECT id FROM users WHERE lower(trim(data->>'companyName')) = $1`, [dept]);
  return new Set(rows.map((r) => r.id));
}

// Fresh viewer record — branch/brand assignments live in the DB row, not
// the token, so permission edits apply without re-login.
async function getViewer(req) {
  const { rows } = await pool.query('SELECT id, data FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) return { id: req.user.id, role: req.user.role, companyName: req.user.companyName };
  return { id: rows[0].id, ...rows[0].data };
}

async function getUserRow(id) {
  const { rows } = await pool.query('SELECT id, data FROM users WHERE id = $1', [id]);
  return rows[0] ? { id: rows[0].id, ...rows[0].data } : null;
}

// Branch Managers responsible for a branch employee — the people notified
// when that employee starts or ends a break.
async function branchManagersFor(employee) {
  if (!employee?.brand || !employee?.branch) return [];
  const { rows } = await pool.query(
    `SELECT id, data FROM users WHERE data->>'role' = 'BRANCH_MANAGER'`
  );
  return rows
    .map((r) => ({ id: r.id, ...r.data }))
    .filter((m) => nrm(m.brand) === nrm(employee.brand) && nrm(m.branch) === nrm(employee.branch));
}

// Team Leaders and Supervisors over a call-centre employee's department —
// the people notified when that person clocks in or out.
async function deptManagersFor(employee) {
  const dept = nrm(employee?.companyName);
  if (!dept) return [];
  const { rows } = await pool.query(
    `SELECT id, data FROM users WHERE data->>'role' IN ('MANAGER', 'SUPERVISOR')`
  );
  return rows
    .map((r) => ({ id: r.id, ...r.data }))
    .filter((m) => nrm(m.companyName) === dept);
}

// May `viewer` see `t` (read access)?
function canSeeUser(viewer, t) {
  if (!viewer || !t) return false;
  if (viewer.role === 'ADMIN') return true;
  if (t.id === viewer.id) return true;
  if (!isBranchRole(viewer.role)) {
    // Department side: same company, department users only.
    return !isBranchRole(t.role) && !!nrm(t.companyName) && nrm(t.companyName) === nrm(viewer.companyName);
  }
  if (!isBranchRole(t.role)) return false;
  switch (viewer.role) {
    case 'BRANCH_EMPLOYEE':
    case 'BRANCH_MANAGER':
      return ['BRANCH_EMPLOYEE', 'BRANCH_MANAGER'].includes(t.role) &&
        nrm(t.brand) === nrm(viewer.brand) && nrm(t.branch) === nrm(viewer.branch);
    case 'AREA_MANAGER':
      return ['BRANCH_EMPLOYEE', 'BRANCH_MANAGER'].includes(t.role) &&
        nrm(t.brand) === nrm(viewer.brand) &&
        (viewer.branches || []).map(nrm).includes(nrm(t.branch));
    case 'OPERATION_MANAGER':
      return ['BRANCH_EMPLOYEE', 'BRANCH_MANAGER', 'AREA_MANAGER'].includes(t.role) &&
        (viewer.brands || []).map(nrm).includes(nrm(t.brand));
    default:
      return false;
  }
}

// May `viewer` write `t`'s schedule?
function canWriteSchedule(viewer, t) {
  if (!viewer || !t) return false;
  if (viewer.role === 'ADMIN') return true;
  if (!isBranchRole(viewer.role)) {
    // Department managers/supervisors write within their department.
    return ['MANAGER', 'SUPERVISOR'].includes(viewer.role) &&
      !isBranchRole(t.role) && nrm(t.companyName) === nrm(viewer.companyName);
  }
  // Every branch manager can schedule themselves, in addition to whoever
  // they manage below them.
  if (t.id === viewer.id) return true;
  switch (viewer.role) {
    case 'BRANCH_MANAGER':
      return t.role === 'BRANCH_EMPLOYEE' &&
        nrm(t.brand) === nrm(viewer.brand) && nrm(t.branch) === nrm(viewer.branch);
    case 'AREA_MANAGER':
      return ['BRANCH_EMPLOYEE', 'BRANCH_MANAGER'].includes(t.role) &&
        nrm(t.brand) === nrm(viewer.brand) &&
        (viewer.branches || []).map(nrm).includes(nrm(t.branch));
    case 'OPERATION_MANAGER':
      return ['BRANCH_EMPLOYEE', 'BRANCH_MANAGER', 'AREA_MANAGER'].includes(t.role) &&
        (viewer.brands || []).map(nrm).includes(nrm(t.brand));
    default:
      return false;
  }
}

// May `viewer` create/edit/delete `t`'s account? Mirrors canWriteSchedule
// for the three branch-hierarchy roles allowed to manage accounts (Branch
// Manager, Area Manager, Operation Manager) — each one level further up the
// chain than the accounts it manages.
function canManageUserAccount(viewer, t) {
  if (!viewer || !t) return false;
  if (viewer.role === 'ADMIN') return true;
  if (viewer.role === 'BRANCH_MANAGER') {
    return t.role === 'BRANCH_EMPLOYEE' &&
      nrm(t.brand) === nrm(viewer.brand) && nrm(t.branch) === nrm(viewer.branch);
  }
  if (viewer.role === 'AREA_MANAGER') {
    return ['BRANCH_EMPLOYEE', 'BRANCH_MANAGER'].includes(t.role) &&
      nrm(t.brand) === nrm(viewer.brand) &&
      (viewer.branches || []).map(nrm).includes(nrm(t.branch));
  }
  if (viewer.role === 'OPERATION_MANAGER') {
    return ['BRANCH_EMPLOYEE', 'BRANCH_MANAGER', 'AREA_MANAGER'].includes(t.role) &&
      (viewer.brands || []).map(nrm).includes(nrm(t.brand));
  }
  return false;
}

// Roles a given branch-account manager may assign to accounts they create/edit.
function assignableRolesFor(viewerRole) {
  if (viewerRole === 'BRANCH_MANAGER') return ['BRANCH_EMPLOYEE'];
  if (viewerRole === 'AREA_MANAGER') return ['BRANCH_EMPLOYEE', 'BRANCH_MANAGER'];
  if (viewerRole === 'OPERATION_MANAGER') return ['BRANCH_EMPLOYEE', 'BRANCH_MANAGER', 'AREA_MANAGER'];
  return [];
}
const roleLabelServer = (r) => (r === 'BRANCH_EMPLOYEE' ? 'Branch Employee' : r === 'BRANCH_MANAGER' ? 'Branch Manager' : r === 'AREA_MANAGER' ? 'Area Manager' : r);

// Is the target user within the requester's read scope? Admin => always.
async function inScope(req, userId) {
  if (isAdmin(req)) return true;
  const viewer = await getViewer(req);
  const t = await getUserRow(userId);
  return canSeeUser(viewer, t);
}

// Is the target user within the requester's schedule-write scope?
async function inWriteScope(req, userId) {
  if (isAdmin(req)) return true;
  const viewer = await getViewer(req);
  const t = await getUserRow(userId);
  return canWriteSchedule(viewer, t);
}

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      name: user.name,
      username: user.username,
      companyName: user.companyName,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// Require a valid token; populates req.user.
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

// Require the authenticated user to hold one of the given roles.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
// Railway terminates TLS in front of us, so without this req.protocol is
// always "http" and any URL we build for the client (e.g. the attendance QR)
// would point at http:// and get redirected.
app.set('trust proxy', 1);
// The API is almost entirely JSON responses re-fetched every few seconds by
// polling clients; gzip cuts that egress by ~80-90% for essentially free.
app.use(compression());
// Quality (QA) module: its own 20mb JSON parser (evaluation images), so it is mounted before the 2mb one below.
// Needs `npm run build:qa` (part of npm run build). QA_MODULE=off disables it.
if (process.env.QA_MODULE !== 'off') {
  try {
    const { createQaModule } = await import('./qa-dist/qa.mjs');
    app.use('/api/qa', await createQaModule({ connectionString: process.env.DATABASE_URL, ssl: sslConfig(), authenticate }));
    console.log('[qa] Quality module mounted at /api/qa');
  } catch (e) {
    console.error('[qa] Quality module NOT loaded:', e?.message || e);
  }
}
app.use(express.json({ limit: '2mb' }));

const api = express.Router();

// ---- Public routes (no auth) ----------------------------------------------
api.get('/health', (req, res) => res.json({ ok: true }));

api.get('/setup-status', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  res.json({ needsSetup: rows[0].n === 0 });
}));

api.post('/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const { rows } = await pool.query(`SELECT id, data FROM users WHERE data->>'username' = $1`, [username]);
  const row = rows[0];
  if (!row) return res.json({ user: null });
  const ok = await bcrypt.compare(String(password || ''), String(row.data.password || ''));
  if (!ok) return res.json({ user: null });
  const user = sanitizeUser(row);
  res.json({ user, token: signToken(user) });
}));

// Create the very first supervisor — allowed only while the DB has no users.
api.post('/bootstrap-supervisor', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n > 0) return res.status(403).json({ error: 'Setup already complete' });
  const body = { ...req.body };
  const id = body.id || genId();
  delete body.id;
  body.role = 'SUPERVISOR';
  body.password = await bcrypt.hash(String(body.password || ''), 10);
  await pool.query('INSERT INTO users (id, data) VALUES ($1, $2::jsonb)', [id, J(body)]);
  const user = sanitizeUser({ id, data: body });
  res.json({ user, token: signToken(user) });
}));

// Declines an incoming call straight from the push notification's "Decline"
// button — the service worker that handles it has no session token to send,
// so the single-use, call-scoped token minted when the call started is the
// credential instead. Deliberately public (before the auth gate below).
// Purely diagnostic: records what the browser reported for a tap that was not
// a decline, so the answer path can be checked against real devices.
api.post('/calls/answer-tap', wrap(async (req, res) => {
  const { callId, token, action } = req.body || {};
  const call = activeCalls.get(callId);
  if (call && call.declineToken === token) {
    console.log(`[call] ${callId} answer tap from a notification (browser reported action="${action}")`);
  }
  res.json({ ok: true });
}));

api.post('/calls/decline', wrap(async (req, res) => {
  const { callId, token } = req.body || {};
  const call = activeCalls.get(callId);
  if (!call || call.declineToken !== token) return res.status(404).json({ error: 'Call not found.' });
  console.log(`[call] ${callId} declined from a notification (browser reported action="${req.body?.action}")`);
  teardownCall(callId, 'declined', call.calleeId);
  res.json({ success: true });
}));

// ---- Fingerprint terminal sync ---------------------------------------------
// The ZKTeco terminal sits on the office LAN and cannot reach this server, so a
// small bridge program on an office machine reads it and posts punches here.
// That bridge is a machine, not a person: it authenticates with a shared key
// rather than a login, which is why this sits above the JWT gate.
//
// Punches are re-sent on every sync rather than tracked incrementally, so a
// bridge that was offline, restarted, or ran twice converges to the same
// result instead of duplicating or losing anything.
api.post('/attendance/device-sync', wrap(async (req, res) => {
  if (!ATTENDANCE_BRIDGE_KEY) {
    return res.status(503).json({ error: 'Device sync is not enabled on this server.' });
  }
  if (req.get('X-Bridge-Key') !== ATTENDANCE_BRIDGE_KEY) {
    return res.status(401).json({ error: 'Invalid bridge key.' });
  }

  const punches = Array.isArray(req.body?.punches) ? req.body.punches : null;
  if (!punches) return res.status(400).json({ error: 'Expected { punches: [...] }.' });
  if (punches.length > 20000) return res.status(413).json({ error: 'Too many punches in one batch.' });

  // employeeId is how the terminal and Swipr refer to the same person; anyone
  // enrolled on the device but not carrying that number here is skipped rather
  // than guessed at.
  const { rows: userRows } = await pool.query(
    `SELECT id, data FROM users WHERE coalesce(data->>'employeeId','') <> ''`
  );
  const byEmployeeId = new Map();
  for (const r of userRows) byEmployeeId.set(String(r.data.employeeId).trim(), { id: r.id, ...r.data });

  // Group by person. Pairing used to reset at each calendar day, which broke
  // every shift that crosses midnight: a 6pm->2am worker's 2am clock-out
  // became the first punch of a new day and was recorded as a clock-IN, so
  // the board showed them "on site" from 2am with no out — see
  // pairIntoShifts for the rule that replaces it.
  const people = new Map();
  const unknown = new Set();
  for (const p of punches) {
    const employeeId = String(p.employeeId ?? '').trim();
    const ts = Number(p.ts);
    if (!employeeId || !Number.isFinite(ts)) continue;
    const user = byEmployeeId.get(employeeId);
    if (!user) { unknown.add(employeeId); continue; }
    if (!people.has(user.id)) people.set(user.id, { user, times: [], kinds: new Map() });
    const entry = people.get(user.id);
    entry.times.push(ts);
    // The terminal states check-in vs check-out per punch. Trust it when it
    // is sent; pairIntoShifts only guesses for punches that arrive without it.
    if (p.kind === 'IN' || p.kind === 'OUT') entry.kinds.set(ts, p.kind);
  }

  let written = 0;
  let notified = 0;
  const liveCutoff = Date.now() - 15 * 60 * 1000;
  // Which people and which days this batch touched, so the lateness engine
  // recomputes exactly that much rather than the whole history every 5 minutes.
  const touchedUsers = new Set();
  let touchedFrom = null, touchedTo = null;

  for (const { user, times, kinds } of people.values()) {
    const isCallCentre = !isBranchRole(user.role);
    const unit = isCallCentre
      ? (user.companyName || '')
      : [user.brand, user.branch].filter(Boolean).join(' · ');

    // A shift is paired from the punches around it, so the recompute window
    // has to hold the WHOLE chain a batch touches, not a fixed distance on
    // each side. Punches chain into one shift as long as each is under
    // SHIFT_GAP_MS from the last, and such a chain can run for days — a
    // window of exactly one gap catches it mid-way and re-pairs it starting
    // a punch late, flipping every kind in the chain (this is what broke a
    // 6-punch chain that straddled a batch boundary). So the window walks
    // outward through stored punches until the gap to the next one is a
    // real shift boundary, and only then stops.
    let lo = Math.min(...times) - SHIFT_GAP_MS;
    let hi = Math.max(...times) + SHIFT_GAP_MS;
    for (;;) {
      const { rows: edge } = await pool.query(
        `SELECT ts FROM attendance WHERE user_id = $1 AND id LIKE 'fp-%' AND ts >= $2 AND ts <= $3 ORDER BY ts`,
        [user.id, lo, hi]
      );
      if (!edge.length) break;
      const first = Number(edge[0].ts), last = Number(edge[edge.length - 1].ts);
      const newLo = first - SHIFT_GAP_MS, newHi = last + SHIFT_GAP_MS;
      // Converged: the outermost stored punches are already a full gap
      // inside the window, so nothing beyond them can chain in.
      if (newLo >= lo && newHi <= hi) break;
      lo = Math.min(lo, newLo);
      hi = Math.max(hi, newHi);
    }

    // Merge with what is already stored in that window, don't replace it. A
    // person's punches can straddle two batches of one sync; rebuilding from
    // a single batch silently dropped the other batch's punches. Merging is
    // still idempotent, and it means history survives the terminal's own
    // memory rolling over.
    const { rows: stored } = await pool.query(
      `SELECT ts, kind FROM attendance WHERE user_id = $1 AND id LIKE 'fp-%' AND ts >= $2 AND ts <= $3`,
      [user.id, lo, hi]
    );
    // Stored labels are NOT fed back into the tie-break. A stored kind is
    // itself an inference from an earlier batch, and a batch boundary can
    // leave a shift's first punch alone in one batch — paired as a lone
    // punch — with its mates arriving in the next. Feeding that stale guess
    // back in let it override the correct alternation once the whole shift
    // was present. Only the device's own label (sent with this batch) is
    // evidence; everything else is recomputed from scratch each time.
    // Punches an admin deleted must stay deleted — see DELETE /attendance/:id.
    const { rows: suppressedRows } = await pool.query(
      'SELECT ts FROM attendance_suppressed WHERE user_id = $1 AND ts >= $2 AND ts <= $3',
      [user.id, lo, hi]
    );
    const suppressed = new Set(suppressedRows.map((r) => Number(r.ts)));
    const sorted = [...new Set([...times, ...stored.map((r) => Number(r.ts))])]
      .filter((t) => !suppressed.has(t))
      .sort((a, b) => a - b);

    // Alternation decides; the device's own labels only break the tie on a
    // single-punch shift — see pairIntoShifts for why they can't be trusted
    // outright.
    const paired = pairIntoShifts(sorted, kinds);

    // Terminal rows only (never the QR ones, which carry different ids).
    //
    // Delete and re-insert go in one transaction. They rebuild the same
    // punches, but between the two statements the window is momentarily empty,
    // and anything reading then — the attendance board, or the lateness
    // engine — would see a person who never clocked in. One multi-row INSERT
    // rather than one per punch: a full re-import rewrites a person's whole
    // history in each batch, and at a round-trip apiece that ran past the
    // client's timeout.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM attendance WHERE user_id = $1 AND id LIKE 'fp-%' AND ts >= $2 AND ts <= $3`,
        [user.id, lo, hi]
      );
      if (paired.length) {
        await client.query(
          `INSERT INTO attendance (id, user_id, kind, ts, brand, branch, department)
           SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::bigint[], $5::text[], $6::text[], $7::text[])
           ON CONFLICT (id) DO NOTHING`,
          [
            paired.map((p) => `fp-${user.id}-${dayKeyInAppTz(p.ts)}-${p.ts}`),
            paired.map(() => user.id),
            paired.map((p) => p.kind),
            paired.map((p) => p.ts),
            paired.map(() => (isCallCentre ? '' : (user.brand || ''))),
            paired.map(() => (isCallCentre ? '' : (user.branch || ''))),
            paired.map(() => (isCallCentre ? unit : null)),
          ]
        );
        written += paired.length;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    touchedUsers.add(user.id);
    for (const t of [lo, hi]) {
      const d = dayKeyInAppTz(t);
      if (!touchedFrom || d < touchedFrom) touchedFrom = d;
      if (!touchedTo || d > touchedTo) touchedTo = d;
    }

    // Only a punch that just happened is worth telling anyone about —
    // importing history must not fire thousands of stale notifications.
    for (const { ts, kind } of paired) {
      if (ts < liveCutoff) continue;
      const watchers = isCallCentre ? await deptManagersFor(user) : await branchManagersFor(user);
      await Promise.all(watchers.map((m) =>
        notify(m.id, 'attendance', `${user.name} clocked ${kind === 'IN' ? 'in' : 'out'}`,
          `At ${fmtClock(ts)} · ${unit || 'fingerprint'}`)
      ));
      notified++;
    }
  }

  // Recorded before the recompute, because the engine reads it to decide
  // whether silence on a shift means "absent" or only "not reported yet".
  const newestPunch = punches.reduce((m, p) => Math.max(m, Number(p.ts) || 0), 0);
  await pool.query(
    `INSERT INTO sync_state (id, last_sync_at, last_punch_ts, detail)
     VALUES ('fingerprint', $1, $2, $3::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       last_sync_at = EXCLUDED.last_sync_at,
       last_punch_ts = GREATEST(coalesce(sync_state.last_punch_ts, 0), EXCLUDED.last_punch_ts),
       detail = EXCLUDED.detail`,
    [Date.now(), newestPunch, J({ received: punches.length, written, people: people.size, unknown: [...unknown] })]
  );

  // Lateness is derived from the punches that just landed. Failing to derive
  // it must never fail the sync itself — the punches are the valuable part.
  let lateness = null;
  if (touchedUsers.size && touchedFrom && touchedTo) {
    try {
      lateness = await recomputeLateness({
        userIds: [...touchedUsers], fromDate: touchedFrom, toDate: touchedTo,
      });
    } catch (e) {
      console.error('[lateness] recompute failed:', e.message);
    }
  }

  console.log(`[fingerprint] synced ${written} punch(es) for ${people.size} person(s); ${unknown.size} unknown id(s)` +
    (lateness ? `; lateness rows ${lateness.rows}` : ''));
  res.json({
    received: punches.length,
    written,
    people: people.size,
    notified,
    unknownEmployeeIds: [...unknown],
    lateness,
  });
}));

// ---- Everything below this line requires a valid token --------------------
api.use(authenticate);

// Supervisors may request a read-only global view (?all=1) of users and
// schedules; every write stays department-scoped via inScope/scopeDept.
const readAll = (req) => isAdmin(req) || (req.user?.role === 'SUPERVISOR' && req.query.all === '1');

// ---- Users ----------------------------------------------------------------
// Lets a client holding only a valid token rebuild its session. Without this,
// losing the cached user object in browser storage — which a phone can do on
// its own — forced a fresh login even though the token was still good.
api.get('/me', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, data FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) return res.status(401).json({ error: 'Account no longer exists.' });
  res.json(sanitizeUser(rows[0]));
}));

api.get('/users', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, data FROM users');
  if (readAll(req)) return res.json(rows.map(sanitizeUser));
  const viewer = await getViewer(req);
  res.json(rows.filter((r) => canSeeUser(viewer, { id: r.id, ...r.data })).map(sanitizeUser));
}));

// ---- Branch directory (Branch Schedule page) -------------------------------
// Company-wide, read-only, visible to EVERY authenticated account regardless
// of role or department/branch scope — by design, unlike every other
// /users or /schedules read above.
api.get('/branch-directory', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, data FROM users WHERE data->>'role' = ANY($1)`,
    [BRANCH_ROLES]
  );
  res.json(rows.map(sanitizeUser));
}));

// ---- Department directory (Staff Directory page) ---------------------------
// The mirror of /branch-directory: branch staff had no way to find anyone on
// the call-center / technical side, so calls could only ever go one way.
// Deliberately a MINIMAL projection — reaching someone in-app needs a name and
// an id, not the personal phone number of every agent in the company.
api.get('/staff-directory', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, data FROM users
      WHERE NOT (data->>'role' = ANY($1))
        AND data->>'role' <> 'ADMIN'
        AND COALESCE(data->>'name', '') <> ''`,
    [BRANCH_ROLES],
  );
  res.json(rows.map((r) => ({
    id: r.id,
    name: r.data.name,
    role: r.data.role,
    department: r.data.companyName || '',
    jobTitle: r.data.jobTitle || '',
  })));
}));

api.get('/branch-schedules', wrap(async (req, res) => {
  const usersR = await pool.query(`SELECT id FROM users WHERE data->>'role' = ANY($1)`, [BRANCH_ROLES]);
  const ids = new Set(usersR.rows.map((r) => r.id));
  const schedR = await pool.query('SELECT user_id, date, data FROM schedules');
  const out = {};
  for (const r of schedR.rows) {
    if (!ids.has(r.user_id)) continue;
    (out[r.user_id] ||= {})[r.date] = r.data;
  }
  res.json(out);
}));

api.post('/users', requireRole(...USER_MGMT), wrap(async (req, res) => {
  const body = { ...req.body };
  const id = body.id || genId();
  delete body.id;
  if (!isAdmin(req)) {
    if (body.role === 'ADMIN') return res.status(403).json({ error: 'Only an admin can create an admin.' });

    if (BRANCH_USER_MGMT.includes(req.user.role)) {
      // Branch/Area/Operation Manager: may only create their directly-managed
      // roles, within their own brand (and, below Operation Manager, their
      // assigned branches).
      const viewer = await getViewer(req);
      const allowed = assignableRolesFor(viewer.role);
      if (!allowed.includes(body.role)) {
        return res.status(403).json({ error: `You can only add ${allowed.map(roleLabelServer).join(' or ')} accounts.` });
      }
      if (viewer.role === 'OPERATION_MANAGER') {
        // Operation Manager owns whole brands, not one fixed branch.
        if (!(viewer.brands || []).map(nrm).includes(nrm(body.brand))) {
          return res.status(403).json({ error: 'You can only add users to your assigned brand(s).' });
        }
      } else {
        if (nrm(body.brand) !== nrm(viewer.brand)) {
          return res.status(403).json({ error: 'You can only add users to your own brand.' });
        }
        const branchOk = viewer.role === 'BRANCH_MANAGER'
          ? nrm(body.branch) === nrm(viewer.branch)
          : (viewer.branches || []).map(nrm).includes(nrm(body.branch));
        if (!branchOk) {
          return res.status(403).json({ error: 'You can only add users to your assigned branch(es).' });
        }
      }
    } else if (isBranchRole(body.role)) {
      return res.status(403).json({ error: 'Only an admin can create branch roles.' });
    } else if ((body.companyName || '').trim().toLowerCase() !== scopeDept(req)) {
      return res.status(403).json({ error: 'You can only add users to your own department.' });
    }
  }
  body.password = await bcrypt.hash(String(body.password || ''), 10);
  await pool.query(
    `INSERT INTO users (id, data) VALUES ($1, $2::jsonb)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [id, J(body)]
  );
  await logAudit(req, { action: 'user.create', entityType: 'user', entityId: id, summary: `Added ${body.name || ''} (${body.role || 'EMPLOYEE'})` });
  res.json(sanitizeUser({ id, data: body }));
}));

api.put('/users/:id', requireRole(...USER_MGMT), wrap(async (req, res) => {
  const id = req.params.id;
  const { rows } = await pool.query('SELECT data FROM users WHERE id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });

  const existing = rows[0].data;
  const incoming = { ...req.body };
  delete incoming.id;

  if (!isAdmin(req)) {
    if (incoming.role === 'ADMIN') return res.status(403).json({ error: 'Only an admin can grant admin.' });

    if (BRANCH_USER_MGMT.includes(req.user.role)) {
      const viewer = await getViewer(req);
      if (!canManageUserAccount(viewer, { id, ...existing })) {
        return res.status(403).json({ error: 'Out of your scope.' });
      }
      const allowed = assignableRolesFor(viewer.role);
      const targetRole = incoming.role || existing.role;
      if (!allowed.includes(targetRole)) {
        return res.status(403).json({ error: `You can only manage ${allowed.map(roleLabelServer).join(' or ')} accounts.` });
      }
      const targetBrand = incoming.brand !== undefined ? incoming.brand : existing.brand;
      if (viewer.role === 'OPERATION_MANAGER') {
        if (!(viewer.brands || []).map(nrm).includes(nrm(targetBrand))) {
          return res.status(403).json({ error: 'You cannot move users outside your assigned brand(s).' });
        }
      } else {
        const targetBranch = incoming.branch !== undefined ? incoming.branch : existing.branch;
        if (nrm(targetBrand) !== nrm(viewer.brand)) {
          return res.status(403).json({ error: 'You cannot move users to another brand.' });
        }
        const branchOk = viewer.role === 'BRANCH_MANAGER'
          ? nrm(targetBranch) === nrm(viewer.branch)
          : (viewer.branches || []).map(nrm).includes(nrm(targetBranch));
        if (!branchOk) {
          return res.status(403).json({ error: 'You cannot move users outside your assigned branch(es).' });
        }
      }
    } else if (isBranchRole(existing.role)) {
      return res.status(403).json({ error: 'Only an admin can manage branch roles.' });
    } else {
      if ((existing.companyName || '').trim().toLowerCase() !== scopeDept(req)) {
        return res.status(403).json({ error: 'Out of your department.' });
      }
      if (isBranchRole(incoming.role)) return res.status(403).json({ error: 'Only an admin can grant branch roles.' });
      if (incoming.companyName && incoming.companyName.trim().toLowerCase() !== scopeDept(req)) {
        return res.status(403).json({ error: 'You cannot move users to another department.' });
      }
    }
  }

  // Preserve the existing password hash unless a new password was supplied.
  if (incoming.password) {
    incoming.password = await bcrypt.hash(String(incoming.password), 10);
  } else {
    incoming.password = existing.password;
  }

  const merged = { ...existing, ...incoming };
  await pool.query('UPDATE users SET data = $2::jsonb WHERE id = $1', [id, J(merged)]);
  await logAudit(req, { action: 'user.update', entityType: 'user', entityId: id, summary: `Edited account ${merged.name || ''}` });
  res.json(sanitizeUser({ id, data: merged }));
}));

api.delete('/users/:id', requireRole(...USER_MGMT), wrap(async (req, res) => {
  const id = req.params.id;
  if (BRANCH_USER_MGMT.includes(req.user.role) && !isAdmin(req)) {
    const viewer = await getViewer(req);
    const t = await getUserRow(id);
    if (!canManageUserAccount(viewer, t)) return res.status(403).json({ error: 'Out of your scope.' });
  } else if (!(await inScope(req, id))) {
    return res.status(403).json({ error: 'Out of your department.' });
  }
  const name = await getUserName(id);
  await pool.query('DELETE FROM users WHERE id = $1', [id]);
  await pool.query('DELETE FROM schedules WHERE user_id = $1', [id]);
  await logAudit(req, { action: 'user.delete', entityType: 'user', entityId: id, summary: `Removed employee ${name}` });
  res.status(204).end();
}));

// Self-service password change (any authenticated user, own account only).
api.post('/change-password', wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword) return res.status(400).json({ error: 'newPassword required' });
  const { rows } = await pool.query('SELECT data FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  const ok = await bcrypt.compare(String(currentPassword || ''), String(rows[0].data.password || ''));
  if (!ok) return res.status(403).json({ error: 'Current password is incorrect' });
  const merged = { ...rows[0].data, password: await bcrypt.hash(String(newPassword), 10) };
  await pool.query('UPDATE users SET data = $2::jsonb WHERE id = $1', [req.user.id, J(merged)]);
  await logAudit(req, { action: 'user.password', entityType: 'user', entityId: req.user.id, summary: 'Changed own password' });
  res.json({ success: true });
}));

// ---- Schedules ------------------------------------------------------------
api.get('/schedules', wrap(async (req, res) => {
  const rows = (await pool.query('SELECT user_id, date, data FROM schedules')).rows;
  let allowed = null; // null => everything
  if (!readAll(req)) {
    const viewer = await getViewer(req);
    const usersR = await pool.query('SELECT id, data FROM users');
    allowed = new Set(usersR.rows.filter((r) => canSeeUser(viewer, { id: r.id, ...r.data })).map((r) => r.id));
  }
  const out = {};
  for (const r of rows) {
    if (allowed && !allowed.has(r.user_id)) continue;
    (out[r.user_id] ||= {})[r.date] = r.data;
  }
  res.json(out);
}));

api.get('/schedules/:userId', wrap(async (req, res) => {
  if (!(await inScope(req, req.params.userId))) return res.status(403).json({ error: 'Out of your department.' });
  const client = await pool.connect();
  try {
    res.json(await getScheduleMap(client, req.params.userId));
  } finally {
    client.release();
  }
}));

// Merge a single day with whatever already exists (used by edit + historical).
api.put('/schedules/:userId/day', requireRole(...SCHED_MGMT), wrap(async (req, res) => {
  const { date, data } = req.body || {};
  if (!date) return res.status(400).json({ error: 'date required' });
  if (!(await inWriteScope(req, req.params.userId))) return res.status(403).json({ error: 'Out of your scope.' });
  const client = await pool.connect();
  try {
    const existing = await getDay(client, req.params.userId, date);
    const merged = { ...(existing || {}), ...data, date };
    await upsertDay(client, req.params.userId, date, merged);
    const empName = await getUserName(req.params.userId);
    await logAudit(req, { action: 'schedule.update', entityType: 'schedule', entityId: req.params.userId, summary: `Set ${empName} on ${date} → ${describeDay(merged)}`, details: { date, type: merged.type } });
    if (req.params.userId !== req.user?.id) await notify(req.params.userId, 'shift', 'Your shift was updated', `${date} → ${describeDay(merged)}`);
    // The roster is the line lateness is measured against, so moving it makes
    // that day's finding stale immediately.
    await recomputeForDates(req.params.userId, [date]);
    res.json(merged);
  } finally {
    client.release();
  }
}));

// Replace a batch of days entirely.
api.post('/schedules/:userId/batch', requireRole(...SCHED_MGMT), wrap(async (req, res) => {
  if (!(await inWriteScope(req, req.params.userId))) return res.status(403).json({ error: 'Out of your scope.' });
  const batch = (req.body && req.body.batch) || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [date, data] of Object.entries(batch)) {
      await upsertDay(client, req.params.userId, date, data);
    }
    await client.query('COMMIT');
    const empName = await getUserName(req.params.userId);
    await logAudit(req, { action: 'schedule.batch', entityType: 'schedule', entityId: req.params.userId, summary: `Updated ${empName}'s schedule for ${Object.keys(batch).length} day(s)` });
    if (req.params.userId !== req.user?.id) await notify(req.params.userId, 'shift', 'Your schedule was updated', `${Object.keys(batch).length} day(s) changed`);
    await recomputeForDates(req.params.userId, Object.keys(batch));
    res.status(204).end();
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

// Clear a list of days.
api.post('/schedules/:userId/clear', requireRole(...SCHED_MGMT), wrap(async (req, res) => {
  if (!(await inWriteScope(req, req.params.userId))) return res.status(403).json({ error: 'Out of your scope.' });
  const dates = (req.body && req.body.dates) || [];
  if (dates.length) {
    await pool.query('DELETE FROM schedules WHERE user_id = $1 AND date = ANY($2)', [req.params.userId, dates]);
  }
  const empName = await getUserName(req.params.userId);
  await logAudit(req, { action: 'schedule.clear', entityType: 'schedule', entityId: req.params.userId, summary: `Cleared ${dates.length} day(s) for ${empName}` });
  if (req.params.userId !== req.user?.id) await notify(req.params.userId, 'shift', 'Your shifts were cleared', `${dates.length} day(s)`);
  await recomputeForDates(req.params.userId, dates);
  res.status(204).end();
}));

// Copy a week's schedule from one start date to another for the given users.
const addDaysStr = (dateStr, n) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};

// What survives being copied into a future week. A day is a plan going
// forward, but TARDY / EARLY_LEAVE / LATE-WITH-PERMISSION are records of what
// already happened, and `minutes` / `overtimeHours` are the measurements that
// go with them. Copying them forward pre-declared that someone would be late
// next Tuesday and, once lateness is confirmed automatically, would have
// multiplied every confirmed finding across every week it was copied into.
const RECORDED_DAY_TYPES = new Set(['TARDY', 'EARLY_LEAVE', 'DELAY_WAS_PERMISSION']);
function forwardPlannable(day) {
  const next = { ...day, id: genId() };
  if (RECORDED_DAY_TYPES.has(next.type)) next.type = 'NORMAL_SHIFT';
  delete next.minutes;
  delete next.overtimeHours;
  return next;
}

api.post('/schedules/copy-week', requireRole(...SCHED_MGMT), wrap(async (req, res) => {
  const { fromStart, toStart } = req.body || {};
  let { userIds } = req.body || {};
  if (!fromStart || !toStart || !Array.isArray(userIds)) {
    return res.status(400).json({ error: 'fromStart, toStart and userIds[] required' });
  }
  // Restrict to the requester's write scope (admins keep all).
  if (!isAdmin(req)) {
    const viewer = await getViewer(req);
    const usersR = await pool.query('SELECT id, data FROM users');
    const allowed = new Set(
      usersR.rows.filter((r) => canWriteSchedule(viewer, { id: r.id, ...r.data })).map((r) => r.id)
    );
    userIds = userIds.filter((id) => allowed.has(id));
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let copied = 0;
    for (const userId of userIds) {
      const src = await getScheduleMap(client, userId);
      for (let i = 0; i < 7; i++) {
        const srcDate = addDaysStr(fromStart, i);
        const day = src[srcDate];
        if (!day) continue;
        const dstDate = addDaysStr(toStart, i);
        await upsertDay(client, userId, dstDate, forwardPlannable(day));
        copied++;
      }
    }
    await client.query('COMMIT');
    await logAudit(req, { action: 'schedule.copy_week', entityType: 'schedule', summary: `Copied week ${fromStart} → ${toStart} for ${userIds.length} employee(s) (${copied} days)`, details: { fromStart, toStart, copied } });
    for (const uid of userIds) { if (uid !== req.user?.id) await notify(uid, 'shift', 'Your week schedule was updated', `Week of ${toStart}`); }
    res.json({ copied });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

// Parse a natural-language (Arabic/English) instruction into a weekly schedule
// for one employee, via Gemini. Returns a preview only — nothing is saved.
api.post('/schedule/parse', requireRole(...SCHED_MGMT), wrap(async (req, res) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ error: 'AI scheduling not configured (missing GEMINI_API_KEY).' });
  const { text, weekStart } = req.body || {};
  if (!text || !weekStart) return res.status(400).json({ error: 'text and weekStart required' });

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const week = dayNames.map((day, i) => ({ day, date: addDaysStr(weekStart, i) }));

  // Supervisors/admins can also AI-schedule team leaders, mirroring the roster;
  // field-operations managers get their branch hierarchy as match candidates.
  const parseRoles = ['EMPLOYEE'];
  if (req.user?.role === 'SUPERVISOR' || req.user?.role === 'ADMIN') parseRoles.push('MANAGER');
  if (BRANCH_MGMT.includes(req.user?.role)) parseRoles.push('BRANCH_EMPLOYEE', 'BRANCH_MANAGER', 'AREA_MANAGER');
  const { rows } = await pool.query(`SELECT id, data->>'name' AS name FROM users WHERE data->>'role' = ANY($1)`, [parseRoles]);
  const employees = rows.filter((r) => r.name);

  const prompt = `You convert a manager's natural-language instruction (Arabic or English) into a one-week shift schedule for ONE employee.

Week (use these exact dates):
${week.map((w) => `${w.day} = ${w.date}`).join('\n')}

Employees (match the named person to the closest one and return their id):
${employees.map((e) => `${e.id} :: ${e.name}`).join('\n')}

Rules:
- "type" is one of: NORMAL_SHIFT, WORK_FROM_HOME, DAY_OFF, ANNUAL_LEAVE, PUBLIC_HOLIDAY, SICK, ABSENT, TRAINING, TASK.
- Working shift => NORMAL_SHIFT with startTime and endTime as 24h "HH:mm".
- Times: interpret sensibly for a call center. "من 4 الى 12" evening usually = 16:00 to 00:00; if ambiguous, note it in "note".
- Any day not mentioned => DAY_OFF.
- "اجازة"/"اجازه"/"off"/"day off" => DAY_OFF ; "اجازة سنوية" => ANNUAL_LEAVE ; "مرضي"/"sick" => SICK ; "من البيت"/"wfh" => WORK_FROM_HOME.
- APPLY PER-DAY EXCEPTIONS even when a general pattern is given. A specific named day OVERRIDES the general pattern.
  Example: "طول الاسبوع من 4 الى 12 ويوم السبت اجازة" => Sunday..Friday = NORMAL_SHIFT 16:00-00:00, Saturday = DAY_OFF.
- Return exactly 7 day objects, one per date above, in order.

Instruction: "${String(text).slice(0, 500)}"

Return ONLY JSON: {"employeeId":"...","employeeName":"...","note":"short note about any assumption","days":[{"date":"YYYY-MM-DD","type":"...","startTime":"HH:mm"|null,"endTime":"HH:mm"|null}]}`;

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    }),
  });
  const gJson = await gRes.json();
  if (gJson.error) return res.status(502).json({ error: 'AI error: ' + (gJson.error.message || 'unknown') });
  const raw = gJson.candidates?.[0]?.content?.parts?.[0]?.text || '';
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return res.status(502).json({ error: 'Could not read AI response.' }); }
  if (!parsed || !Array.isArray(parsed.days)) return res.status(502).json({ error: 'AI did not return a schedule.' });
  res.json(parsed);
}));

// ---- Swap requests --------------------------------------------------------
api.get('/swaps', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, data FROM swap_requests');
  let items = rows.map((r) => ({ ...r.data, id: r.id }));
  if (!isAdmin(req)) {
    const ids = await deptUserIdSet(scopeDept(req));
    items = items.filter((s) => ids.has(s.requesterId) || ids.has(s.targetId));
  }
  res.json(items);
}));

api.post('/swaps', wrap(async (req, res) => {
  const body = { ...req.body };
  const id = body.id || genId();
  delete body.id;
  await pool.query(
    `INSERT INTO swap_requests (id, data) VALUES ($1, $2::jsonb)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [id, J(body)]
  );
  const [rN, tN] = await Promise.all([getUserName(body.requesterId), getUserName(body.targetId)]);
  await logAudit(req, { action: 'swap.create', entityType: 'swap', entityId: id, summary: `Requested swap: ${rN} (${body.requesterDate}) ↔ ${tN} (${body.targetDate})` });
  await notify(body.targetId, 'swap', 'New shift swap request', `${rN} requested a swap with you`);
  res.json({ ...body, id });
}));

api.put('/swaps/:id', wrap(async (req, res) => {
  const id = req.params.id;
  const status = req.body && req.body.status;
  // Final manager approval is restricted to management roles.
  if (status === 'APPROVED' && !MGMT.includes(req.user.role)) {
    return res.status(403).json({ error: 'Only a manager can approve a swap' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT data FROM swap_requests WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Swap not found' });
    }
    const reqData = rows[0].data;
    // A dept manager/supervisor may only act on swaps within their department.
    if (!isAdmin(req) && MGMT.includes(req.user.role) && req.user.id !== reqData.targetId) {
      const inD = (await inScope(req, reqData.requesterId)) || (await inScope(req, reqData.targetId));
      if (!inD) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Out of your department.' }); }
    }
    reqData.status = status;
    await client.query('UPDATE swap_requests SET data = $2::jsonb WHERE id = $1', [id, J(reqData)]);

    if (status === 'APPROVED') {
      const reqSched = await getScheduleMap(client, reqData.requesterId);
      const targetSched = await getScheduleMap(client, reqData.targetId);
      const shiftA = reqSched[reqData.requesterDate];
      const shiftB = targetSched[reqData.targetDate];
      const isSameDay = reqData.requesterDate === reqData.targetDate;

      // Requester takes the target's day
      const reqNew = shiftB
        ? { ...shiftB, date: reqData.targetDate }
        : { id: genId(), date: reqData.targetDate, type: 'DAY_OFF' };
      await upsertDay(client, reqData.requesterId, reqData.targetDate, reqNew);
      if (!isSameDay) await deleteDay(client, reqData.requesterId, reqData.requesterDate);

      // Target takes the requester's day
      const tgtNew = shiftA
        ? { ...shiftA, date: reqData.requesterDate }
        : { id: genId(), date: reqData.requesterDate, type: 'DAY_OFF' };
      await upsertDay(client, reqData.targetId, reqData.requesterDate, tgtNew);
      if (!isSameDay) await deleteDay(client, reqData.targetId, reqData.targetDate);
    }

    await client.query('COMMIT');
    const [rN, tN] = await Promise.all([getUserName(reqData.requesterId), getUserName(reqData.targetId)]);
    await logAudit(req, { action: 'swap.update', entityType: 'swap', entityId: id, summary: `Swap ${status}: ${rN} ↔ ${tN}`, details: { status } });
    {
      const swapMsg = status === 'APPROVED' ? 'Your shift swap was approved'
        : status === 'REJECTED' ? 'Your shift swap was rejected'
        : status === 'PENDING_MANAGER' ? 'Your swap was accepted — awaiting manager'
        : `Swap ${status}`;
      await notify(reqData.requesterId, 'swap', swapMsg, `${rN} ↔ ${tN}`);
    }
    res.json({ ...reqData, id });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

// ---- Leave requests -------------------------------------------------------
api.get('/leaves', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, data FROM leave_requests ORDER BY created_at DESC NULLS LAST');
  let items = rows.map((r) => ({ ...r.data, id: r.id }));
  if (!isAdmin(req)) {
    const ids = await deptUserIdSet(scopeDept(req));
    items = items.filter((l) => ids.has(l.userId));
  }
  res.json(items);
}));

api.post('/leaves', wrap(async (req, res) => {
  const body = { ...req.body };
  const id = body.id || genId();
  delete body.id;
  await pool.query(
    `INSERT INTO leave_requests (id, data, created_at) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, created_at = EXCLUDED.created_at`,
    [id, J(body), body.createdAt || Date.now()]
  );
  await logAudit(req, { action: 'leave.create', entityType: 'leave', entityId: id, summary: `${body.userName || 'Employee'} requested ${dayTypeLabel(body.type)} on ${body.date || ''}` });
  res.json({ ...body, id });
}));

api.put('/leaves/:id', requireRole(...MGMT), wrap(async (req, res) => {
  const id = req.params.id;
  const status = req.body && req.body.status;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT data FROM leave_requests WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.json({ success: false });
    }
    const leave = rows[0].data;
    if (!(await inScope(req, leave.userId))) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Out of your department.' }); }
    leave.status = status;
    await client.query('UPDATE leave_requests SET data = $2::jsonb WHERE id = $1', [id, J(leave)]);

    if (status === 'APPROVED') {
      const existing = await getDay(client, leave.userId, leave.date);
      const merged = { ...(existing || {}), type: leave.type, date: leave.date };
      if (!merged.id) merged.id = genId();
      await upsertDay(client, leave.userId, leave.date, merged);
    }

    await client.query('COMMIT');
    await logAudit(req, { action: 'leave.update', entityType: 'leave', entityId: id, summary: `Leave ${status}: ${leave.userName || ''} — ${dayTypeLabel(leave.type)} on ${leave.date || ''}`, details: { status } });
    await notify(leave.userId, 'leave', `Leave ${status === 'APPROVED' ? 'approved' : status === 'REJECTED' ? 'rejected' : status}`, `${dayTypeLabel(leave.type)} on ${leave.date || ''}`);
    res.json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

// ---- Public holidays ------------------------------------------------------
api.get('/holidays', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, data FROM public_holidays');
  res.json(rows.map((r) => ({ ...r.data, id: r.id })));
}));

api.post('/holidays', requireRole(...MGMT), wrap(async (req, res) => {
  const body = { ...req.body };
  const id = body.id || genId();
  delete body.id;
  await pool.query(
    `INSERT INTO public_holidays (id, data) VALUES ($1, $2::jsonb)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [id, J(body)]
  );
  await logAudit(req, { action: 'holiday.create', entityType: 'holiday', entityId: id, summary: `Added public holiday ${body.name || ''} (${body.date || ''})` });
  res.json({ ...body, id });
}));

api.delete('/holidays/:id', requireRole(...MGMT), wrap(async (req, res) => {
  await pool.query('DELETE FROM public_holidays WHERE id = $1', [req.params.id]);
  await logAudit(req, { action: 'holiday.delete', entityType: 'holiday', entityId: req.params.id, summary: 'Removed a public holiday' });
  res.status(204).end();
}));

// ---- Shift templates ------------------------------------------------------
api.get('/templates', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, data FROM shift_templates');
  res.json(rows.map((r) => ({ ...r.data, id: r.id })));
}));

api.post('/templates', requireRole(...SCHED_MGMT), wrap(async (req, res) => {
  const body = { ...req.body };
  const id = body.id || genId();
  delete body.id;
  await pool.query(
    `INSERT INTO shift_templates (id, data) VALUES ($1, $2::jsonb)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [id, J(body)]
  );
  await logAudit(req, { action: 'template.create', entityType: 'template', entityId: id, summary: `Saved shift template "${body.name || ''}"` });
  res.json({ ...body, id });
}));

api.delete('/templates/:id', requireRole(...SCHED_MGMT), wrap(async (req, res) => {
  await pool.query('DELETE FROM shift_templates WHERE id = $1', [req.params.id]);
  await logAudit(req, { action: 'template.delete', entityType: 'template', entityId: req.params.id, summary: 'Deleted a shift template' });
  res.status(204).end();
}));

// ---- Employee of the Month evaluations -------------------------------------
// Branch Manager / Area Manager / Operation Manager score their branch
// employees on the 7-criteria form; the employee can read their own history.
const EVAL_CRITERIA = ['qualityOfWork', 'teamwork', 'punctuality', 'attitude', 'adaptability', 'compliance', 'foodSafety'];

api.post('/evaluations', requireRole(...SCHED_MGMT), wrap(async (req, res) => {
  const body = req.body || {};
  const targetId = body.employeeId;
  if (!targetId) return res.status(400).json({ error: 'employeeId required' });
  const target = await getUserRow(targetId);
  if (!target || target.role !== 'BRANCH_EMPLOYEE') {
    return res.status(400).json({ error: 'Target must be a branch employee.' });
  }
  if (!isAdmin(req)) {
    const viewer = await getViewer(req);
    if (!canWriteSchedule(viewer, target)) return res.status(403).json({ error: 'Out of your scope.' });
  }

  const scores = {};
  let total = 0;
  for (const key of EVAL_CRITERIA) {
    const v = Number(body.scores?.[key]);
    if (!Number.isInteger(v) || v < 1 || v > 4) {
      return res.status(400).json({ error: `Score for "${key}" must be an integer 1-4.` });
    }
    scores[key] = v;
    total += v;
  }

  const id = genId();
  const now = Date.now();
  const data = {
    employeeName: target.name,
    employeeCode: target.employeeId || '',
    position: target.jobTitle || '',
    location: [target.brand, target.branch].filter(Boolean).join(' · '),
    evaluatorId: req.user.id,
    evaluatorName: req.user.name,
    scores,
    total,
    maxTotal: EVAL_CRITERIA.length * 4,
    approvedByName: (body.approvedByName || '').trim(),
    date: now,
  };
  await pool.query(
    'INSERT INTO evaluations (id, employee_id, data, created_at) VALUES ($1, $2, $3::jsonb, $4)',
    [id, targetId, J(data), now]
  );
  await logAudit(req, {
    action: 'evaluation.create', entityType: 'evaluation', entityId: id,
    summary: `Evaluated ${target.name} — ${total}/${data.maxTotal}`,
  });
  await notify(targetId, 'evaluation', 'You received a new evaluation', `Score: ${total}/${data.maxTotal}`);
  res.json({ id, ...data });
}));

api.delete('/evaluations/:id', requireRole(...SCHED_MGMT), wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT employee_id, data FROM evaluations WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Evaluation not found' });
  if (!isAdmin(req)) {
    const target = await getUserRow(rows[0].employee_id);
    const viewer = await getViewer(req);
    if (!target || !canWriteSchedule(viewer, target)) return res.status(403).json({ error: 'Out of your scope.' });
  }
  await pool.query('DELETE FROM evaluations WHERE id = $1', [req.params.id]);
  await logAudit(req, {
    action: 'evaluation.delete', entityType: 'evaluation', entityId: req.params.id,
    summary: `Deleted an evaluation for ${rows[0].data?.employeeName || rows[0].employee_id}`,
  });
  res.status(204).end();
}));

api.get('/evaluations/:userId', wrap(async (req, res) => {
  const targetId = req.params.userId;
  if (!isAdmin(req) && req.user.id !== targetId) {
    const target = await getUserRow(targetId);
    const viewer = await getViewer(req);
    if (!target || !canWriteSchedule(viewer, target)) return res.status(403).json({ error: 'Out of your scope.' });
  }
  const { rows } = await pool.query(
    'SELECT id, data FROM evaluations WHERE employee_id = $1 ORDER BY created_at DESC',
    [targetId]
  );
  res.json(rows.map((r) => ({ id: r.id, ...r.data })));
}));

// ---- Live breaks ----------------------------------------------------------
// Employees clock themselves in and out of a break; whoever runs their unit
// watches it live and can end a break on their behalf. Both hierarchies:
// a branch employee answers to the Branch Manager of their (brand, branch),
// a call-centre agent to the Team Leaders and Supervisors of their department.
const BREAK_TAKERS = ['BRANCH_EMPLOYEE', 'EMPLOYEE'];
const BREAK_WATCHERS = ['BRANCH_MANAGER', 'MANAGER', 'SUPERVISOR', 'ADMIN'];

// The people told when `employee` starts or ends a break.
const breakWatchersFor = (employee) =>
  isBranchRole(employee?.role) ? branchManagersFor(employee) : deptManagersFor(employee);

// "BRAND · Branch" or the department — the line under a notification.
const unitLine = (u) =>
  isBranchRole(u?.role) ? [u.brand, u.branch].filter(Boolean).join(' · ') : (u?.companyName || '');

// canWriteSchedule's department branch matches two blank companyNames against
// each other ('' === ''), which was harmless while only scheduling used it.
// Reused for break roster/end-for, it would let a department-less manager
// see and end breaks for department-less employees — accounts that
// deptManagersFor (above) never notifies, since it requires a real
// department. Guard breaks specifically so who can see/end a break is never
// wider than who gets told about it.
const canManageBreak = (viewer, target) =>
  viewer?.role === 'ADMIN' ? true :
  (!isBranchRole(viewer?.role) && !nrm(viewer?.companyName)) ? false :
  canWriteSchedule(viewer, target);

// The unit a break freeze scopes to: a branch employee's own (brand, branch),
// a department employee's own companyName. Returns null when that unit is
// blank — nothing meaningful to freeze or to match a freeze against.
function breakScopeOf(person) {
  if (isBranchRole(person?.role)) {
    const brand = nrm(person?.brand), branch = nrm(person?.branch);
    return brand && branch ? { type: 'branch', key: `${brand}::${branch}` } : null;
  }
  const dept = nrm(person?.companyName);
  return dept ? { type: 'department', key: dept } : null;
}

// The currently-running freeze covering `person`'s own unit, if any.
async function activeFreezeFor(person) {
  const scope = breakScopeOf(person);
  if (!scope) return null;
  const { rows } = await pool.query(
    `SELECT * FROM break_freezes WHERE scope_type = $1 AND scope_key = $2 AND ends_at > $3
     ORDER BY ends_at DESC LIMIT 1`,
    [scope.type, scope.key, Date.now()]
  );
  return rows[0] || null;
}

const freezeRow = (r) => ({
  id: r.id,
  startsAt: Number(r.starts_at),
  endsAt: Number(r.ends_at),
  reason: r.reason,
  createdByName: r.created_by_name,
});

// Every break-taker in `viewer`'s own scope — who a freeze (or its lift)
// needs to notify. Same membership /breaks/team already computes.
async function unitBreakTakers(viewer) {
  const { rows } = await pool.query(`SELECT id, data FROM users WHERE data->>'role' = ANY($1)`, [BREAK_TAKERS]);
  return rows.map((r) => ({ id: r.id, ...r.data })).filter((u) => canManageBreak(viewer, u));
}

const breakRow = (r) => ({
  id: r.id,
  userId: r.user_id,
  startedAt: Number(r.started_at),
  endedAt: r.ended_at == null ? null : Number(r.ended_at),
  endedById: r.ended_by_id,
  endedByName: r.ended_by_name,
  endedByRole: r.ended_by_role,
  source: r.source || 'swipr',
  xontelStatus: r.xontel_status || null,
});

const fmtClock = (ts) =>
  new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ });

const fmtDuration = (ms) => {
  const mins = Math.max(0, Math.round(ms / 60000));
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
};

// The logged-in employee's own break state plus their recent history, and
// whether their unit's Start Break button is currently frozen.
api.get('/breaks/me', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM breaks WHERE user_id = $1 ORDER BY started_at DESC LIMIT 50',
    [req.user.id]
  );
  const all = rows.map(breakRow);
  const me = await getViewer(req);
  const freeze = await activeFreezeFor(me);
  res.json({ active: all.find((b) => b.endedAt == null) || null, history: all, freeze: freeze ? freezeRow(freeze) : null });
}));

api.post('/breaks/start', wrap(async (req, res) => {
  const me = await getViewer(req);
  if (!me || !BREAK_TAKERS.includes(me.role)) {
    return res.status(403).json({ error: 'Only employees can take a break.' });
  }
  const freeze = await activeFreezeFor(me);
  if (freeze) {
    return res.status(403).json({
      error: `Breaks are paused until ${fmtClock(Number(freeze.ends_at))}${freeze.reason ? ` — ${freeze.reason}` : ''}.`,
    });
  }
  const started = Date.now();
  // The call-centre floor can only spare one person from a department at a
  // time — the queue keeps ringing for whoever's left. Checked and inserted
  // in the same statement (INSERT ... WHERE NOT EXISTS) so two people
  // pressing the button at the same instant can't both slip through; a
  // branch employee has no such limit (a branch's staffing isn't this app's
  // call to make the same way).
  const dept = !isBranchRole(me.role) ? nrm(me.companyName) : null;
  let inserted;
  try {
    const { rows } = dept
      ? await pool.query(
          `INSERT INTO breaks (id, user_id, started_at)
           SELECT $1, $2, $3
           WHERE NOT EXISTS (
             SELECT 1 FROM breaks b JOIN users u ON u.id = b.user_id
             WHERE b.ended_at IS NULL AND b.user_id <> $2
               AND u.data->>'role' = 'EMPLOYEE' AND lower(trim(u.data->>'companyName')) = $4
           )
           RETURNING *`,
          [genId(), req.user.id, started, dept]
        )
      : await pool.query(
          'INSERT INTO breaks (id, user_id, started_at) VALUES ($1, $2, $3) RETURNING *',
          [genId(), req.user.id, started]
        );
    inserted = rows[0];
  } catch (e) {
    // Violates breaks_one_active_idx — a break is already running.
    if (e.code === '23505') return res.status(409).json({ error: 'You are already on a break.' });
    throw e;
  }

  if (!inserted) {
    const { rows: peer } = await pool.query(
      `SELECT u.data->>'name' name FROM breaks b JOIN users u ON u.id = b.user_id
       WHERE b.ended_at IS NULL AND b.user_id <> $1
         AND u.data->>'role' = 'EMPLOYEE' AND lower(trim(u.data->>'companyName')) = $2
       ORDER BY b.started_at DESC LIMIT 1`,
      [req.user.id, dept]
    );
    const name = peer[0]?.name || 'Someone on your team';
    return res.status(409).json({ error: `${name} is already on a break — wait until they're back.` });
  }

  const managers = await breakWatchersFor(me);
  await Promise.all(managers.map((m) =>
    notify(m.id, 'break', `${me.name} started a break`, `Started at ${fmtClock(started)} · ${unitLine(me)}`)
  ));
  await logAudit(req, {
    action: 'break.start', entityType: 'break', entityId: inserted.id,
    summary: `${me.name} started a break`,
  });
  res.json(breakRow(inserted));
}));

api.post('/breaks/end', wrap(async (req, res) => {
  const me = await getViewer(req);
  const ended = Date.now();
  const { rows } = await pool.query(
    `UPDATE breaks SET ended_at = $1, ended_by_id = $2, ended_by_name = $3, ended_by_role = 'EMPLOYEE'
     WHERE user_id = $2 AND ended_at IS NULL RETURNING *`,
    [ended, req.user.id, me?.name || req.user.name]
  );
  if (!rows[0]) return res.status(404).json({ error: 'You are not on a break.' });

  const dur = fmtDuration(ended - Number(rows[0].started_at));
  // A break mirrored from XonTel never announced its start, so its end
  // doesn't announce either (see xontelOpenBreak for why).
  if (rows[0].source !== 'xontel') {
    const managers = await breakWatchersFor(me);
    await Promise.all(managers.map((m) =>
      notify(m.id, 'break', `${me.name} is back from break`, `Returned at ${fmtClock(ended)} · lasted ${dur}`)
    ));
  }
  await logAudit(req, {
    action: 'break.end', entityType: 'break', entityId: rows[0].id,
    summary: `${me.name} ended their break (${dur})`,
  });
  res.json(breakRow(rows[0]));
  syncReadyToXontel(req, req.user.id, me?.name || req.user.name, rows[0].id);
}));

// After a break ends in Swipr, return the agent to ready on XonTel if it
// still has them on a break status. Never delays or fails the response.
function syncReadyToXontel(req, userId, name, breakId) {
  xontelReturnToReady(userId, breakId)
    .then((r) => r && logAudit(req, {
      action: r.ok ? 'xontel.agent_ready' : 'xontel.agent_ready_failed', entityType: 'user', entityId: userId,
      summary: r.ok
        ? `Set ${name} back to ready on XonTel (was ${r.from})`
        : `Could not set ${name} back to ready on XonTel: ${r.error}`,
    }))
    .catch((e) => console.error('[xontel] ready sync failed:', e.message));
}

// Day types the roster counts as an actual shift — mirrors Dashboard.tsx's
// SHIFT_TYPES (client-side), not the narrower ATTENDANCE_DAY_TYPES used for
// fingerprint lateness (that one excludes WORK_FROM_HOME/TASK deliberately,
// since no punch is expected for those).
const ON_SHIFT_DAY_TYPES = new Set([
  'NORMAL_SHIFT', 'WORK_FROM_HOME', 'TASK', 'TARDY', 'EARLY_LEAVE', 'CANCEL_OFF',
]);

// Is each of `userIds` inside their own scheduled shift window right now?
// Checks today's row and yesterday's, so an overnight shift filed on
// yesterday's date is still "on shift" after midnight — same anchoring
// anchorShift() already uses for lateness, so this agrees with it.
async function onShiftNow(userIds) {
  const ids = [...new Set(userIds)];
  const out = new Map(ids.map((id) => [id, false]));
  if (!ids.length) return out;
  const today = dayKeyInAppTz(Date.now());
  const yesterday = addDays(today, -1);
  const { rows } = await pool.query(
    `SELECT user_id, date, data FROM schedules WHERE user_id = ANY($1) AND date IN ($2, $3)`,
    [ids, today, yesterday]
  );
  const byUser = new Map();
  for (const r of rows) {
    if (!ON_SHIFT_DAY_TYPES.has(r.data?.type)) continue;
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id).push(r);
  }
  const now = Date.now();
  for (const [userId, dayRows] of byUser) {
    const onShift = dayRows.some((r) => {
      const w = anchorShift(r.date, r.data?.shift);
      return w && now >= w.start && now < w.end;
    });
    if (onShift) out.set(userId, true);
  }
  return out;
}

// Live roster for whoever runs a unit: the employees in their scope, each with
// their currently-running break (if any) and how much break time they've had
// today. Scope is the same as scheduling — a Branch Manager gets their branch,
// a Team Leader or Supervisor their department, Admin everyone.
api.get('/breaks/team', requireRole(...BREAK_WATCHERS), wrap(async (req, res) => {
  const viewer = await getViewer(req);
  const { rows: userRows } = await pool.query(
    `SELECT id, data FROM users WHERE data->>'role' = ANY($1)`, [BREAK_TAKERS]
  );
  const team = userRows
    .map((r) => ({ id: r.id, ...r.data }))
    .filter((u) => canManageBreak(viewer, u));
  if (!team.length) return res.json([]);

  const ids = team.map((u) => u.id);
  const onShift = await onShiftNow(ids);
  // "Today" means the Kuwait calendar day, not a rolling 24h window — that's
  // what the count/total on each card, and the breakdown behind the avatar,
  // are answering. A break still running from before midnight is kept
  // regardless (it's still their break right now, whenever it started).
  const since = atKuwait(dayKeyInAppTz(Date.now()), '00:00');
  const { rows: breakRows } = await pool.query(
    `SELECT * FROM breaks WHERE user_id = ANY($1) AND (ended_at IS NULL OR started_at >= $2)
     ORDER BY started_at DESC`,
    [ids, since]
  );

  const byUser = new Map();
  for (const r of breakRows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id).push(breakRow(r));
  }
  res.json(team.map((u) => {
    const list = byUser.get(u.id) || [];
    const active = list.find((b) => b.endedAt == null) || null;
    const todayMs = list
      .filter((b) => b.endedAt != null)
      .reduce((sum, b) => sum + (b.endedAt - b.startedAt), 0);
    return {
      id: u.id, name: u.name, role: u.role, jobTitle: u.jobTitle || '', employeeCode: u.employeeId || '',
      brand: u.brand || '', branch: u.branch || '', unit: unitLine(u),
      active, breaksToday: list.length, msToday: todayMs, onShift: onShift.get(u.id) || false,
      // Newest first, so the detail popover reads top-to-bottom as "most
      // recent break first" without the client re-sorting.
      history: list,
    };
  }));
}));

// Who is on a break right now, for anyone signed in — so an agent's
// dashboard can show which colleague is already out (the one-per-department
// rule makes that the question they actually have). Read scope, not manage
// scope: canSeeUser, i.e. an employee sees their own department (or branch),
// a lead theirs, Admin everyone. Carries only what the dashboard shows —
// no history, no durations of anyone's day.
api.get('/breaks/now', wrap(async (req, res) => {
  const admin = isAdmin(req);
  const viewer = admin ? null : await getViewer(req);
  const { rows } = await pool.query(
    `SELECT b.user_id, b.started_at, b.source, b.xontel_status, u.data
       FROM breaks b JOIN users u ON u.id = b.user_id
      WHERE b.ended_at IS NULL AND u.data->>'role' = ANY($1)`,
    [BREAK_TAKERS]
  );
  res.json(rows
    .filter((r) => admin || canSeeUser(viewer, { id: r.user_id, ...r.data }))
    .map((r) => ({
      userId: r.user_id, startedAt: Number(r.started_at),
      source: r.source || 'swipr', xontelStatus: r.xontel_status || null,
    })));
}));

// Breaks over a range of days for the viewer's whole scope, not just who's
// on one right now — the history /breaks/team can't answer since it only
// carries today. Same scope as /breaks/team (canManageBreak); days are Kuwait
// calendar days, matching what "today" means everywhere else in this
// feature. `?from=&to=` (inclusive); the older single `?date=` still works.
// Unit and name filtering happen in the page — the whole scope comes back,
// along with every unit in it so the filter lists units with no breaks too.
const REPORT_MAX_DAYS = 93;
api.get('/breaks/report', requireRole(...BREAK_WATCHERS), wrap(async (req, res) => {
  const viewer = await getViewer(req);
  const today = dayKeyInAppTz(Date.now());
  const from = String(req.query.from || req.query.date || today);
  const to = String(req.query.to || req.query.date || from);
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  if (!DAY.test(from) || !DAY.test(to)) return res.status(400).json({ error: 'from/to must be YYYY-MM-DD' });
  if (to < from) return res.status(400).json({ error: '"to" is before "from".' });
  const rangeStart = atKuwait(from, '00:00');
  const rangeEnd = atKuwait(addDays(to, 1), '00:00');
  if ((rangeEnd - rangeStart) / DAY_MS > REPORT_MAX_DAYS) {
    return res.status(400).json({ error: `Pick at most ${REPORT_MAX_DAYS} days.` });
  }

  const { rows: userRows } = await pool.query(
    `SELECT id, data FROM users WHERE data->>'role' = ANY($1)`, [BREAK_TAKERS]
  );
  const team = userRows
    .map((r) => ({ id: r.id, ...r.data }))
    .filter((u) => canManageBreak(viewer, u));
  const units = [...new Set(team.map((u) => unitLine(u)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (!team.length) return res.json({ from, to, units, rows: [] });

  const byId = new Map(team.map((u) => [u.id, u]));
  // Overlap, not "started inside the range" — a break running across
  // midnight into the range still belongs in it. Each break is listed under
  // the day it started, clamped to the first day shown.
  const { rows: breakRows } = await pool.query(
    `SELECT * FROM breaks WHERE user_id = ANY($1) AND started_at < $3 AND coalesce(ended_at, $3) >= $2
     ORDER BY started_at`,
    [team.map((u) => u.id), rangeStart, rangeEnd]
  );

  res.json({
    from, to, units,
    rows: breakRows.map((r) => {
      const u = byId.get(r.user_id);
      const startDay = dayKeyInAppTz(Number(r.started_at));
      return {
        ...breakRow(r), userName: u?.name || '', employeeCode: u?.employeeId || '',
        role: u?.role, unit: unitLine(u), day: startDay < from ? from : startDay,
      };
    }),
  });
}));

// A manager ends a break on the employee's behalf.
api.post('/breaks/end-for/:userId', requireRole(...BREAK_WATCHERS), wrap(async (req, res) => {
  const target = await getUserRow(req.params.userId);
  if (!target) return res.status(404).json({ error: 'Employee not found' });
  const viewer = await getViewer(req);
  if (!canManageBreak(viewer, target)) return res.status(403).json({ error: 'Out of your scope.' });

  const ended = Date.now();
  const { rows } = await pool.query(
    `UPDATE breaks SET ended_at = $1, ended_by_id = $2, ended_by_name = $3, ended_by_role = 'MANAGER'
     WHERE user_id = $4 AND ended_at IS NULL RETURNING *`,
    [ended, req.user.id, req.user.name, target.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'That employee is not on a break.' });

  const dur = fmtDuration(ended - Number(rows[0].started_at));
  await notify(
    target.id, 'break',
    `${req.user.name} ended your break`,
    `Ended at ${fmtClock(ended)} · lasted ${dur}. You are back on shift.`
  );
  await logAudit(req, {
    action: 'break.end_by_manager', entityType: 'break', entityId: rows[0].id,
    summary: `Ended ${target.name}'s break (${dur})`,
  });
  res.json(breakRow(rows[0]));
  // The lead's End Break is what pulls a XonTel break back to ready — the
  // point of mirroring them in the first place.
  syncReadyToXontel(req, target.id, target.name, rows[0].id);
}));

const FREEZE_MAX_MINUTES = 480; // 8h — generous ceiling, not a real-world duration

// A manager pauses Start Break for their own scope for N minutes, starting
// now. Replaces any freeze already running for that scope rather than
// stacking — one active freeze per unit at a time, always the latest call.
api.post('/breaks/freeze', requireRole(...BREAK_WATCHERS), wrap(async (req, res) => {
  const viewer = await getViewer(req);
  const scope = breakScopeOf(viewer);
  if (!scope) return res.status(400).json({ error: 'Your account has no department or branch to pause breaks for.' });

  const minutes = Math.round(Number(req.body?.minutes));
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > FREEZE_MAX_MINUTES) {
    return res.status(400).json({ error: `Pick a duration between 1 and ${FREEZE_MAX_MINUTES} minutes.` });
  }
  const reason = String(req.body?.reason || '').trim().slice(0, 200) || null;

  const now = Date.now();
  const endsAt = now + minutes * 60000;
  const id = genId();
  await pool.query('DELETE FROM break_freezes WHERE scope_type = $1 AND scope_key = $2 AND ends_at > $3', [scope.type, scope.key, now]);
  await pool.query(
    `INSERT INTO break_freezes (id, scope_type, scope_key, starts_at, ends_at, reason, created_by_id, created_by_name, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, scope.type, scope.key, now, endsAt, reason, req.user.id, viewer.name, now]
  );

  const affected = await unitBreakTakers(viewer);
  await Promise.all(affected.map((u) =>
    notify(u.id, 'break', `Breaks paused until ${fmtClock(endsAt)}`, reason || `${viewer.name} paused breaks for ${unitLine(viewer)}.`)
  ));
  await logAudit(req, {
    action: 'break.freeze', entityType: 'break_freeze', entityId: id,
    summary: `${viewer.name} paused breaks for ${unitLine(viewer)} until ${fmtClock(endsAt)}`,
  });
  res.json({ id, startsAt: now, endsAt, reason, createdByName: viewer.name });
}));

// Lifts the viewer's own active freeze early, if there is one.
api.post('/breaks/freeze/cancel', requireRole(...BREAK_WATCHERS), wrap(async (req, res) => {
  const viewer = await getViewer(req);
  const scope = breakScopeOf(viewer);
  if (!scope) return res.json({ ok: true });

  const { rows } = await pool.query(
    'DELETE FROM break_freezes WHERE scope_type = $1 AND scope_key = $2 AND ends_at > $3 RETURNING id',
    [scope.type, scope.key, Date.now()]
  );
  if (rows.length) {
    const affected = await unitBreakTakers(viewer);
    await Promise.all(affected.map((u) => notify(u.id, 'break', 'Breaks resumed', `${viewer.name} lifted the break pause.`)));
    await logAudit(req, {
      action: 'break.freeze_cancel', entityType: 'break_freeze', entityId: rows[0].id,
      summary: `${viewer.name} lifted the break pause for ${unitLine(viewer)}`,
    });
  }
  res.json({ ok: true });
}));

// The freeze currently running for the viewer's own scope, if any — the
// manager-side counterpart to the `freeze` field /breaks/me returns.
api.get('/breaks/freeze', requireRole(...BREAK_WATCHERS), wrap(async (req, res) => {
  const viewer = await getViewer(req);
  const freeze = await activeFreezeFor(viewer);
  res.json(freeze ? freezeRow(freeze) : null);
}));

// ---- Attendance (QR clock-in/out) -------------------------------------------
// A screen in the branch shows a QR that is re-signed every few seconds. The
// employee scans it with their phone camera, which opens the app and posts the
// code back. Because the code expires almost immediately and is bound to one
// branch, a screenshot forwarded to someone off-site is useless — that is what
// keeps "you must actually be at the branch" true.
// The same process signs and verifies these codes, so there is no clock skew
// to tolerate — the expiry is enforced exactly, keeping the window tight.
// How long a scanned code stays usable. This is not the screen refresh rate —
// the kiosk redraws far more often. 30s proved too tight in practice: the
// employee still has to tap the camera's link, load the app and sometimes log
// in before the code is posted. 90s is still short enough that a photo of the
// screen is useless by the time it leaves the branch.
const KIOSK_CODE_TTL_SECONDS = 90;
// The kiosk asks for a fresh code well before the current one lapses.
const KIOSK_REFRESH_SECONDS = 20;

// Roles that may put an attendance QR on a screen.
const KIOSK_ROLES = ['BRANCH_MANAGER', 'SUPERVISOR', 'MANAGER', 'ADMIN'];

api.get('/attendance/kiosk-code', requireRole(...KIOSK_ROLES), wrap(async (req, res) => {
  const viewer = await getViewer(req);
  // Two hierarchies, two kinds of code. Branch screens are tied to one
  // brand+branch; the call centre runs a single shared code for everyone.
  const wantsCallCentre = isAdmin(req)
    ? req.query.scope === 'callcentre' || req.query.scope === 'callcenter'
    : !isBranchRole(viewer?.role);

  let payload, brand = '', branch = '';
  if (wantsCallCentre) {
    payload = { kind: 'attendance', scope: 'CALLCENTRE' };
  } else {
    // Admins aren't tied to a branch, so they pass the one they're displaying for.
    brand = isAdmin(req) ? (req.query.brand || viewer?.brand || '') : viewer?.brand || '';
    branch = isAdmin(req) ? (req.query.branch || viewer?.branch || '') : viewer?.branch || '';
    if (!brand || !branch) {
      return res.status(400).json({ error: 'A brand and branch are required to show a kiosk code.' });
    }
    payload = { kind: 'attendance', scope: 'BRANCH', brand, branch };
  }
  const code = jwt.sign(payload, JWT_SECRET, { expiresIn: KIOSK_CODE_TTL_SECONDS });
  // The code goes in the real query string, not the URL fragment: phone camera
  // apps and the HTTP->HTTPS redirect can drop everything after "#", which
  // made the app open with no code at all. index.tsx picks "c" up on boot.
  const scanUrl = `${req.protocol}://${req.get('host')}/?c=${encodeURIComponent(code)}`;
  const qrDataUri = await QRCode.toDataURL(scanUrl, { width: 512, margin: 1 });
  res.json({
    qrDataUri,
    expiresInSeconds: KIOSK_CODE_TTL_SECONDS,
    refreshInSeconds: KIOSK_REFRESH_SECONDS,
    brand, branch,
    scope: wantsCallCentre ? 'CALLCENTRE' : 'BRANCH',
    label: wantsCallCentre ? 'Call Centre' : [brand, branch].filter(Boolean).join(' · '),
  });
}));

api.post('/attendance/scan', wrap(async (req, res) => {
  const code = req.body?.code;
  if (!code) return res.status(400).json({ error: 'Missing code.' });

  let payload;
  try {
    payload = jwt.verify(code, JWT_SECRET);
  } catch {
    return res.status(400).json({ error: 'This code has expired. Scan the screen again.' });
  }
  if (payload.kind !== 'attendance') return res.status(400).json({ error: 'That is not an attendance code.' });

  const me = await getViewer(req);
  if (!me) return res.status(403).json({ error: 'Unknown user.' });

  // Codes minted before the call centre existed carry no scope — treat those
  // as branch codes so screens already in use keep working.
  const scope = payload.scope || 'BRANCH';
  let unit;
  if (scope === 'CALLCENTRE') {
    if (!['EMPLOYEE', 'MANAGER'].includes(me.role)) {
      return res.status(403).json({ error: 'That screen is for call centre staff.' });
    }
    unit = (me.companyName || '').trim();
    if (!unit) return res.status(400).json({ error: 'Your account has no department set. Ask your supervisor.' });
  } else {
    if (me.role !== 'BRANCH_EMPLOYEE') {
      return res.status(403).json({ error: 'Only branch employees clock in and out on a branch screen.' });
    }
    if (nrm(me.brand) !== nrm(payload.brand) || nrm(me.branch) !== nrm(payload.branch)) {
      return res.status(403).json({ error: 'That screen belongs to a different branch.' });
    }
    unit = [me.brand, me.branch].filter(Boolean).join(' · ');
  }

  // Each scan toggles: the first of the day is a clock-in, the next a clock-out.
  const { rows: last } = await pool.query(
    'SELECT kind FROM attendance WHERE user_id = $1 ORDER BY ts DESC LIMIT 1',
    [me.id]
  );
  const kind = last[0]?.kind === 'IN' ? 'OUT' : 'IN';
  const ts = Date.now();
  const isCallCentre = scope === 'CALLCENTRE';
  await pool.query(
    'INSERT INTO attendance (id, user_id, kind, ts, brand, branch, department) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [genId(), me.id, kind, ts, isCallCentre ? '' : (me.brand || ''), isCallCentre ? '' : (me.branch || ''), isCallCentre ? unit : null]
  );
  await logAudit(req, {
    action: 'attendance.scan', entityType: 'attendance', entityId: me.id,
    summary: `${me.name} clocked ${kind === 'IN' ? 'in' : 'out'} at ${unit}`,
  });

  // Tell whoever supervises this person.
  const watchers = isCallCentre ? await deptManagersFor(me) : await branchManagersFor(me);
  await Promise.all(watchers.map((m) =>
    notify(m.id, 'attendance', `${me.name} clocked ${kind === 'IN' ? 'in' : 'out'}`, `At ${fmtClock(ts)} · ${unit}`)
  ));

  res.json({ kind, ts, brand: isCallCentre ? '' : payload.brand, branch: isCallCentre ? '' : payload.branch, unit, name: me.name });
}));

// The employee's own recent clock-ins/outs.
api.get('/attendance/me', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, kind, ts, brand, branch, department FROM attendance WHERE user_id = $1 ORDER BY ts DESC LIMIT 50',
    [req.user.id]
  );
  res.json(rows.map((r) => ({
    id: r.id, kind: r.kind, ts: Number(r.ts), brand: r.brand, branch: r.branch,
    // One label the client can show regardless of which hierarchy it came from.
    unit: r.department || [r.brand, r.branch].filter(Boolean).join(' · '),
  })));
}));

// Attendance board for a given day (defaults to today) — the branch for a
// Branch Manager, the department for a Team Leader/Supervisor.
// Admin only. This is the whole workforce's movements — who was in the
// building and when — so it is deliberately narrower than the roles that may
// merely *collect* attendance by displaying the kiosk QR above.
api.get('/attendance/team', requireRole('ADMIN'), wrap(async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : null;
  // Day window in the app timezone (Kuwait, UTC+3 — no DST). The old code
  // used UTC midnight for explicit dates and SERVER-local midnight for
  // "today", so scans between 00:00 and 03:00 Kuwait landed on the wrong
  // day depending on which path ran. Kuwait's offset is fixed, so the
  // literal +03:00 is safe.
  const day = date || new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const dayStart = new Date(`${day}T00:00:00+03:00`).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;

  const viewer = await getViewer(req);
  // Whichever side the viewer belongs to, list the people who clock in there.
  // Team Leaders clock in themselves, so they belong on their own board.
  const { rows: userRows } = await pool.query(
    `SELECT id, data FROM users WHERE data->>'role' IN ('BRANCH_EMPLOYEE', 'EMPLOYEE', 'MANAGER')`
  );
  const team = userRows
    .map((r) => ({ id: r.id, ...r.data }))
    .filter((u) => (u.id === viewer?.id ? viewer?.role === 'MANAGER' : canWriteSchedule(viewer, u)));
  if (!team.length) return res.json([]);

  // A shift belongs to the day it STARTED on, and its clock-out may land on
  // the next calendar date. Restricting to [dayStart, dayEnd) cut every
  // overnight shift in half: a 6pm->2am worker showed IN with no OUT and
  // "on site" all night. So the window reaches one shift-gap past the day's
  // end, and each shift is attributed to the day its IN falls on.
  const { rows: records } = await pool.query(
    'SELECT id, user_id, kind, ts FROM attendance WHERE user_id = ANY($1) AND ts >= $2 AND ts < $3 ORDER BY ts ASC',
    [team.map((u) => u.id), dayStart, dayEnd + SHIFT_GAP_MS]
  );
  const byUser = new Map();
  for (const r of records) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id).push({ id: r.id, kind: r.kind, ts: Number(r.ts) });
  }
  res.json(team.map((u) => {
    const all = byUser.get(u.id) || [];
    // Only shifts that began on this day count. An IN after dayEnd is
    // tomorrow's shift; an OUT before the day's first IN is the tail of
    // yesterday's overnight shift and would otherwise be counted here too.
    const scans = [];
    let seenIn = false;
    for (let i = 0; i < all.length; i++) {
      const s = all[i];
      if (s.kind === 'IN' && s.ts >= dayEnd) break;
      if (s.kind === 'OUT' && !seenIn) continue;
      if (s.kind === 'IN') seenIn = true;
      scans.push(s);
    }
    const firstIn = scans.find((s) => s.kind === 'IN') || null;
    const lastOut = [...scans].reverse().find((s) => s.kind === 'OUT') || null;
    return {
      id: u.id, name: u.name, jobTitle: u.jobTitle || '', employeeCode: u.employeeId || '',
      photoUrl: u.photoUrl || '',
      firstIn: firstIn?.ts || null,
      lastOut: lastOut?.ts || null,
      // Row ids so an admin can correct a specific punch (see PUT /attendance/:id).
      firstInId: firstIn?.id || null,
      lastOutId: lastOut?.id || null,
      onSite: scans.length > 0 && scans[scans.length - 1].kind === 'IN',
      scanCount: scans.length,
    };
  }));
}));

// ---- Admin correction of a punch ------------------------------------------
// An admin may move a clock-in/out to the right time or remove a punch that
// should never have existed (a double press the terminal kept, a test scan).
// Admin only: this rewrites the record of when someone was at work, so it is
// deliberately not extended to managers. Every change is audited with the
// before and after so a disputed correction can be traced.
//
// The corrected row is renamed out of the fp-<user>-<day>-<ts> id scheme:
// the terminal sync recomputes rows by that pattern, and a row still carrying
// it would be deleted and re-derived from the raw punches on the next cycle,
// silently reverting the admin's change. A row with a plain id is left alone.
api.put('/attendance/:id', requireRole('ADMIN'), wrap(async (req, res) => {
  const id = req.params.id;
  const { rows } = await pool.query(
    'SELECT id, user_id, kind, ts, brand, branch, department FROM attendance WHERE id = $1', [id]
  );
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'Punch not found.' });

  const ts = Number(req.body?.ts);
  const kind = req.body?.kind ?? row.kind;
  if (!Number.isFinite(ts)) return res.status(400).json({ error: 'A valid timestamp is required.' });
  if (!['IN', 'OUT'].includes(kind)) return res.status(400).json({ error: 'kind must be IN or OUT.' });
  if (ts > Date.now() + 5 * 60 * 1000) return res.status(400).json({ error: 'A punch cannot be in the future.' });

  const newId = id.startsWith('fp-') ? `adm-${genId()}` : id;
  await pool.query(
    'UPDATE attendance SET id = $2, kind = $3, ts = $4 WHERE id = $1', [id, newId, kind, ts]
  );
  // Renaming the row out of the `fp-` namespace stops the sync rewriting the
  // correction, but the ORIGINAL timestamp is still in the terminal and comes
  // back on the next three-day resend — leaving the bad punch sitting beside
  // the corrected one. Suppressing it is what makes the correction stick.
  if (id.startsWith('fp-')) {
    await pool.query(
      'INSERT INTO attendance_suppressed (user_id, ts) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [row.user_id, Number(row.ts)]
    );
  }
  const name = await getUserName(row.user_id);
  await logAudit(req, {
    action: 'attendance.edit', entityType: 'attendance', entityId: newId,
    summary: `Corrected ${name}'s ${row.kind} ${fmtClock(Number(row.ts))} -> ${kind} ${fmtClock(ts)}`,
    details: { userId: row.user_id, before: { id, kind: row.kind, ts: Number(row.ts) }, after: { id: newId, kind, ts } },
  });
  await recomputeAround(row.user_id, [Number(row.ts), ts]);
  res.json({ id: newId, userId: row.user_id, kind, ts });
}));

api.delete('/attendance/:id', requireRole('ADMIN'), wrap(async (req, res) => {
  const id = req.params.id;
  const { rows } = await pool.query('SELECT user_id, kind, ts FROM attendance WHERE id = $1', [id]);
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'Punch not found.' });
  await pool.query('DELETE FROM attendance WHERE id = $1', [id]);
  // A deleted terminal punch would be re-derived from the raw data on the
  // next sync; remembering the timestamp lets that sync skip it for good.
  if (id.startsWith('fp-')) {
    await pool.query(
      'INSERT INTO attendance_suppressed (user_id, ts) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [row.user_id, Number(row.ts)]
    );
  }
  const name = await getUserName(row.user_id);
  await logAudit(req, {
    action: 'attendance.delete', entityType: 'attendance', entityId: id,
    summary: `Removed ${name}'s ${row.kind} at ${fmtClock(Number(row.ts))}`,
    details: { userId: row.user_id, kind: row.kind, ts: Number(row.ts) },
  });
  await recomputeAround(row.user_id, [Number(row.ts)]);
  res.status(204).end();
}));

// ---- Lateness -------------------------------------------------------------
// Attendance data is admin-only by the owner's explicit instruction, and
// these rows are attendance data with the roster laid over them, so they
// inherit that. Widening this to team leaders is a policy decision, not a
// technical one — and it needs a rule that stops a leader reviewing their own
// lateness, since the schedule-scope predicate would let them.

api.get('/attendance/lateness', requireRole('ADMIN'), wrap(async (req, res) => {
  const { from, to, status } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to are required (YYYY-MM-DD).' });

  const params = [from, to];
  let statusClause = '';
  if (status) {
    params.push(String(status).split(',').map((s) => s.trim()).filter(Boolean));
    statusClause = `AND d.status = ANY($3)`;
  }
  const { rows } = await pool.query(
    `SELECT d.*, u.data->>'name' AS name, u.data->>'role' AS role,
            u.data->>'companyName' AS company, u.data->>'employeeId' AS employee_id,
            s.data->>'minutes' AS recorded_minutes
       FROM attendance_daily d
       JOIN users u ON u.id = d.user_id
       LEFT JOIN schedules s ON s.user_id = d.user_id AND s.date = d.date
      WHERE d.date >= $1 AND d.date <= $2 ${statusClause}
      ORDER BY d.date DESC, coalesce(d.offset_min, 0) DESC`,
    params
  );
  const { rows: syncRows } = await pool.query(`SELECT last_sync_at FROM sync_state WHERE id = 'fingerprint'`);

  // The second clock: XonTel's first working session inside each shift's
  // window. Looked up for the whole page in two queries, not one per row.
  const xon = await xontelWorkFor(rows
    .filter((r) => r.scheduled_start !== null)
    .map((r) => ({
      key: `${r.user_id}|${r.date}`, userId: r.user_id,
      lo: Number(r.scheduled_start) - ARRIVAL_WINDOW_MS,
      hi: Number(r.scheduled_end ?? r.scheduled_start) + ARRIVAL_WINDOW_MS,
    })));
  const xonState = xontelConfigured() ? await xontelState() : null;

  res.json({
    graceMinutes: LATE_GRACE_MIN,
    earlyLeaveMinutes: EARLY_LEAVE_MIN,
    earlyLeaveAmbiguousMinutes: EARLY_LEAVE_AMBIGUOUS_MIN,
    lastSyncAt: syncRows.length ? Number(syncRows[0].last_sync_at) : null,
    xontel: {
      configured: xontelConfigured(),
      lastSyncAt: xonState?.last_sync_at ? Number(xonState.last_sync_at) : null,
      lastError: xontelLastError || xonState?.detail?.lastError || null,
    },
    rows: rows.map((r) => ({
      ...(() => {
        const x = xon.get(`${r.user_id}|${r.date}`);
        const loginTs = x?.loginTs ?? null;
        const arrival = r.arrival_ts === null ? null : Number(r.arrival_ts);
        // Minutes between reaching the building and starting to take calls.
        // Falls back to the scheduled start when the terminal never saw them,
        // so a XonTel login still gives a lateness figure of its own.
        const anchor = arrival ?? (r.scheduled_start === null ? null : Number(r.scheduled_start));
        return {
          xontelMapped: !!x?.mapped,
          xontelLoginTs: loginTs,
          xontelLogoutTs: x?.logoutTs ?? null,
          xontelGapMin: loginTs !== null && anchor !== null ? Math.round((loginTs - anchor) / 60000) : null,
        };
      })(),
      userId: r.user_id, name: r.name, role: r.role, company: r.company, employeeId: r.employee_id,
      date: r.date, dayType: r.day_type,
      scheduledStart: r.scheduled_start === null ? null : Number(r.scheduled_start),
      scheduledEnd: r.scheduled_end === null ? null : Number(r.scheduled_end),
      arrivalTs: r.arrival_ts === null ? null : Number(r.arrival_ts),
      departureTs: r.departure_ts === null ? null : Number(r.departure_ts),
      offsetMin: r.offset_min, earlyLeaveMin: r.early_leave_min,
      punchCount: r.punch_count, status: r.status,
      recordedMinutes: r.recorded_minutes === null ? null : Number(r.recorded_minutes),
      reviewedBy: r.reviewed_by, reviewedName: r.reviewed_name,
      reviewedAt: r.reviewed_at === null ? null : Number(r.reviewed_at),
      reviewAction: r.review_action,
    })),
  });
}));

// Rebuilds the findings for a date range. Needed whenever the inputs changed
// outside a sync — after `bridge.js --full` backfills someone's history, after
// an employeeId is filled in, or after the grace period is changed. Touches
// only derived rows: the punches and the roster are read, never written.
api.post('/attendance/lateness/recompute', requireRole('ADMIN'), wrap(async (req, res) => {
  const { from, to } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) {
    return res.status(400).json({ error: 'from and to are required (YYYY-MM-DD).' });
  }
  if (to < from) return res.status(400).json({ error: 'to must not be before from.' });
  const { rows } = await pool.query(
    `SELECT DISTINCT user_id FROM attendance WHERE id LIKE 'fp-%'`
  );
  const result = await recomputeLateness({
    userIds: rows.map((r) => r.user_id), fromDate: from, toDate: to,
  });
  await logAudit(req, {
    action: 'attendance.lateness-recompute', entityType: 'attendance', entityId: `${from}..${to}`,
    summary: `Rebuilt lateness findings for ${from} → ${to} (${result.rows} day(s))`,
    details: { from, to, ...result },
  });
  res.json(result);
}));

// ---- XonTel link (admin) ---------------------------------------------------

api.get('/xontel/status', requireRole('ADMIN'), wrap(async (req, res) => {
  const st = await xontelState();
  const { rows: c } = await pool.query(
    `SELECT (SELECT count(*) FROM xontel_sessions)::int AS sessions,
            (SELECT count(*) FROM xontel_agent_map)::int AS mapped,
            (SELECT count(*) FROM xontel_calls)::int AS calls,
            (SELECT max(start_ts) FROM xontel_sessions) AS newest`
  );
  res.json({
    configured: xontelConfigured(),
    hasCredentials: xontelHasCredentials(),
    baseUrl: xontelBaseUrl() || null,
    discoverUrl: XONTEL_DISCOVER_URL || null,
    lastSyncAt: st?.last_sync_at ? Number(st.last_sync_at) : null,
    lastError: xontelLastError || st?.detail?.lastError || null,
    lastCount: st?.detail?.lastCount ?? null,
    sessionsStored: c[0].sessions,
    callsStored: c[0].calls,
    mappedAgents: c[0].mapped,
    newestSessionTs: c[0].newest === null ? null : Number(c[0].newest),
  });
}));

// Every call-centre user beside the XonTel agent they are linked to, with a
// suggestion where the names match well enough. A suggestion is only ever
// shown, never applied on its own: linking the wrong two people would put
// one agent's logins on another's record.
api.get('/xontel/agent-map', requireRole('ADMIN'), wrap(async (req, res) => {
  if (!xontelConfigured()) return res.status(503).json({ error: 'XonTel is not configured on this server.' });
  let agents = [];
  try {
    const f = await xontelGet('/api/v1/cdr/filters');
    agents = (f?.agent || f?.agents || []).map((a) => ({
      id: String(pick(a, ['value', 'id']) ?? ''), name: String(pick(a, ['label', 'name']) ?? ''),
    })).filter((a) => a.id);
  } catch (e) {
    return res.status(502).json({ error: `XonTel: ${e.message}` });
  }

  const { rows: users } = await pool.query(
    `SELECT u.id, u.data->>'name' AS name, u.data->>'role' AS role, u.data->>'companyName' AS company,
            m.xontel_agent_id, m.xontel_agent_name
       FROM users u LEFT JOIN xontel_agent_map m ON m.user_id = u.id
      WHERE coalesce(u.data->>'role','') IN ('EMPLOYEE','MANAGER','SUPERVISOR')
      ORDER BY u.data->>'name'`
  );
  const taken = new Set(users.map((u) => u.xontel_agent_id).filter(Boolean));
  const unlinked = users.filter((u) => !u.xontel_agent_id).map((u) => ({ userId: u.id, name: u.name }));
  const suggestions = suggestAgentLinks(unlinked, agents, taken);
  res.json({
    agents,
    rows: users.map((u) => ({
      userId: u.id, name: u.name, role: u.role, company: u.company,
      xontelAgentId: u.xontel_agent_id, xontelAgentName: u.xontel_agent_name,
      suggestion: u.xontel_agent_id ? null : (suggestions.get(u.id) || null),
    })),
  });
}));

api.put('/xontel/agent-map', requireRole('ADMIN'), wrap(async (req, res) => {
  const { userId, xontelAgentId, xontelAgentName } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId is required.' });
  const empName = await getUserName(userId);
  if (!xontelAgentId) {
    await pool.query('DELETE FROM xontel_agent_map WHERE user_id = $1', [userId]);
    await logAudit(req, { action: 'xontel.unlink', entityType: 'user', entityId: userId, summary: `Unlinked ${empName} from XonTel` });
    return res.json({ ok: true, linked: false });
  }
  // One XonTel agent belongs to one person.
  const { rows: clash } = await pool.query(
    `SELECT m.user_id, u.data->>'name' AS name FROM xontel_agent_map m LEFT JOIN users u ON u.id = m.user_id
      WHERE m.xontel_agent_id = $1 AND m.user_id <> $2`, [String(xontelAgentId), userId]
  );
  if (clash.length) return res.status(409).json({ error: `That XonTel agent is already linked to ${clash[0].name || clash[0].user_id}.` });
  await pool.query(
    `INSERT INTO xontel_agent_map (user_id, xontel_agent_id, xontel_agent_name, confirmed_by, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET xontel_agent_id = EXCLUDED.xontel_agent_id,
       xontel_agent_name = EXCLUDED.xontel_agent_name, confirmed_by = EXCLUDED.confirmed_by, updated_at = EXCLUDED.updated_at`,
    [userId, String(xontelAgentId), xontelAgentName || null, req.user?.id || null, Date.now()]
  );
  await logAudit(req, { action: 'xontel.link', entityType: 'user', entityId: userId, summary: `Linked ${empName} to XonTel agent ${xontelAgentName || xontelAgentId}`, details: { xontelAgentId, xontelAgentName } });
  res.json({ ok: true, linked: true });
}));

// ---- Agent KPIs ------------------------------------------------------------
// Per-agent call-centre numbers over a range of Kuwait days, from what Swipr
// already pulls from XonTel: the CDR for calls and talk time, the status feed
// for breaks / complain / everything else. Leads see their own department,
// Admin everyone.
//
// Definitions, kept here because every number on the page hangs off them:
// - answered: INCOMING calls the agent answered. missed ("not picked up"):
//   incoming calls that rang the agent and they didn't answer — the customer
//   may still have been answered by someone else. Outgoing calls are their
//   own numbers (outCalls / outAnswered): an outgoing call the customer
//   didn't pick up is not a missed call. Mixing them made 40 of 47 "missed"
//   on 2026-10-01 outgoing attempts, and the AHT 2:01 instead of 2:22.
// - talk: billsec of answered calls — real talk, not the "in call" STATUS,
//   which XonTel sometimes stops writing (none at all 2026-09-25..28).
//   talkSec (the day strip) counts both directions; inTalkSec is incoming.
// - AHT: incoming talk / incoming answered. XonTel's own AHT may add hold or
//   wrap-up time.
// - breaks: Break, Toilet, Pray, Eating (XONTEL_BREAK_STATUSES).
// - signed in: every status except offline. "Other": signed-in statuses that
//   are none of ready / in call / in chat / a break / Complain (Coaching,
//   Punching, Reportings…). Available = signed in minus talk, breaks,
//   complain and other — so the parts always add up to the signed-in time.
// The status feed only holds sessions that have ended, so today is partial.
const KPI_MAX_DAYS = 62;
const KPI_LONG_SIGNIN_SEC = 12 * 3600;
const KPI_ROLES = ['ADMIN', 'MANAGER', 'SUPERVISOR'];

// The linked agents a viewer may see — their own department for a lead,
// everyone for Admin — with the units among them for the filter.
async function kpiAgentsFor(req) {
  const admin = isAdmin(req);
  const viewer = admin ? null : await getViewer(req);
  const { rows: mapRows } = await pool.query(
    `SELECT m.user_id, m.xontel_agent_id, m.xontel_agent_name, u.data FROM xontel_agent_map m JOIN users u ON u.id = m.user_id`
  );
  const agents = mapRows
    .map((r) => ({ userId: r.user_id, agentId: String(r.xontel_agent_id), agentName: r.xontel_agent_name || '', user: { id: r.user_id, ...r.data } }))
    .filter((a) => admin || canSeeUser(viewer, a.user));
  const units = [...new Set(agents.map((a) => unitLine(a.user)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return { agents, units };
}

// from/to as Kuwait days, inclusive, capped — shared by every KPI route.
function kpiRange(req, res) {
  const today = dayKeyInAppTz(Date.now());
  const from = String(req.query.from || today);
  const to = String(req.query.to || from);
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  if (!DAY.test(from) || !DAY.test(to)) { res.status(400).json({ error: 'from/to must be YYYY-MM-DD' }); return null; }
  if (to < from) { res.status(400).json({ error: '"To" is before "From".' }); return null; }
  const lo = atKuwait(from, '00:00');
  const hi = atKuwait(addDays(to, 1), '00:00');
  if ((hi - lo) / DAY_MS > KPI_MAX_DAYS) { res.status(400).json({ error: `Pick at most ${KPI_MAX_DAYS} days.` }); return null; }
  return { from, to, lo, hi, today };
}

// Targets a lead sets once; a figure outside its target is flagged on the
// page. Stored as one row per key so a later target doesn't need a migration.
const KPI_TARGET_DEFAULTS = {
  ahtMaxSec: 180,            // average handle time, incoming
  breakMaxSecPerDay: 3600,   // break time per agent per day
  pickupMinPct: 95,          // incoming calls that rang the agent and were answered
  adherenceMinPct: 90,       // share of the shift signed in to XonTel
  lateLoginMaxMin: LATE_GRACE_MIN,
};
const KPI_TARGET_BOUNDS = {
  ahtMaxSec: [30, 3600], breakMaxSecPerDay: [0, 8 * 3600], pickupMinPct: [0, 100], adherenceMinPct: [0, 100], lateLoginMaxMin: [0, 240],
};
async function kpiTargets() {
  const { rows } = await pool.query('SELECT [key], value FROM kpi_targets');
  const t = { ...KPI_TARGET_DEFAULTS };
  for (const r of rows) if (r.key in t) t[r.key] = Number(r.value);
  return t;
}

api.get('/agent-kpis/targets', requireRole(...KPI_ROLES), wrap(async (req, res) => {
  res.json(await kpiTargets());
}));

api.put('/agent-kpis/targets', requireRole(...KPI_ROLES), wrap(async (req, res) => {
  const body = req.body || {};
  const changes = [];
  for (const key of Object.keys(KPI_TARGET_DEFAULTS)) {
    if (body[key] === undefined) continue;
    const v = Number(body[key]);
    const [lo, hi] = KPI_TARGET_BOUNDS[key];
    if (!Number.isFinite(v) || v < lo || v > hi) return res.status(400).json({ error: `${key} must be between ${lo} and ${hi}.` });
    changes.push([key, v]);
  }
  const now = Date.now();
  for (const [key, v] of changes) {
    await pool.query(
      `INSERT INTO kpi_targets (key, value, updated_by, updated_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
      [key, v, req.user.id, now]
    );
  }
  if (changes.length) {
    await logAudit(req, {
      action: 'kpi.targets', entityType: 'kpi_targets', entityId: 'global',
      summary: `${req.user.name} set KPI targets: ${changes.map(([k, v]) => `${k}=${v}`).join(', ')}`,
    });
  }
  res.json(await kpiTargets());
}));

// Shift adherence rows for the viewer's agents (see agentAdherence).
api.get('/agent-kpis/adherence', requireRole(...KPI_ROLES), wrap(async (req, res) => {
  const range = kpiRange(req, res);
  if (!range) return;
  const { from, to } = range;
  const { agents, units } = await kpiAgentsFor(req);
  const rows = await agentAdherence({ agents, from, to });
  const byUser = new Map(agents.map((a) => [a.userId, a.user]));
  const { rows: fp } = await pool.query(`SELECT last_sync_at FROM sync_state WHERE id = 'fingerprint'`);
  const st = await xontelState();
  res.json({
    from, to, units,
    lateGraceMin: LATE_GRACE_MIN, earlyLeaveMin: EARLY_LEAVE_MIN,
    fingerprintLastSync: fp.length ? Number(fp[0].last_sync_at) : null,
    xontelLastSync: Number(st?.last_sync_at || 0) || null,
    rows: rows.map((r) => {
      const u = byUser.get(r.userId);
      return { ...r, name: u?.name || '', unit: unitLine(u), employeeCode: u?.employeeId || '' };
    }),
  });
}));

// Missed customer calls — the queue-level list XonTel's own Missed Calls page
// shows — and who called each customer back (see xontelSyncMissed). The
// ledger is every call missed in the range, with its call-backs whenever they
// happened (a call missed at 23:22 was called back at 01:39 the next day);
// the per-agent table counts the call-backs MADE in the range, so it reads
// as that agent's work on those days.
api.get('/agent-kpis/missed', requireRole(...KPI_ROLES), wrap(async (req, res) => {
  const range = kpiRange(req, res);
  if (!range) return;
  const { from, to, lo, hi } = range;
  const { agents, units } = await kpiAgentsFor(req);
  const st = await xontelState();
  const admin = isAdmin(req);
  const [{ rows: calls }, { rows: oldest }] = await Promise.all([
    pool.query(
      `SELECT id, caller, queue, status, missed_ts, assignee, assigned_ts, closed FROM xontel_missed_calls
        WHERE missed_ts >= $1 AND missed_ts < $2 ORDER BY missed_ts DESC`,
      [lo, hi]
    ),
    pool.query(`SELECT MIN(missed_ts) AS ts FROM xontel_missed_calls`),
  ]);
  const [{ rows: cbForCalls }, { rows: cbInRange }] = await Promise.all([
    calls.length
      ? pool.query(
        `SELECT id, call_id, xontel_agent_name, outcome, at_ts FROM xontel_callbacks WHERE call_id = ANY($1) ORDER BY at_ts`,
        [calls.map((c) => c.id)]
      )
      : { rows: [] },
    pool.query(
      `SELECT cb.id, cb.call_id, cb.xontel_agent_name, cb.outcome, cb.at_ts, mc.missed_ts
         FROM xontel_callbacks cb LEFT JOIN xontel_missed_calls mc ON mc.id = cb.call_id
        WHERE cb.at_ts >= $1 AND cb.at_ts < $2`,
      [lo, hi]
    ),
  ]);

  // XonTel username → the Swipr user it is linked to (only ones this viewer
  // may see; the rest show by username, and only to an admin).
  const byName = new Map(agents.filter((a) => a.agentName).map((a) => [a.agentName, a]));
  const linkedName = (xname) => { const a = byName.get(xname); return a ? a.user.name : null; };
  const outcomeKey = (o) => { const s = String(o || '').toLowerCase(); return s === 'done' ? 'reached' : s === 'busy' ? 'busy' : /no\s*answer/.test(s) ? 'noAnswer' : 'other'; };

  const cbsByCall = new Map();
  for (const cb of cbForCalls) {
    if (!cbsByCall.has(cb.call_id)) cbsByCall.set(cb.call_id, []);
    cbsByCall.get(cb.call_id).push(cb);
  }
  const ledger = calls.map((c) => {
    const missedTs = Number(c.missed_ts);
    const assignedTs = c.assigned_ts === null ? null : Number(c.assigned_ts);
    // XonTel's close flag is the one truth: a row reads "Busy" after an agent
    // tried and got no one, and is still open — status alone is not "handled".
    const handled = !!c.closed;
    const cbs = (cbsByCall.get(c.id) || []).map((cb) => ({
      agent: linkedName(cb.xontel_agent_name) || cb.xontel_agent_name || '', linked: !!linkedName(cb.xontel_agent_name),
      outcome: cb.outcome || '', at: Number(cb.at_ts),
    }));
    const last = cbs[cbs.length - 1];
    return {
      id: c.id, missedTs, caller: c.caller || '', queue: c.queue || '',
      handled, status: c.status || '', assignee: c.assignee || null, assignedTs,
      // Missed → first action, whether or not the customer was reached (an
      // open "Busy" row still says how long the customer waited for a try).
      waitSec: assignedTs ? Math.max(0, Math.round((assignedTs - missedTs) / 1000)) : null,
      calledBackBy: last ? last.agent : (c.assignee || null),
      callbacks: cbs,
    };
  });

  const perAgent = new Map();
  for (const cb of cbInRange) {
    const xname = cb.xontel_agent_name || '';
    const a = byName.get(xname);
    if (!a && !admin) continue;
    const key = a ? a.userId : `x:${xname}`;
    if (!perAgent.has(key)) {
      perAgent.set(key, {
        userId: a ? a.userId : null, name: a ? a.user.name : xname, unit: a ? unitLine(a.user) : '', employeeCode: a ? (a.user.employeeId || '') : '',
        linked: !!a, callbacks: 0, reached: 0, busy: 0, noAnswer: 0, waitSum: 0, waitN: 0,
      });
    }
    const row = perAgent.get(key);
    row.callbacks++;
    const k = outcomeKey(cb.outcome);
    if (k in row) row[k]++;
    if (cb.missed_ts !== null && cb.missed_ts !== undefined) { row.waitSum += Math.max(0, (Number(cb.at_ts) - Number(cb.missed_ts)) / 1000); row.waitN++; }
  }
  const agentRows = [...perAgent.values()]
    .map(({ waitSum, waitN, ...r }) => ({ ...r, avgWaitSec: waitN ? Math.round(waitSum / waitN) : null }))
    .sort((a, b) => b.callbacks - a.callbacks || a.name.localeCompare(b.name));

  res.json({
    from, to, units,
    lastSync: Number(st?.detail?.missedAt || 0) || null,
    oldestMissed: oldest[0]?.ts === null || oldest[0]?.ts === undefined ? null : Number(oldest[0].ts),
    calls: ledger,
    agents: agentRows,
  });
}));

api.get('/agent-kpis', requireRole(...KPI_ROLES), wrap(async (req, res) => {
  const range = kpiRange(req, res);
  if (!range) return;
  const { from, to, lo, hi } = range;
  const { agents, units } = await kpiAgentsFor(req);
  const st = await xontelState();
  const base = { from, to, units, lastSync: Number(st?.last_sync_at || 0) || null, hourly: from === to };
  if (!agents.length) return res.json({ ...base, agents: [], series: [], agentDays: [] });

  const agentIds = agents.map((a) => a.agentId);
  const [{ rows: sess }, { rows: calls }] = await Promise.all([
    pool.query(
      `SELECT xontel_agent_id, status, start_ts, end_ts FROM xontel_sessions
        WHERE xontel_agent_id = ANY($1) AND start_ts < $3 AND coalesce(end_ts, start_ts) > $2`,
      [agentIds, lo, hi]
    ),
    pool.query(
      `SELECT xontel_agent_id, start_ts, status, talk_sec, direction FROM xontel_calls
        WHERE xontel_agent_id = ANY($1) AND start_ts >= $2 AND start_ts < $3`,
      [agentIds, lo, hi]
    ),
  ]);

  const blank = () => ({ answered: 0, missed: 0, inTalkSec: 0, outCalls: 0, outAnswered: 0, talkSec: 0, signedInSec: 0, breakSec: 0, breakCount: 0, complainSec: 0, otherSec: 0 });
  const perAgent = new Map(agents.map((a) => [a.agentId, blank()]));
  const perDay = new Map();                       // `${agentId}|${day}` -> totals
  const dayOf = (ts) => dayKeyInAppTz(ts);
  const cell = (agentId, day) => {
    const k = `${agentId}|${day}`;
    if (!perDay.has(k)) perDay.set(k, blank());
    return perDay.get(k);
  };

  // Status time, split at every Kuwait midnight so a session across one
  // counts toward each day it touches.
  for (const s of sess) {
    const status = String(s.status || '').toLowerCase();
    if (XONTEL_IDLE_STATUSES.has(status)) continue;
    let a = Math.max(Number(s.start_ts), lo);
    const b = Math.min(Number(s.end_ts ?? s.start_ts), hi);
    const isBreak = isXontelBreakStatus(status);
    const kind = isBreak ? 'breakSec'
      : status === 'complain' ? 'complainSec'
      : XONTEL_AVAILABLE_STATUSES.has(status) ? null
      : 'otherSec';
    const tot = perAgent.get(String(s.xontel_agent_id));
    if (!tot) continue;
    if (isBreak && Number(s.start_ts) >= lo) {
      tot.breakCount++;
      cell(String(s.xontel_agent_id), dayOf(Number(s.start_ts))).breakCount++;
    }
    while (a < b) {
      const day = dayOf(a);
      const dayEnd = Math.min(atKuwait(addDays(day, 1), '00:00'), b);
      const sec = (dayEnd - a) / 1000;
      const c = cell(String(s.xontel_agent_id), day);
      tot.signedInSec += sec; c.signedInSec += sec;
      if (kind) { tot[kind] += sec; c[kind] += sec; }
      a = dayEnd;
    }
  }

  // Calls, and the team series: per hour for a single day, per day otherwise.
  const series = new Map();
  if (base.hourly) for (let h = 0; h < 24; h++) series.set(String(h).padStart(2, '0'), { key: String(h).padStart(2, '0'), answered: 0, missed: 0 });
  else for (let d = from; d <= to; d = addDays(d, 1)) series.set(d, { key: d, answered: 0, missed: 0 });
  const hourOf = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', hour12: false, timeZone: TZ }).slice(0, 2);
  for (const c of calls) {
    const ts = Number(c.start_ts);
    const tot = perAgent.get(String(c.xontel_agent_id));
    if (!tot) continue;
    const day = dayOf(ts);
    const d = cell(String(c.xontel_agent_id), day);
    const pt = series.get(base.hourly ? hourOf(ts) : day);
    const answered = c.status === 'Answered';
    const talk = answered ? Number(c.talk_sec) || 0 : 0;
    if (c.direction === 'Incoming') {
      if (answered) {
        tot.answered++; tot.inTalkSec += talk; d.answered++; d.inTalkSec += talk;
        if (pt) pt.answered++;
      } else {
        tot.missed++; d.missed++;
        if (pt) pt.missed++;
      }
    } else if (c.direction === 'Outgoing') {
      tot.outCalls++; d.outCalls++;
      if (answered) { tot.outAnswered++; d.outAnswered++; }
    } else {
      continue;                                   // internal / unknown
    }
    tot.talkSec += talk; d.talkSec += talk;
  }

  const finish = (t) => {
    const r = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v)]));
    r.ahtSec = r.answered ? Math.round(r.inTalkSec / r.answered) : 0;   // incoming only
    r.availableSec = Math.max(0, r.signedInSec - r.talkSec - r.breakSec - r.complainSec - r.otherSec);
    return r;
  };
  const byAgentId = new Map(agents.map((a) => [a.agentId, a]));
  const activeDays = new Map();
  for (const [k, t] of perDay) if (t.signedInSec > 0 || t.answered > 0 || t.outCalls > 0) {
    const id = k.split('|')[0];
    activeDays.set(id, (activeDays.get(id) || 0) + 1);
  }

  res.json({
    ...base,
    agents: agents.map((a) => {
      const t = finish(perAgent.get(a.agentId));
      const days = activeDays.get(a.agentId) || 0;
      // Signed in far longer than any shift, per day on average: almost
      // always a status left on overnight rather than a real working day.
      const flags = days && t.signedInSec / days > KPI_LONG_SIGNIN_SEC ? ['long_signin'] : [];
      return {
        userId: a.userId, name: a.user.name || '', unit: unitLine(a.user),
        employeeCode: a.user.employeeId || '', activeDays: days, flags, ...t,
      };
    }).filter((a) => a.activeDays > 0),
    series: [...series.values()],
    agentDays: [...perDay.entries()].map(([k, t]) => {
      const [agentId, day] = k.split('|');
      const a = byAgentId.get(agentId);
      return { userId: a.userId, day, ...finish(t) };
    }).filter((r) => r.signedInSec > 0 || r.answered > 0 || r.missed > 0 || r.outCalls > 0)
      .sort((x, y) => x.day.localeCompare(y.day)),
  });
}));

// ---- Shift adherence (roster vs XonTel vs fingerprint) -----------------------
// For each rostered shift of a linked agent: when they signed in to XonTel,
// when they signed out, how much of the shift they were signed in, and when
// the fingerprint terminal saw them. The shift instants come from the same
// anchorShift() the lateness engine uses, and the fingerprint times from its
// attendance_daily rows, so this page and Lateness never tell different
// stories about the same shift. Thresholds are the lateness page's too
// (LATE_GRACE_MIN, EARLY_LEAVE_MIN).
//
// "Signed in" = any XonTel status but offline — breaks included, because a
// break is part of the shift. A login up to 2h before the start counts for
// that shift; sessions up to 3h after the end count toward its sign-out.
// XonTel only reports a status once it ends, so for a shift still running
// the agent's live status (from the 1-minute tick) covers the gap since their
// last finished session.
const ADHERENCE_DAY_TYPES = new Set(['NORMAL_SHIFT', 'WORK_FROM_HOME', 'TARDY', 'EARLY_LEAVE', 'DELAY_WAS_PERMISSION', 'CANCEL_OFF']);
const ADH_EARLY_LOGIN_MS = 2 * 60 * 60 * 1000;
const ADH_LATE_LOGOUT_MS = 3 * 60 * 60 * 1000;
const ADH_NO_LOGIN_AFTER_MS = 60 * 60 * 1000;
let xontelLiveSnapshot = { at: 0, byAgent: new Map() };

async function agentAdherence({ agents, from, to, now = Date.now() }) {
  if (!agents.length) return [];
  const userIds = agents.map((a) => a.userId);
  const agentOf = new Map(agents.map((a) => [a.userId, String(a.agentId)]));
  // A day either side, so an early-morning row can be tested for collision
  // against its neighbours exactly as recomputeLateness does.
  const { rows: sched } = await pool.query(
    `SELECT user_id, date, data FROM schedules WHERE user_id = ANY($1) AND date >= $2 AND date <= $3`,
    [userIds, addDays(from, -1), addDays(to, 1)]
  );
  const shifts = [];
  const byUser = new Map();
  for (const r of sched) {
    if (!ADHERENCE_DAY_TYPES.has(r.data?.type)) continue;
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id).push(r);
  }
  for (const [userId, rows] of byUser) {
    const plain = [];
    for (const r of rows) {
      const st = r.data?.shift?.startTime;
      if (HHMM.test(st || '') && Number(st.slice(0, 2)) >= 6) { const w = anchorShift(r.date, r.data.shift); if (w) plain.push(w); }
    }
    for (const r of rows) {
      if (r.date < from || r.date > to) continue;
      const w = anchorShift(r.date, r.data?.shift, plain);
      if (w) shifts.push({ userId, date: r.date, dayType: r.data.type, start: w.start, end: w.end });
    }
  }
  if (!shifts.length) return [];

  const lo = Math.min(...shifts.map((s) => s.start)) - ADH_EARLY_LOGIN_MS;
  const hi = Math.max(...shifts.map((s) => s.end)) + ADH_LATE_LOGOUT_MS;
  const [{ rows: sess }, { rows: daily }] = await Promise.all([
    pool.query(
      `SELECT xontel_agent_id, status, start_ts, end_ts FROM xontel_sessions
        WHERE xontel_agent_id = ANY($1) AND start_ts < $3 AND coalesce(end_ts, start_ts) > $2 ORDER BY start_ts`,
      [[...new Set(agentOf.values())], lo, hi]
    ),
    pool.query(
      `SELECT user_id, date, arrival_ts, departure_ts FROM attendance_daily WHERE user_id = ANY($1) AND date >= $2 AND date <= $3`,
      [userIds, from, to]
    ),
  ]);
  const sessOf = new Map();
  for (const s of sess) {
    if (XONTEL_IDLE_STATUSES.has(String(s.status).toLowerCase())) continue;
    const k = String(s.xontel_agent_id);
    if (!sessOf.has(k)) sessOf.set(k, []);
    sessOf.get(k).push({ start: Number(s.start_ts), end: Number(s.end_ts ?? s.start_ts) });
  }
  const fp = new Map(daily.map((d) => [`${d.user_id}|${d.date}`, d]));
  const liveFresh = now - xontelLiveSnapshot.at < 5 * 60 * 1000;

  return shifts.map((s) => {
    const agentId = agentOf.get(s.userId);
    const list = (sessOf.get(agentId) || []).filter((x) => x.end > s.start - ADH_EARLY_LOGIN_MS && x.start < s.end + ADH_LATE_LOGOUT_MS);
    const running = now < s.end;
    // Still signed in right now: count from their last finished session to now.
    const live = liveFresh ? xontelLiveSnapshot.byAgent.get(agentId) : null;
    if (running && now > s.start && live && !XONTEL_IDLE_STATUSES.has(String(live.status).toLowerCase())) {
      const lastEnd = list.length ? Math.max(...list.map((x) => x.end)) : now;
      list.push({ start: Math.min(lastEnd, now), end: now, live: true });
    }
    const logins = list.filter((x) => x.start < s.end).map((x) => x.start);
    const loginTs = logins.length ? Math.max(Math.min(...logins), s.start - ADH_EARLY_LOGIN_MS) : null;
    const finished = list.filter((x) => !x.live);
    const logoutTs = !running && finished.length ? Math.max(...finished.map((x) => x.end)) : null;
    const until = Math.min(s.end, now);
    let signedInMs = 0;
    if (until > s.start) {
      // Union of overlaps, so overlapping sessions never count twice.
      const parts = list.map((x) => [Math.max(x.start, s.start), Math.min(x.end, until)]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
      let cur = null;
      for (const [a, b] of parts) {
        if (!cur || a > cur[1]) { if (cur) signedInMs += cur[1] - cur[0]; cur = [a, b]; } else cur[1] = Math.max(cur[1], b);
      }
      if (cur) signedInMs += cur[1] - cur[0];
    }
    const elapsedMs = Math.max(0, until - s.start);
    const loginLateMin = loginTs === null ? null : Math.round((loginTs - s.start) / 60000);
    const earlyLogoutMin = logoutTs === null ? null : Math.max(0, Math.round((s.end - logoutTs) / 60000));
    const f = fp.get(`${s.userId}|${s.date}`);
    let status;
    if (now < s.start) status = 'upcoming';
    else if (loginTs === null) status = now > s.start + ADH_NO_LOGIN_AFTER_MS ? 'no_login' : 'upcoming';
    else if (loginLateMin > LATE_GRACE_MIN) status = 'late_login';
    else if (earlyLogoutMin !== null && earlyLogoutMin > EARLY_LEAVE_MIN) status = 'early_logout';
    else status = 'ok';
    return {
      userId: s.userId, date: s.date, dayType: s.dayType, shiftStart: s.start, shiftEnd: s.end, running,
      loginTs, logoutTs, loginLateMin, earlyLogoutMin,
      signedInSec: Math.round(signedInMs / 1000), elapsedSec: Math.round(elapsedMs / 1000),
      adherencePct: elapsedMs > 0 ? Math.round((signedInMs / elapsedMs) * 100) : null,
      fpIn: f?.arrival_ts ? Number(f.arrival_ts) : null, fpOut: f?.departure_ts ? Number(f.departure_ts) : null,
      status,
    };
  });
}

// Read-only discovery: fetch a few XonTel endpoints whose response shape is
// unknown and keep a trimmed copy of each in sync_state ('xontel_probe').
async function xontelProbe() {
  if (!xontelConfigured()) return;
  const today = dayKeyInAppTz(Date.now());
  // Per-agent days where the stored feed shows a one-minute session and then
  // nothing — asked for directly (user=) so paging can't hide anything.
  // Walaa 09-30 is the control: fully covered in the store.
  const paths = [
    '/api/v1/account/agentstatus?user=20&from_date=2026-09-30&to_date=2026-09-30&page=1&size=300',
    '/api/v1/account/agentstatus?user=62&from_date=2026-09-29&to_date=2026-09-29&page=1&size=300',
    '/api/v1/account/agentstatus?user=71&from_date=2026-09-30&to_date=2026-09-30&page=1&size=300',
    '/api/v1/account/agentstatus?user=75&from_date=2026-09-30&to_date=2026-09-30&page=1&size=300',
    '/api/v1/account/user-status/?user=20',
    '/api/v1/account/agentstatus?page=1&size=40',
    '/api/v1/xontel_helper/missed_calls_dashboard?page=1&page_size=100',
    '/api/v1/xontel_queue/missedcallhistory?page=1&size=100&from_date=2026-09-24&to_date=2026-10-01',
  ];
  // Keep only the fields that answer the question, so a day's rows fit.
  const compact = (j) => {
    const rows = Array.isArray(j) ? j : j?.results || j?.abandoned_calls_page_obj?.data;
    if (!Array.isArray(rows)) return JSON.stringify(j).slice(0, 4000);
    const seen = new Set();
    const lines = [];
    for (const r of rows) {
      const line = [r.id, r.status ?? r.call_status, r.from_time ?? r.time ?? r.assigned_time, r.to_time ?? r.assignee ?? r.agent, r.caller ?? '', r.queue ?? '', r.assigned_time ?? '']
        .map((v) => (v === null || v === undefined ? '' : String(v))).join(' | ');
      if (!seen.has(line)) { seen.add(line); lines.push(line); }
    }
    return `count=${j?.count ?? rows.length} distinct=${lines.length}\n` + lines.join('\n').slice(0, 9000);
  };
  const out = { at: Date.now() };
  for (const p of paths) {
    try {
      out[p] = compact(await xontelGet(p));
    } catch (e) {
      out[p] = `ERROR ${e.message}`;
    }
  }
  await pool.query(
    `INSERT INTO sync_state (id, last_sync_at, detail) VALUES ('xontel_probe', $1, $2::jsonb)
     ON CONFLICT (id) DO UPDATE SET last_sync_at = EXCLUDED.last_sync_at, detail = EXCLUDED.detail`,
    [Date.now(), J(out)]
  );
  console.log('[xontel] probe saved');
}

// One person's XonTel day, for the panel behind an avatar on the attendance
// board. The window is anchored to that person's own fingerprint shift where
// there is one, so an overnight shift shows its whole span and tomorrow's
// morning session does not leak in.
api.get('/xontel/day', requireRole('ADMIN'), wrap(async (req, res) => {
  const { userId } = req.query;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : null;
  if (!userId || !date) return res.status(400).json({ error: 'userId and date are required.' });

  const { rows: map } = await pool.query(
    'SELECT xontel_agent_id, xontel_agent_name FROM xontel_agent_map WHERE user_id = $1', [userId]
  );
  const dayStart = atKuwait(date, '00:00');
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;

  // Same shift attribution the board uses: a shift belongs to the day its IN
  // falls on, and may run past midnight.
  const { rows: punches } = await pool.query(
    'SELECT kind, ts FROM attendance WHERE user_id = $1 AND ts >= $2 AND ts < $3 ORDER BY ts',
    [userId, dayStart, dayEnd + SHIFT_GAP_MS]
  );
  const scans = [];
  let seenIn = false;
  for (const p of punches) {
    const ts = Number(p.ts);
    if (p.kind === 'IN' && ts >= dayEnd) break;
    if (p.kind === 'OUT' && !seenIn) continue;
    if (p.kind === 'IN') seenIn = true;
    scans.push({ kind: p.kind, ts });
  }
  const firstIn = scans.find((s) => s.kind === 'IN')?.ts ?? null;
  const lastOut = [...scans].reverse().find((s) => s.kind === 'OUT')?.ts ?? null;

  if (!map.length) {
    return res.json({ mapped: false, configured: xontelConfigured(), firstIn, lastOut, sessions: [], calls: [], talkSeconds: 0 });
  }
  const lo = firstIn !== null ? firstIn - ARRIVAL_WINDOW_MS : dayStart;
  const hi = (lastOut ?? firstIn ?? dayEnd) + ARRIVAL_WINDOW_MS;

  const { rows: sess } = await pool.query(
    `SELECT status, start_ts, end_ts, duration_sec FROM xontel_sessions
      WHERE xontel_agent_id = $1 AND start_ts >= $2 AND start_ts <= $3 ORDER BY start_ts`,
    [map[0].xontel_agent_id, lo, hi]
  );
  const { rows: callRows } = await pool.query(
    `SELECT start_ts, duration_sec, talk_sec, direction, status, caller_number, queue
       FROM xontel_calls
      WHERE xontel_agent_id = $1 AND start_ts >= $2 AND start_ts <= $3 ORDER BY start_ts`,
    [map[0].xontel_agent_id, lo, hi]
  );
  const sessions = sess.map((s) => {
    const k = String(s.status).toLowerCase();
    return {
      status: s.status,
      startTs: Number(s.start_ts),
      endTs: s.end_ts === null ? null : Number(s.end_ts),
      durationSec: s.duration_sec,
      signedIn: !XONTEL_IDLE_STATUSES.has(k),
      available: XONTEL_AVAILABLE_STATUSES.has(k),
    };
  });
  const signedIn = sessions.filter((s) => s.signedIn);
  const ends = signedIn.map((s) => s.endTs).filter((e) => e !== null);
  const loginTs = signedIn.length ? signedIn[0].startTs : null;
  const logoutTsRaw = ends.length ? Math.max(...ends) : null;

  // Everything below describes the working day, so it is bounded by the
  // login and the logout. Without that bound the signed-out span after
  // logout gets counted: one agent's day showed "offline 16h 17m" beside
  // "ready 6h 23m" — the sixteen hours being the evening, the night, and the
  // next morning until she signed in again. Sessions are clipped to the
  // window, and one that lies entirely outside it drops out.
  const winStart = loginTs;
  const winEnd = logoutTsRaw ?? (sessions.length
    ? Math.max(...sessions.map((s) => s.endTs ?? s.startTs)) : null);
  const clippedSec = (s) => {
    if (winStart === null || winEnd === null) return s.durationSec || 0;
    const a = Math.max(s.startTs, winStart);
    const b = Math.min(s.endTs ?? winEnd, winEnd);
    return b > a ? Math.round((b - a) / 1000) : 0;
  };
  // What the day is made of, with anything outside login→logout removed.
  const inDay = sessions.filter((s) => clippedSec(s) > 0);

  // The "in call" status is dropped everywhere — the real calls replace it —
  // but dropping it leaves the spells that surrounded it sitting next to each
  // other. One agent's coaching read as six rows between 14:51 and 15:08,
  // split only by in-call flickers of a second or two. A run of one status
  // separated by nothing but dropped entries is one spell, so it is stitched
  // back into one, and the totals count it once.
  const spells = [];
  for (const s of inDay) {
    if (s.status === 'in call') continue;
    const prev = spells[spells.length - 1];
    // If the last kept spell has the same status, everything between them in
    // the original run was an in-call flicker — any other status would have
    // been kept and become `prev` instead. So this is the same spell.
    if (prev && prev.status === s.status) {
      prev.endTs = s.endTs;
      prev.durationSec += clippedSec(s);
      continue;
    }
    spells.push({ ...s, durationSec: clippedSec(s) });
  }
  const timeline = spells;
  res.json({
    mapped: true,
    configured: xontelConfigured(),
    agentName: map[0].xontel_agent_name,
    firstIn, lastOut,
    loginTs,
    logoutTs: logoutTsRaw,
    // Signed in but not reachable — breaks, prayer, coaching and the rest.
    awaySeconds: timeline.filter((s) => s.signedIn && !s.available)
      .reduce((n, s) => n + s.durationSec, 0),
    // Real talk time is the measured figure; the "ready" status is what is
    // left of being reachable once the calls are taken out of it.
    availableSeconds: timeline.filter((s) => s.available)
      .reduce((n, s) => n + s.durationSec, 0),
    // How the day actually divided up: total time and number of spells per
    // status. A day is a few dozen short sessions, so the per-status total is
    // the only form in which it can be read at a glance.
    // Real calls in the same window: the only trustworthy answer to "how
    // long were they on the phone, and between which minutes".
    calls: callRows.map((c) => ({
      startTs: Number(c.start_ts),
      endTs: Number(c.start_ts) + (c.duration_sec || 0) * 1000,
      durationSec: c.duration_sec,
      talkSec: c.talk_sec,
      direction: c.direction,
      status: c.status,
      number: c.caller_number,
      queue: c.queue,
    })),
    talkSeconds: callRows.reduce((n, c) => n + (c.talk_sec || 0), 0),
    // The "in call" status is parked, not measured: the part of it with no
    // call underneath is what was hiding inside "1h27m in call". Reported so
    // that statuses + talk + this add back up to the working day, instead of
    // the phantom simply vanishing into a gap.
    phantomCallSeconds: Math.max(0,
      inDay.filter((s) => s.status === 'in call').reduce((n, s) => n + clippedSec(s), 0)
      - callRows.reduce((n, c) => n + (c.talk_sec || 0), 0)),
    answeredCalls: callRows.filter((c) => (c.talk_sec || 0) > 0).length,
    missedCalls: callRows.filter((c) => !(c.talk_sec > 0)).length,
    totals: [...timeline.reduce((m, s) => {
      const cur = m.get(s.status) || { status: s.status, seconds: 0, count: 0, signedIn: s.signedIn, available: s.available };
      cur.seconds += s.durationSec;
      cur.count += 1;
      m.set(s.status, cur);
      return m;
    }, new Map()).values()].sort((a, b) => b.seconds - a.seconds),
    // The timeline is the same set the totals are built from, so a row can
    // never claim time the totals above it do not count.
    sessions: timeline,
  });
}));

// Manual pull for a range — the first backfill, or after a link is added.
api.post('/xontel/sync', requireRole('ADMIN'), wrap(async (req, res) => {
  if (!xontelConfigured()) return res.status(503).json({ error: 'XonTel is not configured on this server.' });
  const { from, to } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) {
    return res.status(400).json({ error: 'from and to are required (YYYY-MM-DD).' });
  }
  if (to < from) return res.status(400).json({ error: 'to must not be before from.' });
  try {
    const r = await xontelSync({ fromDate: from, toDate: to, full: true });
    const c = await xontelSyncCalls({ fromDate: from, toDate: to, full: true });
    await logAudit(req, { action: 'xontel.sync', entityType: 'xontel', entityId: `${from}..${to}`, summary: `Pulled ${r.stored} XonTel session(s) and ${c.stored} call(s) for ${from} → ${to}`, details: { sessions: r, calls: c } });
    res.json({ ...r, calls: c });
  } catch (e) {
    xontelLastError = e.message;
    res.status(502).json({ error: `XonTel: ${e.message}` });
  }
}));

// Confirming is what turns a computed number into a record. The engine never
// writes to the roster itself: every schedule write notifies the employee, and
// a recompute runs every few minutes, so an automatic write would both spam
// them and overwrite whatever a manager had decided.
// What each decision writes onto the roster. DISMISS writes nothing: it only
// records that a human looked and chose to leave the day alone.
const REVIEW_ACTIONS = {
  CONFIRM:     { type: 'TARDY',       usesMinutes: 'offset_min',      label: 'late' },
  EARLY_LEAVE: { type: 'EARLY_LEAVE', usesMinutes: 'early_leave_min', label: 'an early leave' },
  ABSENT:      { type: 'ABSENT',      usesMinutes: null,              label: 'absent' },
  DISMISS:     null,
};

api.post('/attendance/lateness/review', requireRole('ADMIN'), wrap(async (req, res) => {
  const { userId, date, action, minutes } = req.body || {};
  if (!userId || !date) return res.status(400).json({ error: 'userId and date are required.' });
  if (!(action in REVIEW_ACTIONS)) {
    return res.status(400).json({ error: `action must be one of ${Object.keys(REVIEW_ACTIONS).join(', ')}.` });
  }

  const { rows } = await pool.query(
    'SELECT * FROM attendance_daily WHERE user_id = $1 AND date = $2', [userId, date]
  );
  const finding = rows[0];
  if (!finding) return res.status(404).json({ error: 'No finding for that day.' });

  const empName = await getUserName(userId);
  const spec = REVIEW_ACTIONS[action];
  let merged = null;

  if (spec) {
    let mins = null;
    if (spec.usesMinutes) {
      mins = Number.isFinite(Number(minutes)) ? Math.round(Number(minutes)) : finding[spec.usesMinutes];
      if (!Number.isFinite(mins) || mins <= 0) {
        return res.status(400).json({ error: 'A positive number of minutes is required for that decision.' });
      }
    }
    const client = await pool.connect();
    try {
      const existing = await getDay(client, userId, date);
      // A day a manager already explained is theirs to change, in the roster,
      // not something a one-click suggestion may overwrite. Recording an
      // early leave on a day already typed EARLY_LEAVE is the same decision,
      // so only a conflicting one is refused.
      if (existing && EXCUSED_DAY_TYPES.has(existing.type) && existing.type !== spec.type) {
        return res.status(409).json({ error: 'That day is already recorded as permitted; change it in the roster instead.' });
      }
      // Keeps the shift and every other field: only the classification and the
      // minute count change, which is exactly what a manager types by hand
      // today, so the existing badge, roster cell and exports light up.
      merged = { ...(existing || {}), type: spec.type, date };
      if (mins === null) delete merged.minutes; else merged.minutes = mins;
      await upsertDay(client, userId, date, merged);
    } finally {
      client.release();
    }
    const startTxt = finding.scheduled_start ? fmtClock(Number(finding.scheduled_start)) : date;
    const endTxt = finding.scheduled_end ? fmtClock(Number(finding.scheduled_end)) : '';
    await notify(userId, 'attendance',
      action === 'CONFIRM' ? 'Late arrival recorded'
        : action === 'EARLY_LEAVE' ? 'Early leave recorded'
          : 'Absence recorded',
      action === 'CONFIRM' ? `${date} · ${mins} min after your ${startTxt} start`
        : action === 'EARLY_LEAVE' ? `${date} · left ${mins} min before your ${endTxt} finish`
          : `${date} · no clock-in was recorded for your ${startTxt} shift`);
  }

  await pool.query(
    `UPDATE attendance_daily
        SET reviewed_by = $3, reviewed_name = $4, reviewed_at = $5, review_action = $6
      WHERE user_id = $1 AND date = $2`,
    [userId, date, req.user?.id || null, req.user?.name || 'System', Date.now(), action]
  );
  await logAudit(req, {
    action: 'attendance.lateness-review', entityType: 'attendance', entityId: `${userId}:${date}`,
    summary: spec
      ? `Recorded ${empName} ${spec.label} on ${date}${merged.minutes ? ` (${merged.minutes} min)` : ''}`
      : `Dismissed the attendance finding for ${empName} on ${date}`,
    details: {
      userId, date, action, status: finding.status,
      deviceOffsetMin: finding.offset_min, deviceEarlyLeaveMin: finding.early_leave_min,
      recordedType: spec?.type ?? null, recordedMinutes: merged?.minutes ?? null,
    },
  });
  res.json({ ok: true, action, day: merged });
}));

// ---- Profile photo (self-service) ------------------------------------------
// Any logged-in user may set or clear their own photo. Stored as a data URI
// (the client resizes/compresses it first), capped well under the request
// body limit so one oversized upload can't bloat the users table.
const MAX_PHOTO_DATA_URI_LEN = 400_000; // ~290KB decoded

api.post('/profile/photo', wrap(async (req, res) => {
  const photoUrl = req.body?.photoUrl;
  if (typeof photoUrl !== 'string' || !/^data:image\/(png|jpe?g|webp);base64,/.test(photoUrl)) {
    return res.status(400).json({ error: 'photoUrl must be a PNG/JPEG/WEBP data URI.' });
  }
  if (photoUrl.length > MAX_PHOTO_DATA_URI_LEN) {
    return res.status(400).json({ error: 'Image is too large after compression.' });
  }
  const { rows } = await pool.query('SELECT data FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  const merged = { ...rows[0].data, photoUrl };
  await pool.query('UPDATE users SET data = $2::jsonb WHERE id = $1', [req.user.id, J(merged)]);
  await logAudit(req, { action: 'user.photo', entityType: 'user', entityId: req.user.id, summary: 'Updated their profile photo' });
  res.json(sanitizeUser({ id: req.user.id, data: merged }));
}));

api.delete('/profile/photo', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT data FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  const merged = { ...rows[0].data };
  delete merged.photoUrl;
  await pool.query('UPDATE users SET data = $2::jsonb WHERE id = $1', [req.user.id, J(merged)]);
  await logAudit(req, { action: 'user.photo', entityType: 'user', entityId: req.user.id, summary: 'Removed their profile photo' });
  res.json(sanitizeUser({ id: req.user.id, data: merged }));
}));

// ---- Overtime monthly report ------------------------------------------------
// Sums the per-shift overtimeHours a manager has entered on schedule days,
// for payroll. `month` is YYYY-MM; defaults to the current month. Scope
// follows canWriteSchedule, so Branch/Area/Operation Manager and Admin each
// see their own reach.
api.get('/overtime/report', requireRole('BRANCH_MANAGER', 'AREA_MANAGER', 'OPERATION_MANAGER', 'ADMIN'), wrap(async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
  const rangeStart = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const rangeEnd = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;

  const viewer = await getViewer(req);
  const { rows: userRows } = await pool.query(
    `SELECT id, data FROM users WHERE data->>'role' = 'BRANCH_EMPLOYEE'`
  );
  const team = userRows
    .map((r) => ({ id: r.id, ...r.data }))
    .filter((u) => isAdmin(req) || canWriteSchedule(viewer, u));
  if (!team.length) return res.json({ month, rows: [] });

  const ids = team.map((u) => u.id);
  const { rows: days } = await pool.query(
    `SELECT user_id, date, data FROM schedules
     WHERE user_id = ANY($1) AND date >= $2 AND date < $3
       AND (data->>'overtimeHours') IS NOT NULL AND (data->>'overtimeHours')::numeric > 0`,
    [ids, rangeStart, rangeEnd]
  );

  const byUser = new Map();
  for (const d of days) {
    if (!byUser.has(d.user_id)) byUser.set(d.user_id, { totalHours: 0, days: [] });
    const agg = byUser.get(d.user_id);
    const hours = Number(d.data.overtimeHours) || 0;
    agg.totalHours += hours;
    agg.days.push({ date: d.date, hours });
  }
  const rows = team
    .map((u) => {
      const agg = byUser.get(u.id) || { totalHours: 0, days: [] };
      return {
        id: u.id, name: u.name, employeeCode: u.employeeId || '',
        brand: u.brand || '', branch: u.branch || '',
        totalHours: agg.totalHours, days: agg.days.sort((a, b) => a.date.localeCompare(b.date)),
      };
    })
    .filter((r) => r.totalHours > 0)
    .sort((a, b) => b.totalHours - a.totalHours);
  res.json({ month, rows });
}));

// ---- Aggregate snapshot ---------------------------------------------------
api.get('/app-data', wrap(async (req, res) => {
  const [usersR, swapsR, schedR, leavesR, holsR] = await Promise.all([
    pool.query('SELECT id, data FROM users'),
    pool.query('SELECT id, data FROM swap_requests'),
    pool.query('SELECT user_id, date, data FROM schedules'),
    pool.query('SELECT id, data FROM leave_requests ORDER BY created_at DESC NULLS LAST'),
    pool.query('SELECT id, data FROM public_holidays'),
  ]);

  const admin = isAdmin(req);
  const viewer = admin ? null : await getViewer(req);
  const visible = (r) => admin || canSeeUser(viewer, { id: r.id, ...r.data });
  const allowedIds = new Set(usersR.rows.filter(visible).map((r) => r.id));

  const schedules = {};
  for (const r of schedR.rows) {
    if (!admin && !allowedIds.has(r.user_id)) continue;
    (schedules[r.user_id] ||= {})[r.date] = r.data;
  }

  res.json({
    users: usersR.rows.filter(visible).map(sanitizeUser),
    swapRequests: swapsR.rows.map((r) => ({ ...r.data, id: r.id }))
      .filter((s) => admin || allowedIds.has(s.requesterId) || allowedIds.has(s.targetId)),
    schedules,
    leaveRequests: leavesR.rows.map((r) => ({ ...r.data, id: r.id }))
      .filter((l) => admin || allowedIds.has(l.userId)),
    publicHolidays: holsR.rows.map((r) => ({ ...r.data, id: r.id })),
  });
}));

// ---- Notifications (per-user) ---------------------------------------------
api.get('/notifications', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, type, title, body, created_at, read_at FROM notifications
     WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [req.user.id]
  );
  const items = rows.map((r) => ({
    id: r.id, type: r.type, title: r.title, body: r.body,
    ts: Number(r.created_at), read: r.read_at != null,
  }));
  res.json({ items, unread: items.filter((i) => !i.read).length });
}));

api.post('/notifications/read', wrap(async (req, res) => {
  const ids = req.body && req.body.ids;
  if (Array.isArray(ids) && ids.length) {
    await pool.query('UPDATE notifications SET read_at = $1 WHERE user_id = $2 AND id = ANY($3)', [Date.now(), req.user.id, ids]);
  } else {
    await pool.query('UPDATE notifications SET read_at = $1 WHERE user_id = $2 AND read_at IS NULL', [Date.now(), req.user.id]);
  }
  res.json({ success: true });
}));

// ---- Web push subscriptions -------------------------------------------------
api.get('/push/vapid-public-key', wrap(async (req, res) => {
  res.json({ key: pushEnabled ? VAPID_PUBLIC_KEY : null });
}));

api.post('/push/subscribe', wrap(async (req, res) => {
  const sub = req.body || {};
  if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return res.status(400).json({ error: 'Invalid push subscription.' });
  }
  await pool.query(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, keys, created_at)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = $2, keys = $4::jsonb`,
    [genId(), req.user.id, sub.endpoint, J(sub.keys), Date.now()]
  );
  res.json({ success: true });
}));

api.post('/push/unsubscribe', wrap(async (req, res) => {
  const endpoint = req.body?.endpoint;
  if (endpoint) await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, req.user.id]);
  res.json({ success: true });
}));

// ---- Native push token (Android app) ----------------------------------------
api.post('/push/fcm-token', wrap(async (req, res) => {
  const token = req.body?.token;
  if (!token) return res.status(400).json({ error: 'Missing token.' });
  await pool.query(
    `INSERT INTO fcm_tokens (id, user_id, token, created_at)
     VALUES ($1, $2, $3, $4)
     -- A token belongs to one device; if it was previously registered to a
     -- different account (a shared device, someone logging out and back in
     -- as someone else) it must move to whoever holds it now, not stay
     -- pointed at the old owner.
     ON CONFLICT (token) DO UPDATE SET user_id = $2`,
    [genId(), req.user.id, token, Date.now()]
  );
  res.json({ success: true });
}));

// ---- In-system voice calls --------------------------------------------------
// STUN alone lets two browsers on friendly networks connect directly; a TURN
// relay (set TURN_URLS/TURN_USERNAME/TURN_CREDENTIAL) is what keeps calls
// working across office wifi and mobile networks that block direct P2P.
// Without one configured, calls still work whenever both sides' networks
// allow a direct connection — just not guaranteed on every network.
api.get('/calls/ice-servers', wrap(async (req, res) => {
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];

  // Cloudflare and Twilio both hand out ephemeral TURN credentials, so they
  // can't live in env vars — they're minted here and cached until shortly
  // before expiry. Cloudflare wins if both happen to be configured.
  const cloudflare = await getCloudflareIceServers();
  if (cloudflare) {
    res.json({ iceServers: cloudflare });
    return;
  }

  const twilio = await getTwilioIceServers();
  if (twilio) {
    res.json({ iceServers: twilio });
    return;
  }

  // Providers that do issue long-lived credentials (Metered, Xirsys, a
  // self-hosted coturn) are configured directly instead.
  if (process.env.TURN_URLS) {
    iceServers.push({
      urls: process.env.TURN_URLS.split(',').map((u) => u.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }
  res.json({ iceServers });
}));

// ---- Audit log (supervisor only) ------------------------------------------
api.get('/audit', requireRole('ADMIN'), wrap(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 500, 2000);
  const { rows } = await pool.query(
    `SELECT id, ts, actor_id, actor_name, action, entity_type, entity_id, summary, details
     FROM audit_log ORDER BY ts DESC LIMIT $1`,
    [limit]
  );
  res.json(rows.map((r) => ({
    id: r.id,
    ts: Number(r.ts),
    actorId: r.actor_id,
    actorName: r.actor_name,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    summary: r.summary,
    details: r.details,
  })));
}));

// ---------------------------------------------------------------------------
// Call history (admin) + recording upload/playback
// ---------------------------------------------------------------------------

// Admin-only log of every call attempt, answered or not.
api.get('/calls/log', requireRole('ADMIN'), wrap(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 500, 2000);
  const { rows } = await pool.query(
    `SELECT c.id, c.started_at, c.answered_at, c.ended_at, c.duration_sec,
            c.caller_id, c.caller_name, c.callee_id, c.callee_name,
            c.status, c.ring_delivered, c.push_sent, c.ended_by,
            r.bytes AS recording_bytes, r.mime AS recording_mime
       FROM call_logs c
       LEFT JOIN call_recordings r ON r.call_id = c.id
      ORDER BY c.started_at DESC
      LIMIT $1`,
    [limit],
  );
  res.json(rows.map((r) => ({
    id: r.id,
    startedAt: Number(r.started_at),
    answeredAt: r.answered_at === null ? null : Number(r.answered_at),
    endedAt: r.ended_at === null ? null : Number(r.ended_at),
    durationSec: r.duration_sec,
    callerId: r.caller_id,
    callerName: r.caller_name,
    calleeId: r.callee_id,
    calleeName: r.callee_name,
    status: r.status,
    ringDelivered: r.ring_delivered,
    pushSent: r.push_sent,
    endedBy: r.ended_by,
    hasRecording: r.recording_bytes !== null,
    recordingBytes: r.recording_bytes === null ? null : Number(r.recording_bytes),
    recordingMime: r.recording_mime,
  })));
}));

// The audio never passes through the server during a call — WebRTC is
// peer-to-peer — so a participant's browser records the mixed audio and
// uploads it here once the call ends.
api.post(
  '/calls/:id/recording',
  express.raw({ type: ['audio/*', 'application/octet-stream'], limit: RECORDING_MAX_BYTES }),
  wrap(async (req, res) => {
    const callId = req.params.id;
    const { rows } = await pool.query('SELECT caller_id, callee_id FROM call_logs WHERE id = $1', [callId]);
    const call = rows[0];
    if (!call) return res.status(404).json({ error: 'Call not found.' });
    // Only the two people on the call may upload its audio.
    if (req.user.id !== call.caller_id && req.user.id !== call.callee_id) {
      return res.status(403).json({ error: 'Not your call.' });
    }
    const audio = req.body;
    if (!audio || !audio.length) return res.status(400).json({ error: 'Empty recording.' });

    const mime = (req.get('content-type') || 'audio/webm').split(';')[0];
    // ON CONFLICT DO NOTHING: both sides may upload, first one wins rather
    // than the second overwriting a good recording with a truncated one.
    await pool.query(
      `INSERT INTO call_recordings (call_id, mime, bytes, created_at, audio)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (call_id) DO NOTHING`,
      [callId, mime, audio.length, Date.now(), audio],
    );
    console.log(`[call] recording stored for ${callId} (${Math.round(audio.length / 1024)} KB)`);
    res.json({ success: true });
  }),
);

// Streams a recording back for playback. Admin-only, like the log itself.
api.get('/calls/:id/recording', requireRole('ADMIN'), wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT mime, audio FROM call_recordings WHERE call_id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'No recording for that call.' });
  res.setHeader('Content-Type', rows[0].mime);
  res.setHeader('Content-Length', rows[0].audio.length);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(rows[0].audio);
}));

api.delete('/calls/:id/recording', requireRole('ADMIN'), wrap(async (req, res) => {
  await pool.query('DELETE FROM call_recordings WHERE call_id = $1', [req.params.id]);
  logAudit(req, {
    action: 'DELETE', entityType: 'CallRecording', entityId: req.params.id,
    summary: `Deleted the recording for call ${req.params.id}`,
  });
  res.json({ success: true });
}));

// ---- Sick-leave medical documents ------------------------------------------
// An employee uploads the medical report for a sick day. It is visible to
// that employee and to Admin — nobody else, including their Team Leader or
// Supervisor. Every route below enforces that itself rather than relying on
// the page hiding a button.
const SICK_DOC_MAX_BYTES = 8 * 1024 * 1024;
const SICK_DOC_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
const sickDocRow = (r) => ({
  id: r.id, userId: r.user_id, date: r.date, filename: r.filename, mime: r.mime,
  bytes: Number(r.bytes), note: r.note, createdAt: Number(r.created_at),
});
const SICK_DOC_COLS = 'id, user_id, date, filename, mime, bytes, note, created_at';

// The file goes up as the raw body (base64 in JSON would add a third); the
// day, the original file name and an optional note ride in the query string.
api.post(
  '/sick-docs',
  express.raw({ type: SICK_DOC_TYPES, limit: SICK_DOC_MAX_BYTES }),
  wrap(async (req, res) => {
    const date = String(req.query.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Pick the sick day this report is for.' });
    const today = dayKeyInAppTz(Date.now());
    if (date > addDays(today, 7) || date < addDays(today, -120)) {
      return res.status(400).json({ error: 'That date is too far from today.' });
    }
    const mime = (req.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!SICK_DOC_TYPES.includes(mime)) return res.status(415).json({ error: 'Upload a photo (JPG, PNG, HEIC) or a PDF.' });
    const file = req.body;
    if (!Buffer.isBuffer(file) || !file.length) return res.status(400).json({ error: 'The file is empty.' });

    const filename = String(req.query.name || '').slice(0, 200) || null;
    const note = String(req.query.note || '').trim().slice(0, 300) || null;
    const id = genId();
    await pool.query(
      `INSERT INTO sick_documents (id, user_id, date, filename, mime, bytes, note, created_at, data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, req.user.id, date, filename, mime, file.length, note, Date.now(), file]
    );

    const me = await getViewer(req);
    const { rows: admins } = await pool.query(`SELECT id FROM users WHERE data->>'role' = 'ADMIN'`);
    await Promise.all(admins.map((a) =>
      notify(a.id, 'leave', `${me?.name || 'An employee'} uploaded a medical report`, `Sick day ${date}${unitLine(me) ? ` · ${unitLine(me)}` : ''}`)
    ));
    await logAudit(req, {
      action: 'sick_doc.upload', entityType: 'sick_document', entityId: id,
      summary: `${me?.name || 'Employee'} uploaded a medical report for ${date}`,
    });
    res.json(sickDocRow({ id, user_id: req.user.id, date, filename, mime, bytes: file.length, note, created_at: Date.now() }));
  }),
);

// The signed-in employee's own reports, and their own sick days from the
// roster, so the page can say which days still have no report.
api.get('/sick-docs/mine', wrap(async (req, res) => {
  const since = addDays(dayKeyInAppTz(Date.now()), -120);
  const [{ rows: docs }, { rows: days }] = await Promise.all([
    pool.query(`SELECT ${SICK_DOC_COLS} FROM sick_documents WHERE user_id = $1 AND date >= $2 ORDER BY date DESC, created_at DESC`, [req.user.id, since]),
    pool.query(`SELECT date FROM schedules WHERE user_id = $1 AND date >= $2 AND data->>'type' = 'SICK' ORDER BY date DESC`, [req.user.id, since]),
  ]);
  res.json({ docs: docs.map(sickDocRow), sickDays: days.map((d) => d.date) });
}));

// Admin's view over a date range: every sick day on the roster, with or
// without a report, plus reports for days the roster doesn't show as sick.
api.get('/sick-docs', requireRole('ADMIN'), wrap(async (req, res) => {
  const today = dayKeyInAppTz(Date.now());
  const to = String(req.query.to || today);
  const from = String(req.query.from || addDays(to, -30));
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  if (!DAY.test(from) || !DAY.test(to) || to < from) return res.status(400).json({ error: 'Bad date range.' });
  const [{ rows: docs }, { rows: days }, { rows: users }] = await Promise.all([
    pool.query(`SELECT ${SICK_DOC_COLS} FROM sick_documents WHERE date >= $1 AND date <= $2 ORDER BY date DESC, created_at DESC`, [from, to]),
    pool.query(`SELECT user_id, date FROM schedules WHERE date >= $1 AND date <= $2 AND data->>'type' = 'SICK'`, [from, to]),
    pool.query(`SELECT id, data FROM users`),
  ]);
  const people = Object.fromEntries(users.map((u) => {
    const d = { id: u.id, ...u.data };
    return [u.id, { name: d.name || '', employeeCode: d.employeeId || '', unit: unitLine(d), role: d.role }];
  }));
  res.json({
    from, to, people,
    docs: docs.map(sickDocRow),
    sickDays: days.map((d) => ({ userId: d.user_id, date: d.date })),
  });
}));

async function sickDocFor(req, id) {
  const { rows } = await pool.query(`SELECT ${SICK_DOC_COLS} FROM sick_documents WHERE id = $1`, [id]);
  const doc = rows[0];
  if (!doc) return { status: 404 };
  if (!isAdmin(req) && doc.user_id !== req.user.id) return { status: 403 };
  return { doc };
}

api.get('/sick-docs/:id/file', wrap(async (req, res) => {
  const { doc, status } = await sickDocFor(req, req.params.id);
  if (!doc) return res.status(status).json({ error: status === 403 ? 'Only the employee and Admin can open this.' : 'Not found.' });
  const { rows } = await pool.query('SELECT data FROM sick_documents WHERE id = $1', [doc.id]);
  res.setHeader('Content-Type', doc.mime);
  res.setHeader('Content-Length', rows[0].data.length);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.filename || 'medical-report')}"`);
  res.send(rows[0].data);
}));

api.delete('/sick-docs/:id', wrap(async (req, res) => {
  const { doc, status } = await sickDocFor(req, req.params.id);
  if (!doc) return res.status(status).json({ error: status === 403 ? 'Not yours to delete.' : 'Not found.' });
  await pool.query('DELETE FROM sick_documents WHERE id = $1', [doc.id]);
  await logAudit(req, {
    action: 'sick_doc.delete', entityType: 'sick_document', entityId: doc.id,
    summary: `Deleted a medical report for ${doc.date}${doc.user_id !== req.user.id ? ' (another employee\'s)' : ''}`,
  });
  res.json({ success: true });
}));

app.use('/api', api);

// Error handler for the API
app.use('/api', (err, req, res, next) => {
  console.error('[api error]', err);
  res.status(500).json({ error: err.message || 'Internal error' });
});

// ---------------------------------------------------------------------------
// Static SPA
// ---------------------------------------------------------------------------
const distDir = path.join(__dirname, 'dist');
// Quality UI (separate Vite app, built by npm run build:qa-ui) lives under /qa/
const qaUiDir = path.join(__dirname, 'qa-ui-dist');
app.use('/qa', express.static(qaUiDir));
app.get('/qa/*', (req, res, next) => (fs.existsSync(path.join(qaUiDir, 'index.html')) ? res.sendFile(path.join(qaUiDir, 'index.html')) : next()));
app.use(express.static(distDir));
app.get('*', (req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

// ---------------------------------------------------------------------------
// Voice call signaling (WebSocket)
// ---------------------------------------------------------------------------
// One socket per open tab/device; a user can have several at once (desktop +
// phone), so every relay fans out to the whole set — see sendToUser above.
function attachCallSignaling(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // Railway's edge proxy drops connections that sit idle, and it often does so
  // WITHOUT a close frame — leaving a half-open socket that still reports OPEN
  // on both ends. Signaling then silently vanishes: the caller sits on
  // "calling…" forever and the callee is never rung. So both sides keep the
  // connection warm and actively reap anything that stops answering.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        console.log(`[ws] terminating unresponsive socket (user ${ws.userId})`);
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* socket already gone */ }
    }
  }, WS_HEARTBEAT_MS);
  wss.on('close', () => clearInterval(heartbeat));

  wss.on('connection', (ws, req) => {
    let userId = null;
    try {
      const token = new URL(req.url, 'http://internal').searchParams.get('token');
      const decoded = jwt.verify(token, JWT_SECRET);
      userId = decoded.id;
    } catch {
      ws.close(4001, 'Invalid or expired session');
      return;
    }

    if (!wsClientsByUser.has(userId)) wsClientsByUser.set(userId, new Set());
    wsClientsByUser.get(userId).add(ws);
    ws.userId = userId;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    console.log(`[ws] connected user=${userId} (${wsClientsByUser.get(userId).size} socket(s))`);

    // Anyone connecting while a call is ringing for them is shown it straight
    // away. Answering then no longer depends on the notification tap routing
    // correctly or the deep link surviving a cold start — opening the app at
    // all is enough to see the call and pick it up.
    for (const [callId, call] of activeCalls) {
      if (call.calleeId === userId && call.status === 'ringing') {
        wsSend(ws, {
          type: 'call:incoming', callId, callerId: call.callerId, callerName: call.callerName,
        });
        break;
      }
    }

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      // Browsers can't send WebSocket ping frames, so the client keeps itself
      // warm with an app-level ping and treats a missing pong as a dead link.
      if (msg.type === 'ping') {
        ws.isAlive = true;
        wsSend(ws, { type: 'pong' });
        return;
      }

      // Caller starting a new call.
      if (msg.type === 'call:offer' && msg.calleeId && msg.sdp) {
        const caller = await getViewer({ user: { id: userId } });
        const result = await handleCallOffer(caller, msg.calleeId, msg.sdp);
        console.log(`[call] offer from ${userId} to ${msg.calleeId} -> ${result.error ? 'ERROR: ' + result.error : 'call ' + result.callId}`);
        wsSend(ws, result.error ? { type: 'call:error', error: result.error } : { type: 'call:started', callId: result.callId });
        return;
      }

      // Callee's client — whether it was already open or just opened from
      // tapping the "Answer" notification action — asks for the offer it
      // needs to build its answer from.
      if (msg.type === 'call:pickup' && msg.callId) {
        const call = activeCalls.get(msg.callId);
        if (!call || call.status !== 'ringing' || call.calleeId !== userId) {
          wsSend(ws, { type: 'call:invalid', callId: msg.callId });
          return;
        }
        wsSend(ws, { type: 'call:offer-sdp', callId: msg.callId, sdp: call.offerSdp, callerName: call.callerName });
        return;
      }

      if (msg.type === 'call:answer' && msg.callId && msg.sdp) {
        const call = activeCalls.get(msg.callId);
        if (!call || call.calleeId !== userId) return;
        call.status = 'connected';
        clearCallTimer(call);
        logCallAnswered(msg.callId, Date.now());
        sendToUser(call.callerId, { type: 'call:answered', callId: msg.callId, sdp: msg.sdp });
        return;
      }

      // ICE candidates flow both directions — relay to whichever side didn't send it.
      if (msg.type === 'call:ice' && msg.callId && msg.candidate) {
        const call = activeCalls.get(msg.callId);
        if (!call) return;
        const otherId = userId === call.callerId ? call.calleeId : call.callerId;
        sendToUser(otherId, { type: 'call:ice', callId: msg.callId, candidate: msg.candidate });
        return;
      }

      if (msg.type === 'call:end' && msg.callId) {
        teardownCall(msg.callId, 'ended', userId);
        return;
      }

      if (msg.type === 'call:decline' && msg.callId) {
        const call = activeCalls.get(msg.callId);
        if (!call || call.calleeId !== userId) return;
        console.log(`[call] ${msg.callId} declined from inside the app by ${userId}`);
        teardownCall(msg.callId, 'declined', userId);
        return;
      }
    });

    ws.on('close', () => {
      const set = wsClientsByUser.get(userId);
      if (!set) return;
      set.delete(ws);
      if (!set.size) wsClientsByUser.delete(userId);
      console.log(`[ws] disconnected user=${userId} (${set.size} socket(s) left)`);

      // Closing the last tab mid-call is a hangup. Without this a connected
      // call would sit in activeCalls forever (no ring timer covers it) and
      // its log row would never get an end time or duration.
      if (set.size) return;
      for (const [callId, call] of activeCalls) {
        if (call.callerId === userId || call.calleeId === userId) {
          // An answered call that drops was still a real conversation; one that
          // drops mid-ring is a lost connection, not a rejection by either side.
          teardownCall(callId, 'ended', userId, call.status === 'connected' ? undefined : 'disconnected');
        }
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
initDb()
  .then(() => {
    const httpServer = app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
    attachCallSignaling(httpServer);
    closeDanglingCallLogs();
    sweepOldRecordings();
    setInterval(sweepOldRecordings, RETENTION_SWEEP_MS);
    sweepLateness();
    setInterval(sweepLateness, LATENESS_SWEEP_MS);
    if (xontelHasCredentials()) {
      // A base URL saved earlier (discovered or set by an admin) outlives the
      // restart that replaced this process.
      xontelState().then((st) => { if (st?.detail?.baseUrl) xontelBaseUrlOverride = st.detail.baseUrl; })
        .catch(() => {})
        .finally(() => xontelPoll());
      setInterval(xontelPoll, XONTEL_POLL_MS);
      // Status-only tick so a XonTel break reaches Live Breaks within a minute.
      setInterval(xontelFastPoll, XONTEL_FAST_POLL_MS);
      // Full read of the recent window so long single-status sessions, which
      // the early-exit poll skips, are captured once they close.
      setTimeout(xontelFullStatusSync, 90 * 1000);
      setInterval(xontelFullStatusSync, XONTEL_FULL_POLL_MS);
      // One-time history backfill, after the first live poll has settled.
      setTimeout(() => xontelBackfillOnce().catch((e) => console.error('[xontel] backfill failed:', e.message)), 3 * 60 * 1000);
      // Missed-call history: small enough to re-read whole on every start.
      setTimeout(() => xontelMissedBackfill().catch((e) => console.error('[xontel] missed-call history failed:', e.message)), 2 * 60 * 1000);
      // One-off, read-only look at XonTel's missed-call lists and dashboard
      // totals, saved to sync_state so their real shape can be checked before
      // anything is built on them (the office PC is blocked by XonTel's WAF).
      setTimeout(() => xontelProbe().catch((e) => console.error('[xontel] probe failed:', e.message)), 45 * 1000);
    } else {
      console.warn('[xontel] XONTEL_TOKEN or XONTEL_USERNAME/XONTEL_PASSWORD not set — the XonTel comparison stays hidden until they are.');
    }
  })
  .catch((err) => {
    console.error('[fatal] could not initialise database', err);
    process.exit(1);
  });
