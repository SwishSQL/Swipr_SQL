// Pre-translation of the Quality module's SQL. The QA code was written for SQLite (? placeholders, bare table names,
// INSERT OR IGNORE, datetime('now')); inside Swipr its tables are the qa_* tables. This turns a QA statement into the
// PostgreSQL-flavoured SQL that db-translate.js then turns into T-SQL. Shared by the adapter (qa/db.ts) and tools/sweep.mjs.

/** QA table name -> name inside Swipr. Everything gets a qa_ prefix; users is a read-only view. */
export const QA_TABLES = [
  'users', 'evaluations', 'evaluation_drafts', 'evaluation_edits', 'coaching_requests', 'coaching_sessions',
  'escalation_logs', 'accuracy_cases', 'notifications', 'audit_logs', 'qa_kpi_config', 'qa_kpi_day_overrides',
  'tl_kpi_config', 'user_sessions', 'attendance_records', 'user_leaves', 'form_config', 'form_settings',
  'xontel_agent_map', 'xontel_settings',
];
const renameTo = (t) => (t.startsWith('qa_') ? t : `qa_${t}`);
const TABLE_RE = new RegExp(`(?<![A-Za-z0-9_.])(${QA_TABLES.join('|')})(?![A-Za-z0-9_])`, 'g');

/** Rename QA tables in a statement, leaving string literals ('...') untouched. */
export function renameTables(sql) {
  return sql.split(/('(?:[^']|'')*')/).map((part, i) => (i % 2 === 1 ? part : part.replace(TABLE_RE, (m) => renameTo(m)))).join('');
}

export function qaPre(sql) {
  let out = renameTables(sql);
  out = out.replace(/AUTOINCREMENT/gi, '');
  const hadInsertOrIgnore = /INSERT\s+OR\s+IGNORE\s+INTO/i.test(out);
  out = out.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO');
  out = out.replace(/INSERT\s+OR\s+REPLACE\s+INTO/gi, 'INSERT INTO');
  out = out.replace(/datetime\(\s*'now'\s*\)/gi, 'CURRENT_TIMESTAMP');
  out = out.replace(/date\(\s*'now'\s*\)/gi, 'CURRENT_DATE');
  out = out.replace(/GROUP_CONCAT\(\s*([^)]+?)\s*\)/gi, "STRING_AGG(CAST($1 AS NVARCHAR(MAX)), ',')");
  if (hadInsertOrIgnore && !/ON\s+CONFLICT/i.test(out)) out = out.trimEnd().replace(/;?$/, '') + ' ON CONFLICT DO NOTHING';
  if (!/\$\d/.test(out)) { let i = 0; out = out.replace(/\?/g, () => `$${++i}`); }
  return out;
}
