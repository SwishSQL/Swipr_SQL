/**
 * Database handle for the QA (call quality) module — SQL Server edition.
 *
 * The QA code was written against a better-sqlite3 style API (db.prepare(sql).get/all/run, db.exec). This keeps exactly
 * that call shape so the QA routes run unchanged, on top of Swipr's own data layer (db.js, handed in by server.js):
 *   - QA's table names are mapped to the qa_* tables (users -> the qa_users view),
 *   - ? placeholders become $1.. and the SQLite-isms are translated (qa-sql.js), then db.js translates to T-SQL,
 *   - BIGINT comes back as a JS number (QA compares COUNT(*) etc. with numbers, like better-sqlite3 did).
 */
import { qaPre } from './qa-sql.js';

export { renameTables } from './qa-sql.js';

export interface QaPool {
  query(text: string, params?: any[], opts?: { bigintNumbers?: boolean }): Promise<{ rows: any[]; rowCount: number }>;
}

const shouldReturnId = (sql: string) => /^\s*INSERT\s+INTO/i.test(sql) && !/RETURNING/i.test(sql);
const appendReturningId = (sql: string) => sql.trimEnd().replace(/;?$/, '') + ' RETURNING id';

export interface RunResult {
  lastInsertRowid: number | bigint | string;
  changes: number;
}

class Statement {
  constructor(private pool: QaPool, private rawSql: string) {}
  private flat(params: any[]) {
    return params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  }
  async get<T = any>(...params: any[]): Promise<T | undefined> {
    const res = await this.pool.query(qaPre(this.rawSql), this.flat(params), { bigintNumbers: true });
    return res.rows[0] as T | undefined;
  }
  async all<T = any>(...params: any[]): Promise<T[]> {
    const res = await this.pool.query(qaPre(this.rawSql), this.flat(params), { bigintNumbers: true });
    return res.rows as T[];
  }
  async run(...params: any[]): Promise<RunResult> {
    let sql = qaPre(this.rawSql);
    if (shouldReturnId(sql)) sql = appendReturningId(sql);
    const res = await this.pool.query(sql, this.flat(params), { bigintNumbers: true });
    let lastInsertRowid: number | bigint | string = 0;
    if (res.rows.length > 0 && res.rows[0].id !== undefined) lastInsertRowid = res.rows[0].id;
    return { lastInsertRowid, changes: res.rowCount ?? 0 };
  }
}

export class QaDatabase {
  constructor(public pool: QaPool) {}
  prepare(sql: string) {
    return new Statement(this.pool, sql);
  }
  /** statements separated by ; (the QA code only uses this for the occasional multi-statement string) */
  async exec(sql: string): Promise<void> {
    for (const part of sql.split(';').map((s) => s.trim()).filter(Boolean)) await this.pool.query(qaPre(part), [], { bigintNumbers: true });
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
  async close() { /* the pool belongs to the server */ }
}

export function createQaDb(opts: { pool: QaPool }): QaDatabase {
  return new QaDatabase(opts.pool);
}
