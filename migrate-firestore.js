// Standalone CLI for the Firestore -> Postgres migration.
//
// Usage:
//   DATABASE_URL="<postgres url>" node migrate-firestore.js [--dry]
//
// The actual migration logic lives in ./migrate.js (shared with the server's
// cloud-side auto-migration). Safe to re-run (idempotent upserts).
import pg from 'pg';
import { runFirestoreMigration } from './migrate.js';

const { Pool } = pg;
const DRY = process.argv.includes('--dry');

if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL to the target Postgres connection string.');
  process.exit(1);
}

const sslConfig = () => {
  const url = process.env.DATABASE_URL || '';
  if (/localhost|127\.0\.0\.1|\.railway\.internal/.test(url)) return false;
  return { rejectUnauthorized: false };
};
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: sslConfig() });

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, data JSONB NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users ((data->>'username'));
    CREATE TABLE IF NOT EXISTS schedules (user_id TEXT NOT NULL, date TEXT NOT NULL, data JSONB NOT NULL, PRIMARY KEY (user_id, date));
    CREATE TABLE IF NOT EXISTS swap_requests (id TEXT PRIMARY KEY, data JSONB NOT NULL);
    CREATE TABLE IF NOT EXISTS leave_requests (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at BIGINT);
    CREATE TABLE IF NOT EXISTS public_holidays (id TEXT PRIMARY KEY, data JSONB NOT NULL);
  `);
}

async function main() {
  console.log(DRY ? '== DRY RUN (no writes) ==' : '== LIVE MIGRATION ==');
  await ensureSchema();
  const s = await runFirestoreMigration(pool, { dry: DRY });

  console.log('users:', s.users.total, 'read,', s.users.ok, 'migrated,', s.users.skipped, 'skipped');
  console.log('schedules:', s.schedules.users, 'user-docs ->', s.schedules.ok, '/', s.schedules.rows, 'day-rows');
  console.log('swapRequests:', s.swaps.ok, '/', s.swaps.total);
  console.log('leaveRequests:', s.leaves.ok, '/', s.leaves.total);
  console.log('publicHolidays:', s.holidays.ok, '/', s.holidays.total);

  if (s.errors.length) {
    console.log(`\n${s.errors.length} record(s) skipped/failed:`);
    s.errors.slice(0, 50).forEach((e) => console.log('  -', e));
  } else {
    console.log('\nNo errors.');
  }

  await pool.end();
  console.log('\nDone.');
}

main().catch(async (e) => {
  console.error('FATAL:', e.message);
  try { await pool.end(); } catch {}
  process.exit(1);
});
