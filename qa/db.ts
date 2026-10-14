/**
 * Database handle for the QA (call quality) module.
 *
 * The QA code was written against a better-sqlite3 style API
 * (db.prepare(sql).get/all/run, db.exec). This keeps exactly that call shape so the QA
 * routes run unchanged, but on top of Swipr's PostgreSQL database:
 *   - QA's table names are mapped to the qa_* tables (users -> the qa_users view),
 *   - ? placeholders become $1.. and a few SQLite-isms are translated (as QA's own adapter did),
 *   - it uses its OWN small pool, so QA's BIGINT-as-number parser never touches Swipr's queries.
 */
import pg from 'pg';

const { Pool, types } = pg;

/** QA table name -> name inside Swipr. Everything gets a qa_ prefix; users is a read-only view. */
const QA_TABLES = [
  'users', 'evaluations', 'evaluation_drafts', 'evaluation_edits', 'coaching_requests', 'coaching_sessions',
  'escalation_logs', 'accuracy_cases', 'notifications', 'audit_logs', 'qa_kpi_config', 'qa_kpi_day_overrides',
  'tl_kpi_config', 'user_sessions', 'attendance_records', 'user_leaves', 'form_config', 'form_settings',
  'xontel_agent_map', 'xontel_settings',
];
const renameTo = (t: string) => (t.startsWith('qa_') ? t : `qa_${t}`);
const TABLE_RE = new RegExp(`(?<![A-Za-z0-9_.])(${QA_TABLES.join('|')})(?![A-Za-z0-9_])`, 'g');

/** Rename QA tables in a statement, leaving string literals ('...') untouched. */
export function renameTables(sql: string): string {
  return sql
    .split(/('(?:[^']|'')*')/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(TABLE_RE, (m) => renameTo(m))))
    .join('');
}

function translateSql(sql: string): string {
  let out = renameTables(sql);

  out = out.replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
  out = out.replace(/AUTOINCREMENT/gi, '');
  out = out.replace(/\bJSON\b/g, 'JSONB');
  out = out.replace(/\bREAL\b/g, 'DOUBLE PRECISION');

  const hadInsertOrIgnore = /INSERT\s+OR\s+IGNORE\s+INTO/i.test(out);
  out = out.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO');
  out = out.replace(/INSERT\s+OR\s+REPLACE\s+INTO/gi, 'INSERT INTO');

  out = out.replace(/datetime\(\s*'now'\s*\)/gi, 'CURRENT_TIMESTAMP');
  out = out.replace(/date\(\s*'now'\s*\)/gi, 'CURRENT_DATE');
  out = out.replace(/GROUP_CONCAT\(\s*([^)]+?)\s*\)/gi, "string_agg($1::text, ',')");

  if (hadInsertOrIgnore && !/ON\s+CONFLICT/i.test(out)) {
    out = out.trimEnd().replace(/;?$/, '') + ' ON CONFLICT DO NOTHING';
  }

  if (!/\$\d/.test(out)) {
    let i = 0;
    out = out.replace(/\?/g, () => `$${++i}`);
  }
  return out;
}

const shouldReturnId = (sql: string) => /^\s*INSERT\s+INTO/i.test(sql) && !/RETURNING/i.test(sql);
const appendReturningId = (sql: string) => sql.trimEnd().replace(/;?$/, '') + ' RETURNING id';

export interface RunResult {
  lastInsertRowid: number | bigint | string;
  changes: number;
}

class Statement {
  constructor(private pool: pg.Pool, private rawSql: string) {}
  private flat(params: any[]) {
    return params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  }
  async get<T = any>(...params: any[]): Promise<T | undefined> {
    const res = await this.pool.query(translateSql(this.rawSql), this.flat(params));
    return res.rows[0] as T | undefined;
  }
  async all<T = any>(...params: any[]): Promise<T[]> {
    const res = await this.pool.query(translateSql(this.rawSql), this.flat(params));
    return res.rows as T[];
  }
  async run(...params: any[]): Promise<RunResult> {
    let sql = translateSql(this.rawSql);
    if (shouldReturnId(sql)) sql = appendReturningId(sql);
    const res = await this.pool.query(sql, this.flat(params));
    let lastInsertRowid: number | bigint | string = 0;
    if (res.rows.length > 0 && res.rows[0].id !== undefined) lastInsertRowid = res.rows[0].id;
    return { lastInsertRowid, changes: res.rowCount ?? 0 };
  }
}

export class QaDatabase {
  constructor(public pool: pg.Pool) {}
  prepare(sql: string) {
    return new Statement(this.pool, sql);
  }
  async exec(sql: string): Promise<void> {
    for (const part of sql.split(';').map((s) => s.trim()).filter(Boolean)) await this.pool.query(translateSql(part));
  }
  async get<T = any>(sql: string, params: any[] = []) {
    return this.prepare(sql).get<T>(params);
  }
  async all<T = any>(sql: string, params: any[] = []) {
    return this.prepare(sql).all<T>(params);
  }
  async run(sql: string, params: any[] = []) {
    return this.prepare(sql).run(params);
  }
  async close() {
    await this.pool.end();
  }
}

/** QA code compares COUNT(*) with numbers, so BIGINT must come back as a JS number (like better-sqlite3 did). */
const qaTypes = { getTypeParser: (oid: number, fmt?: any) => (oid === 20 ? (v: string) => parseInt(v, 10) : types.getTypeParser(oid, fmt)) };

export function createQaDb(opts: { connectionString: string; ssl?: any }): QaDatabase {
  const pool = new Pool({
    connectionString: opts.connectionString,
    ssl: opts.ssl,
    max: 5,
    keepAlive: true,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    types: qaTypes as any,
  });
  pool.on('error', (err) => console.error('[qa-db] idle client error (recovered):', err?.message || err));
  return new QaDatabase(pool);
}
