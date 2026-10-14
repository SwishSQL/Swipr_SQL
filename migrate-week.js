// Targeted migration: pull ONLY one week's schedule days from the old Firestore
// into Postgres. Does not touch users, swaps, leaves, or any other dates.
//
// Usage:
//   DATABASE_URL="<pg url>" node migrate-week.js [--start=YYYY-MM-DD] [--dry]
//   (default start = 2026-06-28, the Sunday of the requested week; 7 days)
import pg from 'pg';

const { Pool } = pg;
const FIREBASE_API_KEY = 'AIzaSyByXR1oKSuWZnXGQmzvHCPaIBWfxUyGLXQ';
const FIREBASE_PROJECT = 'swish-schedule-official';
const BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

const arg = (name, def) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : def;
};
const DRY = process.argv.includes('--dry');
const START = arg('start', '2026-06-28');
const J = (o) => JSON.stringify(o);

if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL.');
  process.exit(1);
}

const addDaysStr = (dateStr, n) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};
const WEEK = Array.from({ length: 7 }, (_, i) => addDaysStr(START, i));

// ---- Firestore decoding ----
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

const sslConfig = () => {
  const url = process.env.DATABASE_URL || '';
  if (/localhost|127\.0\.0\.1|\.railway\.internal/.test(url)) return false;
  return { rejectUnauthorized: false };
};
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: sslConfig() });

async function main() {
  console.log(`${DRY ? 'DRY RUN' : 'LIVE'} — migrating week ${WEEK[0]} .. ${WEEK[6]}`);
  const docs = await listAll('schedules'); // doc id = userId, data = {date: day}
  let usersTouched = 0, daysCopied = 0;
  const perDay = {};
  WEEK.forEach(d => (perDay[d] = 0));

  for (const { id: userId, data } of docs) {
    let touched = false;
    for (const date of WEEK) {
      const day = data ? data[date] : undefined;
      if (!day || typeof day !== 'object') continue;
      if (!DRY) {
        await pool.query(
          `INSERT INTO schedules (user_id, date, data) VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (user_id, date) DO UPDATE SET data = EXCLUDED.data`,
          [userId, date, J({ ...day, date })]
        );
      }
      daysCopied++; perDay[date]++; touched = true;
    }
    if (touched) usersTouched++;
  }

  console.log(`\nEmployees with shifts this week: ${usersTouched}`);
  console.log(`Total day-rows ${DRY ? 'found' : 'migrated'}: ${daysCopied}`);
  console.log('Per day:');
  WEEK.forEach(d => console.log(`  ${d}: ${perDay[d]}`));

  await pool.end();
  console.log('\nDone.');
}

main().catch(async (e) => {
  console.error('FATAL:', e.message);
  try { await pool.end(); } catch {}
  process.exit(1);
});
