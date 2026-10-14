// SQL Server data layer for Swipr (and the Quality module).
//
// Presents the small slice of the `pg` API the application uses — pool.query(text, params) -> { rows, rowCount },
// pool.connect() -> client with BEGIN / COMMIT / ROLLBACK, pool.end() — on top of the `mssql` driver. The SQL the
// application sends is PostgreSQL-flavoured and is translated to T-SQL by db-translate.js (see there).
//
// Differences from pg that matter to callers, all handled here:
//   * JSON documents are NVARCHAR(MAX): columns named in JSON_COLUMNS are parsed on read (pg did that for jsonb);
//     object / array parameters are serialised on write.
//   * BIGINT comes back as a string and INT as a number — exactly as with pg's int8 / int4.
//   * The application issues NO DDL while it runs; sql/schema.sql creates everything (db-init.js / AUTO_INIT_DB).
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import { translateSql } from './db-translate.js';

export { sql };
const here = path.dirname(fileURLToPath(import.meta.url));

// ---- connection -------------------------------------------------------------------------------------------------
/** DATABASE_URL = sqlserver://user:pass@host:port/database[?encrypt=..&trustServerCertificate=..]   or the MSSQL_* variables */
export function buildConfig(url = process.env.DATABASE_URL || process.env.MSSQL_URL) {
  const pool = { max: Number(process.env.MSSQL_POOL_MAX ?? 10), min: 0, idleTimeoutMillis: 30000 };
  if (url && /^(sqlserver|mssql):\/\//i.test(url)) {
    const u = new URL(url.replace(/^sqlserver:/i, 'mssql:'));
    const q = u.searchParams;
    return {
      server: decodeURIComponent(u.hostname),
      port: u.port ? Number(u.port) : 1433,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: decodeURIComponent(u.pathname.replace(/^\//, '')),
      options: {
        encrypt: (q.get('encrypt') ?? process.env.MSSQL_ENCRYPT ?? 'false') === 'true',
        trustServerCertificate: (q.get('trustServerCertificate') ?? process.env.MSSQL_TRUST_CERT ?? 'true') !== 'false',
        enableArithAbort: true,                 // required by the indexed computed column on users.username
        instanceName: process.env.MSSQL_INSTANCE || undefined,
      },
      pool,
      requestTimeout: Number(process.env.MSSQL_REQUEST_TIMEOUT ?? 60000),
    };
  }
  if (!process.env.MSSQL_HOST && !process.env.MSSQL_DATABASE) {
    throw new Error('No SQL Server connection configured. Set DATABASE_URL (sqlserver://user:pass@host:port/database) or the MSSQL_HOST / MSSQL_USER / MSSQL_PASSWORD / MSSQL_DATABASE variables.');
  }
  return {
    server: process.env.MSSQL_HOST || 'localhost',
    port: Number(process.env.MSSQL_PORT || 1433),
    user: process.env.MSSQL_USER || 'sa',
    password: process.env.MSSQL_PASSWORD || '',
    database: process.env.MSSQL_DATABASE || 'Swish_Swipr',
    options: {
      encrypt: process.env.MSSQL_ENCRYPT === 'true',
      trustServerCertificate: process.env.MSSQL_TRUST_CERT !== 'false',
      enableArithAbort: true,
      instanceName: process.env.MSSQL_INSTANCE || undefined,
    },
    pool,
    requestTimeout: Number(process.env.MSSQL_REQUEST_TIMEOUT ?? 60000),
  };
}

// ---- JSON columns -----------------------------------------------------------------------------------------------
// Columns that hold JSON documents (pg returned these already parsed). Parsed only when the value is a string that
// looks like JSON, so a binary `data` column (sick_documents) or a plain-text one is never touched.
const JSON_COLUMNS = new Set(['data', 'details', 'keys', 'detail', 'raw', 'changes']);
function parseJsonColumns(rows) {
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      const v = row[k];
      if (typeof v === 'string' && JSON_COLUMNS.has(k) && (v[0] === '{' || v[0] === '[')) {
        try { row[k] = JSON.parse(v); } catch { /* not JSON after all: leave the text */ }
      }
    }
  }
  return rows;
}

// ---- running a statement ----------------------------------------------------------------------------------------
const isPlainObject = (v) => v !== null && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v);
function bind(request, params = [], used = null) {
  params.forEach((val, i) => {
    if (used && !used.has(i)) return;                    // collapsed IN-list members are not sent
    if (val === undefined) val = null;
    if (Array.isArray(val) || isPlainObject(val)) val = JSON.stringify(val);        // jsonb / array parameters
    if (typeof val === 'number' && !Number.isInteger(val)) request.input(`p${i}`, sql.Float, val);
    else if (typeof val === 'number') request.input(`p${i}`, Math.abs(val) > 2147483647 ? sql.BigInt : sql.Int, val);
    else if (val instanceof Date) request.input(`p${i}`, sql.DateTime2(6), val);
    else request.input(`p${i}`, val);
  });
}

/** BIGINT columns -> JS numbers (the Quality module compares them with numbers; Swipr's own code expects strings) */
function bigintsToNumbers(res, rows) {
  const cols = res.recordset && res.recordset.columns;
  if (!cols) return rows;
  const big = Object.keys(cols).filter((k) => cols[k].type === sql.BigInt || cols[k].type?.declaration === 'bigint');
  if (!big.length) return rows;
  for (const row of rows) for (const k of big) if (typeof row[k] === 'string') row[k] = Number(row[k]);
  return rows;
}

/**
 * SQL Server accepts at most 2100 parameters per statement (PostgreSQL ~65000). Long `IN ($1, $2, ... $n)` lists — the Quality
 * dashboards build them from every evaluation in scope — are sent as ONE JSON array parameter and unnested with OPENJSON.
 */
export function collapseInLists(text, params) {
  if (!params || params.length < 200) return { text, params };
  const extra = [];
  const out = text.replace(/\bIN\s*\(\s*(\$\d+(?:\s*,\s*\$\d+){49,})\s*\)/gi, (_, list) => {
    const idx = list.match(/\$(\d+)/g).map((x) => Number(x.slice(1)) - 1);
    extra.push(idx.map((i) => params[i]));
    return `IN (SELECT [value] COLLATE Latin1_General_100_BIN2 FROM OPENJSON($${params.length + extra.length}))`;
  });
  return extra.length ? { text: out, params: [...params, ...extra] } : { text, params };
}

async function run(executor, text0, params0, opts = {}) {
  const { text, params } = collapseInLists(text0, params0);
  const t = translateSql(text);
  const request = executor.request();
  bind(request, params, new Set([...t.matchAll(/@p(\d+)/g)].map((m) => Number(m[1]))));
  try {
    const res = await request.query(t);
    let rows = parseJsonColumns(res.recordset ? [...res.recordset] : []);
    if (opts.bigintNumbers) rows = bigintsToNumbers(res, rows);
    const affected = (res.rowsAffected || []).reduce((a, b) => a + b, 0);
    return { rows, rowCount: res.recordset ? rows.length : affected, command: undefined };
  } catch (e) {
    e.sql = t;
    e.message = `${e.message}\n  while running: ${t.replace(/\s+/g, ' ').slice(0, 400)}`;
    throw e;
  }
}

class Client {
  constructor(pool) { this.pool = pool; this.tx = null; }
  async query(text, params = [], opts) {
    const kw = typeof text === 'string' ? text.trim().replace(/;$/, '').toUpperCase() : '';
    if (kw === 'BEGIN') { this.tx = new sql.Transaction(this.pool); await this.tx.begin(); return { rows: [], rowCount: 0 }; }
    if (kw === 'COMMIT') { if (this.tx) await this.tx.commit(); this.tx = null; return { rows: [], rowCount: 0 }; }
    if (kw === 'ROLLBACK') { if (this.tx) { try { await this.tx.rollback(); } catch { /* connection already gone */ } } this.tx = null; return { rows: [], rowCount: 0 }; }
    return run(this.tx || this.pool, text, params, opts);
  }
  release() { if (this.tx) { this.tx.rollback().catch(() => {}); this.tx = null; } }
}

let poolPromise = null;
export function getPool() {
  if (!poolPromise) {
    const p = new sql.ConnectionPool(buildConfig());
    p.on('error', (err) => console.error('[db] pool error:', err.message));
    poolPromise = p.connect().catch((e) => { poolPromise = null; throw e; });
  }
  return poolPromise;
}

/** a `pg`-shaped pool */
export const pool = {
  async query(text, params = [], opts) { return run(await getPool(), text, params, opts); },
  async connect() { return new Client(await getPool()); },
  async end() { if (poolPromise) { const p = await poolPromise.catch(() => null); poolPromise = null; if (p) await p.close(); } },
  on() { return pool; },
};

// ---- schema -----------------------------------------------------------------------------------------------------
export const schemaFile = path.join(here, 'sql', 'schema.sql');
/** splits schema.sql on lines that contain only GO (the batch separator of SQL Server tools) */
export function schemaBatches() {
  return fs.readFileSync(schemaFile, 'utf8').split(/^\s*GO\s*$/gim).map((b) => b.trim()).filter(Boolean);
}
/** creates the database when missing (needs rights on master), then every table / index / view that is missing */
export async function initDatabase({ createDatabase = false } = {}) {
  const cfg = buildConfig();
  if (createDatabase) {
    const admin = await new sql.ConnectionPool({ ...cfg, database: 'master' }).connect();
    try { await admin.request().query(`IF DB_ID(N'${cfg.database.replace(/'/g, "''")}') IS NULL CREATE DATABASE [${cfg.database.replace(/]/g, ']]')}]`); } finally { await admin.close(); }
  }
  const p = await getPool();
  const batches = schemaBatches();
  for (const b of batches) await p.request().batch(b);
  return batches.length;
}

/** fail fast, with a list, when the schema is not there (the app itself never creates tables) */
export async function verifySchema(required) {
  const p = await getPool();
  const have = new Set((await p.request().query(`SELECT name FROM sys.tables UNION SELECT name FROM sys.views`)).recordset.map((r) => r.name));
  const missing = required.filter((t) => !have.has(t));
  if (missing.length) {
    throw new Error(`The database is missing: ${missing.join(', ')}. Run sql/schema.sql (npm run db:init), or set AUTO_INIT_DB=true to let the app create it.`);
  }
}
