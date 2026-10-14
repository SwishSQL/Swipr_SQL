/**
 * npm run migrate:from-postgres [-- --replace] [-- --only=users,schedules]
 *
 * One-off data migration from the live PostgreSQL database (Swipr + the Quality tables, on Railway) into the SQL Server
 * database named by DATABASE_URL.
 *
 *   PG_SOURCE_URL   postgresql://user:pass@host:port/db   (read-only access is enough)
 *   PG_SSL=true     only if the source requires TLS
 *
 *   1. Reads every table inside ONE REPEATABLE READ READ ONLY transaction: a consistent snapshot, the source is never written.
 *   2. Writes each table into SQL Server keeping the original ids (IDENTITY_INSERT where the table has an identity column).
 *   3. Verifies EVERY cell of EVERY row by reading it back and comparing with the snapshot (JSON documents are compared as
 *      documents, timestamps to the microsecond). Exit code 1 on any difference.
 *
 * The target must be empty (schema from sql/schema.sql, no rows). If the application was already started against it,
 * re-run with --replace to wipe the target tables first.
 */
import 'dotenv/config';
import pg from 'pg';
import { getPool, initDatabase, sql, pool } from '../db.js';

const REPLACE = process.argv.includes('--replace');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').replace('--only=', '').split(',').filter(Boolean);
if (!process.env.PG_SOURCE_URL) { console.error('PG_SOURCE_URL is not set.'); process.exit(2); }

// pg: every value as raw text (an exact round trip), real Buffers for bytea
const rawTypes = { getTypeParser: (oid, fmt) => (oid === 17 ? pg.types.getTypeParser(oid, fmt) : (v) => v) };
const src = new pg.Client({ connectionString: process.env.PG_SOURCE_URL, ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false, types: rawTypes });
await src.connect();
await src.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');

const mssql = await getPool();
await initDatabase();                                   // idempotent: makes sure every table exists
const q = (s) => `[${String(s).replace(/]/g, ']]')}]`;

// ---- what to copy ----------------------------------------------------------------------------------------------------
const pgTables = (await src.query(`SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1`)).rows.map((r) => r.t);
const msTables = new Set((await mssql.request().query(`SELECT name FROM sys.tables`)).recordset.map((r) => r.name));
const tables = pgTables.filter((t) => msTables.has(t) && (!ONLY.length || ONLY.includes(t)));
const skipped = pgTables.filter((t) => !msTables.has(t));
if (skipped.length) console.log(`not in the SQL Server schema (skipped): ${skipped.join(', ')}`);

async function columnsOf(t) {
  const cols = (await src.query(`SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type FROM pg_attribute a WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '' ORDER BY a.attnum`, ['public.' + t])).rows;
  const pk = (await src.query(`SELECT a.attname AS name FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = $1::regclass AND i.indisprimary`, ['public.' + t])).rows.map((r) => r.name);
  const ms = (await mssql.request().input('t', t).query(`SELECT c.name, c.is_identity, c.is_computed FROM sys.columns c WHERE c.object_id = OBJECT_ID(@t)`)).recordset;
  const msCols = new Map(ms.map((c) => [c.name, c]));
  const keep = cols.filter((c) => msCols.has(c.name) && !msCols.get(c.name).is_computed);
  const dropped = cols.filter((c) => !msCols.has(c.name)).map((c) => c.name);
  if (dropped.length) console.log(`  ${t}: columns not in the SQL Server schema (skipped): ${dropped.join(', ')}`);
  return { cols: keep, pk, identity: ms.some((c) => c.is_identity) };
}

// ---- value conversion -----------------------------------------------------------------------------------------------
const kind = (type) => /^(text|character)/.test(type) ? 'text' : /^jsonb?$/.test(type) ? 'json' : type === 'bigint' ? 'bigint' : /^(integer|smallint)$/.test(type) ? 'int' : /^(double|real|numeric)/.test(type) ? 'float' : type === 'boolean' ? 'bool' : type === 'bytea' ? 'bytes' : /^timestamp/.test(type) ? 'ts' : 'text';
function toParam(v, k) {
  if (v === null || v === undefined) return { type: sql.NVarChar(sql.MAX), value: null };
  switch (k) {
    case 'bool': return { type: sql.Bit, value: v === 't' || v === true };
    case 'int': return { type: sql.Int, value: Number(v) };
    case 'bigint': return { type: sql.BigInt, value: v };
    case 'float': return { type: sql.Float, value: Number(v) };
    case 'bytes': return { type: sql.VarBinary(sql.MAX), value: v };
    default: return { type: sql.NVarChar(sql.MAX), value: String(v) };   // text, json (canonical jsonb text) and timestamps (converted by the server)
  }
}

// ---- copy -----------------------------------------------------------------------------------------------------------
if (REPLACE) {
  for (const t of tables) await mssql.request().batch(`DELETE FROM dbo.${q(t)}`);
  console.log('target tables emptied (--replace)');
} else {
  const filled = [];
  for (const t of tables) if ((await mssql.request().query(`SELECT COUNT_BIG(*) AS n FROM dbo.${q(t)}`)).recordset[0].n > 0) filled.push(t);
  if (filled.length) { console.error(`The target is not empty (${filled.join(', ')}). Use --replace to wipe those tables first.`); process.exit(2); }
}

const report = [];
for (const t of tables) {
  const { cols, pk, identity } = await columnsOf(t);
  const names = cols.map((c) => q(c.name)).join(', ');
  const rows = (await src.query(`SELECT ${cols.map((c) => `"${c.name}"`).join(', ')} FROM "${t}"`)).rows;
  // Rows travel as ONE JSON parameter per chunk and are inserted with OPENJSON ... WITH (typed columns): a few hundred
  // times faster than a parameter per cell. Values are sent as text and converted by the server to the column's type.
  const withTypes = { text: 'NVARCHAR(MAX)', json: 'NVARCHAR(MAX)', bigint: 'BIGINT', int: 'INT', float: 'FLOAT', bool: 'BIT', bytes: 'VARCHAR(MAX)', ts: 'DATETIME2(6)' };
  const withClause = cols.map((c) => `${q(c.name)} ${withTypes[kind(c.type)]} '$.${c.name.replace(/'/g, '')}'`).join(', ');
  const selectList = cols.map((c) => (kind(c.type) === 'bytes' ? `CONVERT(VARBINARY(MAX), j.${q(c.name)}, 2) AS ${q(c.name)}` : `j.${q(c.name)}`)).join(', ');
  const toJson = (row) => Object.fromEntries(cols.map((c) => {
    const v = row[c.name], k = kind(c.type);
    if (v === null || v === undefined) return [c.name, null];
    if (k === 'bool') return [c.name, v === 't' || v === true];
    if (k === 'bytes') return [c.name, Buffer.from(v).toString('hex')];
    return [c.name, v];                       // text / json (canonical jsonb text) / numbers and timestamps as text
  }));
  const CHUNK = 2000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const payload = JSON.stringify(rows.slice(i, i + CHUNK).map(toJson));
    const stmt = `INSERT INTO dbo.${q(t)} (${names}) SELECT ${selectList} FROM OPENJSON(@j) WITH (${withClause}) AS j`;
    await mssql.request().input('j', sql.NVarChar(sql.MAX), payload)
      .batch(identity ? `SET IDENTITY_INSERT dbo.${q(t)} ON; ${stmt}; SET IDENTITY_INSERT dbo.${q(t)} OFF;` : stmt)
      .catch((e) => { throw new Error(`${t}: ${e.message}`); });
  }
  const n = (await mssql.request().query(`SELECT COUNT_BIG(*) AS n FROM dbo.${q(t)}`)).recordset[0].n;
  report.push({ t, cols, pk, rows, n: Number(n) });
  console.log(`  ${t.padEnd(30)} ${String(rows.length).padStart(7)} rows -> ${String(n).padStart(7)}${Number(n) === rows.length ? '' : '   COUNT MISMATCH'}`);
}

// ---- verify every cell ---------------------------------------------------------------------------------------------
const canonJson = (v) => { if (Array.isArray(v)) return v.map(canonJson); if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonJson(v[k])])); return v; };
const norm = (v, k) => {
  if (v === null || v === undefined) return null;
  switch (k) {
    case 'json': { try { return JSON.stringify(canonJson(JSON.parse(typeof v === 'string' ? v : JSON.stringify(v)))); } catch { return String(v); } }
    case 'bool': return v === 't' || v === true || v === 1 ? 'true' : 'false';
    case 'bigint': case 'int': return String(BigInt(v));
    case 'float': return String(Number(v));
    case 'bytes': return Buffer.from(v).toString('hex');
    case 'ts': return String(v).replace('T', ' ').replace(/\.?0+$/, '').replace(/\.$/, '');
    default: return String(v);
  }
};
let bad = 0, cells = 0;
console.log('\nverifying every cell ...');
for (const { t, cols, pk, rows } of report) {
  const sel = cols.map((c) => (kind(c.type) === 'ts' ? `CONVERT(VARCHAR(30), ${q(c.name)}, 121) AS ${q(c.name)}` : q(c.name))).join(', ');
  const got = (await mssql.request().query(`SELECT ${sel} FROM dbo.${q(t)}`)).recordset;
  const key = (row, isSrc) => (pk.length ? pk : cols.map((c) => c.name)).map((c) => norm(row[c], kind(cols.find((x) => x.name === c).type))).join('\u0001');
  const have = new Map();
  for (const r of got) have.set(key(r), r);
  let tb = 0;
  for (const r of rows) {
    const o = have.get(key(r, true));
    if (!o) { tb++; if (tb <= 3) console.log(`  ${t}: row ${key(r, true).slice(0, 60)} missing in SQL Server`); continue; }
    for (const c of cols) {
      cells++;
      const k = kind(c.type);
      let a = norm(r[c.name], k), b = norm(o[c.name], k);
      if (k === 'ts' && a && b) { a = a.padEnd(26, '0').slice(0, 26); b = b.padEnd(26, '0').slice(0, 26); }
      if (a !== b) { tb++; if (tb <= 3) console.log(`  ${t}.${c.name} [${key(r, true).slice(0, 40)}]: ${String(a).slice(0, 60)}  vs  ${String(b).slice(0, 60)}`); }
    }
  }
  if (got.length !== rows.length) { tb++; console.log(`  ${t}: ${rows.length} rows in PostgreSQL, ${got.length} in SQL Server`); }
  bad += tb;
}
await src.query('ROLLBACK');
await src.end();
await pool.end();
console.log(bad === 0 ? `\nOK: ${report.reduce((a, r) => a + r.rows.length, 0)} rows, ${cells} cells verified identical.` : `\nFAILED: ${bad} difference(s).`);
process.exit(bad === 0 ? 0 : 1);
