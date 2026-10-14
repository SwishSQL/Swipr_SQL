// Shared Firestore -> Postgres migration logic.
// Used by both the standalone CLI (migrate-firestore.js) and the server's
// cloud-side auto-migration (server.js). Reads the old Firestore project over
// the public REST API, transforms each document, and upserts into Postgres.
//
// Throws if Firestore is unreadable (e.g. quota 429) so callers can retry.
import bcrypt from 'bcryptjs';

const FIREBASE_API_KEY = 'AIzaSyByXR1oKSuWZnXGQmzvHCPaIBWfxUyGLXQ';
const FIREBASE_PROJECT = 'swish-schedule-official';
const BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

const J = (o) => JSON.stringify(o);
const looksHashed = (p) => typeof p === 'string' && /^\$2[aby]\$/.test(p);

// ---- Firestore typed-value decoding ---------------------------------------
function decode(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('referenceValue' in v) return v.referenceValue;
  return null;
}
function decodeFields(fields) {
  const o = {};
  for (const k of Object.keys(fields)) o[k] = decode(fields[k]);
  return o;
}

async function listAll(collection) {
  const docs = [];
  let token = null;
  do {
    const url = `${BASE}/${collection}?pageSize=300${token ? `&pageToken=${encodeURIComponent(token)}` : ''}&key=${FIREBASE_API_KEY}`;
    const res = await fetch(url);
    const j = await res.json();
    if (j.error) throw new Error(`Firestore ${collection}: ${j.error.code} ${j.error.message}`);
    for (const d of j.documents || []) {
      docs.push({ id: d.name.split('/').pop(), data: decodeFields(d.fields || {}) });
    }
    token = j.nextPageToken || null;
  } while (token);
  return docs;
}

// ---- Per-collection migration ---------------------------------------------
async function migrateUsers(pool, dry) {
  const docs = await listAll('users');
  let ok = 0, skipped = 0;
  const errors = [];
  for (const { id, data } of docs) {
    try {
      const u = { ...data };
      delete u.id;
      u.password = looksHashed(u.password) ? u.password : await bcrypt.hash(String(u.password || ''), 10);
      if (!dry) {
        await pool.query(
          `INSERT INTO users (id, data) VALUES ($1, $2::jsonb)
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
          [id, J(u)]
        );
      }
      ok++;
    } catch (e) {
      skipped++;
      errors.push(`user ${id} (${data.username}): ${e.message}`);
    }
  }
  return { total: docs.length, ok, skipped, errors };
}

async function migrateSchedules(pool, dry) {
  const docs = await listAll('schedules'); // doc id = userId, data = {date: day}
  let rows = 0, ok = 0;
  const errors = [];
  for (const { id: userId, data } of docs) {
    for (const [date, day] of Object.entries(data || {})) {
      if (!day || typeof day !== 'object') continue;
      rows++;
      try {
        if (!dry) {
          await pool.query(
            `INSERT INTO schedules (user_id, date, data) VALUES ($1, $2, $3::jsonb)
             ON CONFLICT (user_id, date) DO UPDATE SET data = EXCLUDED.data`,
            [userId, date, J({ ...day, date })]
          );
        }
        ok++;
      } catch (e) {
        errors.push(`schedule ${userId}/${date}: ${e.message}`);
      }
    }
  }
  return { users: docs.length, rows, ok, errors };
}

async function migrateSimple(pool, dry, collection, table, withCreatedAt = false) {
  const docs = await listAll(collection);
  let ok = 0;
  const errors = [];
  for (const { id, data } of docs) {
    const d = { ...data };
    delete d.id;
    try {
      if (!dry) {
        if (withCreatedAt) {
          await pool.query(
            `INSERT INTO ${table} (id, data, created_at) VALUES ($1, $2::jsonb, $3)
             ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, created_at = EXCLUDED.created_at`,
            [id, J(d), Number(d.createdAt) || null]
          );
        } else {
          await pool.query(
            `INSERT INTO ${table} (id, data) VALUES ($1, $2::jsonb)
             ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
            [id, J(d)]
          );
        }
      }
      ok++;
    } catch (e) {
      errors.push(`${collection} ${id}: ${e.message}`);
    }
  }
  return { total: docs.length, ok, errors };
}

const addDaysStr = (dateStr, n) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};

// Imports ONLY the 7 schedule days of the week starting at `startDate` from
// Firestore into Postgres. Leaves users, swaps, leaves, and other dates alone.
// Throws if Firestore can't be read (so the caller may retry later).
export async function runWeekImport(pool, startDate) {
  const week = Array.from({ length: 7 }, (_, i) => addDaysStr(startDate, i));
  const docs = await listAll('schedules'); // doc id = userId, data = {date: day}
  let usersTouched = 0, daysCopied = 0;
  for (const { id: userId, data } of docs) {
    let touched = false;
    for (const date of week) {
      const day = data ? data[date] : undefined;
      if (!day || typeof day !== 'object') continue;
      await pool.query(
        `INSERT INTO schedules (user_id, date, data) VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (user_id, date) DO UPDATE SET data = EXCLUDED.data`,
        [userId, date, J({ ...day, date })]
      );
      daysCopied++;
      touched = true;
    }
    if (touched) usersTouched++;
  }
  return { week, usersTouched, daysCopied };
}

// Imports several weeks at once, reading the Firestore schedules collection
// only ONCE (saves quota). `starts` is an array of Sunday date strings.
export async function runWeeksImport(pool, starts) {
  const dateSet = new Set();
  for (const s of starts) for (let i = 0; i < 7; i++) dateSet.add(addDaysStr(s, i));
  const docs = await listAll('schedules'); // single read for all weeks
  let usersTouched = 0, daysCopied = 0;
  for (const { id: userId, data } of docs) {
    let touched = false;
    for (const date of dateSet) {
      const day = data ? data[date] : undefined;
      if (!day || typeof day !== 'object') continue;
      await pool.query(
        `INSERT INTO schedules (user_id, date, data) VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (user_id, date) DO UPDATE SET data = EXCLUDED.data`,
        [userId, date, J({ ...day, date })]
      );
      daysCopied++;
      touched = true;
    }
    if (touched) usersTouched++;
  }
  return { dates: [...dateSet], usersTouched, daysCopied };
}

// Read a single Firestore document (one read). Returns decoded fields or null.
async function fsDoc(collection, id) {
  const url = `${BASE}/${collection}/${encodeURIComponent(id)}?key=${FIREBASE_API_KEY}`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  const j = await res.json();
  if (j.error) throw new Error(`${collection}/${id}: ${j.error.code} ${j.error.message}`);
  return decodeFields(j.fields || {});
}

// Imports the FULL schedule of every employee in the given companies. User ids
// come from Postgres (no Firestore users read); each user's schedule doc is
// fetched by id (targeted — light on quota). Throws if Firestore is unreadable.
export async function runDeptImport(pool, companies) {
  const set = new Set(companies.map((c) => c.trim().toLowerCase()));
  const { rows } = await pool.query('SELECT id, data FROM users');
  const userIds = rows
    .filter((r) => set.has(String(r.data.companyName || '').trim().toLowerCase()))
    .map((r) => r.id);

  let usersTouched = 0, daysCopied = 0;
  for (const uid of userIds) {
    const sched = await fsDoc('schedules', uid);
    if (!sched) continue;
    let touched = false;
    for (const date of Object.keys(sched)) {
      const day = sched[date];
      if (!day || typeof day !== 'object') continue;
      await pool.query(
        `INSERT INTO schedules (user_id, date, data) VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (user_id, date) DO UPDATE SET data = EXCLUDED.data`,
        [uid, date, J({ ...day, date })]
      );
      daysCopied++;
      touched = true;
    }
    if (touched) usersTouched++;
  }
  return { userCount: userIds.length, usersTouched, daysCopied };
}

// Runs the full migration against the given pg pool. Returns a summary object.
// Throws if Firestore can't be read (so the caller may retry later).
export async function runFirestoreMigration(pool, { dry = false } = {}) {
  const users = await migrateUsers(pool, dry);
  const schedules = await migrateSchedules(pool, dry);
  const swaps = await migrateSimple(pool, dry, 'swapRequests', 'swap_requests');
  const leaves = await migrateSimple(pool, dry, 'leaveRequests', 'leave_requests', true);
  const holidays = await migrateSimple(pool, dry, 'publicHolidays', 'public_holidays');
  const errors = [
    ...users.errors, ...schedules.errors, ...swaps.errors, ...leaves.errors, ...holidays.errors,
  ];
  return { dry, users, schedules, swaps, leaves, holidays, errorCount: errors.length, errors };
}
