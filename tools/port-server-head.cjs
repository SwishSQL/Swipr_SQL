// One-off (kept for the record): the mechanical edits that turn server.js from the PostgreSQL edition into the SQL Server
// edition's skeleton — imports, pool, initDb(), and the one-off cloud imports that only existed for the move off Firestore.
const fs = require('fs');
const f = 'server.js';
let s = fs.readFileSync(f, 'utf8');
const nl = s.includes('\r\n') ? '\r\n' : '\n';
s = s.replace(/\r\n/g, '\n');
const must = (cond, what) => { if (!cond) throw new Error('not found: ' + what); };

// 1) header + imports
must(s.startsWith('// Swish Schedule — Express + PostgreSQL backend'), 'header');
s = s.replace('// Swish Schedule — Express + PostgreSQL backend', '// Swish Schedule — Express + SQL Server backend');
must(s.includes("import pg from 'pg';\n"), 'import pg');
s = s.replace("import pg from 'pg';\n", "import { pool, initDatabase, verifySchema } from './db.js';\n");
must(s.includes("import { runFirestoreMigration, runWeeksImport, runDeptImport } from './migrate.js';\n"), 'migrate import');
s = s.replace("import { runFirestoreMigration, runWeeksImport, runDeptImport } from './migrate.js';\n", '');
must(s.includes('const { Pool } = pg;\n'), 'Pool');
s = s.replace('const { Pool } = pg;\n', '');

// 2) pool + initDb(): replaced by the shared data layer and sql/schema.sql
const a = s.indexOf('function sslConfig() {');
const b = s.indexOf("console.log('[db] schema ready');\n}\n", a);
must(a > 0 && b > a, 'initDb block');
const bEnd = b + "console.log('[db] schema ready');\n}\n".length;
s = s.slice(0, a) + `// The data layer is db.js (SQL Server). The application never issues DDL: every table, index and view comes from
// sql/schema.sql — run by the DBA / \`npm run db:init\`, or by the app itself when AUTO_INIT_DB=true.
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
    console.log(\`[db] schema applied (\${n} batches)\`);
  }
  await verifySchema(process.env.QA_MODULE === 'off' ? REQUIRED_OBJECTS : [...REQUIRED_OBJECTS, ...QA_OBJECTS]);
  console.log('[db] schema ready');
}
` + s.slice(bEnd);

// 3) one-off imports that only existed for the move from Firestore / the week import: not part of the SQL Server edition
const c = s.indexOf('// One-time Firestore -> Postgres import');
const d = s.indexOf('async function maybeRunDeptImport()');
must(c > 0 && d > c, 'migration block');
// find the end of maybeRunDeptImport: the next top-level "\n}\n" after d
const dEnd = s.indexOf('\n}\n', d) + 3;
const sepStart = s.lastIndexOf('// ----', c);
s = s.slice(0, sepStart) + `// ---------------------------------------------------------------------------
// The one-off Firestore / week / department imports of the PostgreSQL edition are not part of this edition.
// ---------------------------------------------------------------------------
` + s.slice(dEnd);
s = s.replace("    maybeRunFirestoreMigration().catch((e) => console.error('[migrate] setup error', e));\n", '');
s = s.replace("    maybeRunWeekImport().catch((e) => console.error('[week-import] setup error', e));\n", '');
s = s.replace("    maybeRunDeptImport().catch((e) => console.error('[dept-import] setup error', e));\n", '');

fs.writeFileSync(f, s.replace(/\n/g, nl));
console.log('server.js head ported');
