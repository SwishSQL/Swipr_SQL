// Compile sweep: translate every SQL statement found in a source file and ask SQL Server to COMPILE it (SET NOEXEC ON:
// syntax, object and column names, collations are checked; nothing runs). Statements that still look un-translated
// (leftover $n, ::, ->>, ANY(, UNNEST, ON CONFLICT, RETURNING, LIMIT) are reported even if they compile.
//   node tools/sweep.mjs server.js [--show]
import fs from 'node:fs';
import { getPool, sql, pool } from '../db.js';
import { translateSql } from '../db-translate.js';

const file = process.argv[2] || 'server.js';
const show = process.argv.includes('--show');
const src = fs.readFileSync(file, 'utf8');
const found = [];
const re = /(?:\.query|\.prepare|\.all|\.get|\.run)\(\s*(`|'|")/g;
let m;
while ((m = re.exec(src))) {
  const q = m[1]; let i = re.lastIndex, s = '';
  while (i < src.length) { const ch = src[i]; if (ch === '\\') { s += ch + src[i + 1]; i += 2; continue; } if (ch === q) break; s += ch; i++; }
  if (/^\s*(SELECT|INSERT|UPDATE|DELETE|WITH|MERGE)\b/i.test(s)) found.push({ line: src.slice(0, m.index).split('\n').length, raw: s });
}
const p = await getPool();
let ok = 0; const bad = [];
for (const f of found) {
  // ${...} interpolations inside template literals are code, not SQL: stand in a harmless placeholder
  const raw = f.raw.replace(/\$\{[^}]*\}/g, '1');
  let t;
  try { t = translateSql(raw); } catch (e) { bad.push({ ...f, why: 'translator threw: ' + e.message }); continue; }
  const leftovers = [...(t.match(/\$\d|::|->>|=\s*ANY\s*\(|\bUNNEST\b|\bON\s+CONFLICT\b|\bRETURNING\b|\bLIMIT\b|\bILIKE\b/gi) || [])];
  const n = (t.match(/@p(\d+)/g) || []).map((x) => Number(x.slice(2)));
  const decl = [...new Set(n)].map((i) => `DECLARE @p${i} NVARCHAR(MAX);`).join(' ');
  try {
    await p.request().batch(`SET NOEXEC ON; ${decl} ${t}`);
    await p.request().batch('SET NOEXEC OFF');
    if (leftovers.length) bad.push({ ...f, why: 'compiles but still contains: ' + leftovers.join(' '), t });
    else ok++;
    if (show) console.log(`-- line ${f.line}\n${t}\n`);
  } catch (e) {
    try { await p.request().batch('SET NOEXEC OFF'); } catch { /* connection reset */ }
    bad.push({ ...f, why: e.message.split('\n')[0], t });
  }
}
console.log(`${found.length} statements: ${ok} compile clean, ${bad.length} need attention`);
for (const b of bad) console.log(`\nline ${b.line}: ${b.why}\n  ${(b.t || b.raw).replace(/\s+/g, ' ').slice(0, 420)}`);
await pool.end();
