// One-off, kept for the record: edits to qa/qa-module.ts for the SQL Server edition that are not SQL-dialect translations.
// The module is NO LONGER regenerated from the QA server (that generator targeted PostgreSQL); edit qa-module.ts directly.
const fs = require('fs');
const f = 'qa/qa-module.ts';
let s = fs.readFileSync(f, 'utf8');
const nl = s.includes('\r\n') ? '\r\n' : '\n';
s = s.replace(/\r\n/g, '\n');
const cut = (from, to, replacement, what) => {
  const a = s.indexOf(from);
  if (a < 0) throw new Error('not found: ' + what);
  const b = s.indexOf(to, a);
  if (b < 0) throw new Error('end not found: ' + what);
  s = s.slice(0, a) + replacement + s.slice(b + to.length);
  console.log('edited:', what);
};
// 1) the application issues no DDL: the columns / tables exist in sql/schema.sql
cut(`    try { await db.exec("ALTER TABLE coaching_requests ADD COLUMN IF NOT EXISTS cc_supervisor_note TEXT"); } catch(e) {}\n`, `    try { await db.exec("ALTER TABLE escalation_logs ADD COLUMN IF NOT EXISTS cc_supervisor_note TEXT"); } catch(e) {}\n`,
  `    // (cc_supervisor_note columns come from sql/schema.sql — the application issues no DDL)\n`, 'cc_supervisor_note ALTERs');
cut('    await db.exec(`\n      CREATE TABLE IF NOT EXISTS tl_kpi_config (', '      );\n    `);\n', '    // (tl_kpi_config comes from sql/schema.sql)\n', 'tl_kpi_config CREATE TABLE');
fs.writeFileSync(f, s.replace(/\n/g, nl));
