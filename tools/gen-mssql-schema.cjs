// Generates Swipr_SQL/sql/schema.sql (T-SQL, idempotent) from the REAL PostgreSQL catalog of the staging DB
// (catalog.json, made by dump-catalog.cjs) — not from the CREATE TABLE text in server.js, which can drift from production.
//   node gen-mssql-schema.cjs [out.sql]
const fs = require('fs');
const cat = require('./catalog.json');
const OUT = process.argv[2] || 'C:/Users/Zedni Store/Swipr_SQL/sql/schema.sql';
const BIN = 'COLLATE Latin1_General_100_BIN2';
const q = (s) => '[' + s + ']';

// text columns that are part of ANY index / key get NVARCHAR(450) (indexable) with a binary collation, which gives
// PostgreSQL's case-sensitive equality; every other text column is NVARCHAR(MAX).
const keyCols = (t) => {
  const s = new Set();
  for (const c of cat[t].cons) if (c.contype === 'p' || c.contype === 'u') for (const m of c.def.match(/\(([^)]*)\)/)[1].split(',')) s.add(m.trim().replace(/"/g, ''));
  for (const i of cat[t].idx) {
    const inside = i.indexdef.replace(/\s+WHERE\s+.*$/i, '').match(/\(([^)]*)\)\s*$/);
    if (inside) for (const m of inside[1].split(',')) { const n = m.trim().replace(/\s+(DESC|ASC)$/i, '').replace(/"/g, ''); if (/^\w+$/.test(n)) s.add(n); }
  }
  return s;
};

function colType(t, c, keys) {
  const ty = c.type;
  if (/^text$|^character varying/.test(ty)) return keys.has(c.name) ? `NVARCHAR(450) ${BIN}` : `NVARCHAR(MAX) ${BIN}`;
  if (ty === 'jsonb' || ty === 'json') return `NVARCHAR(MAX) ${BIN}`;
  if (ty === 'bigint') return 'BIGINT';
  if (ty === 'integer') return c.def && /^nextval/.test(c.def) ? 'INT' : 'INT';
  if (ty === 'smallint') return 'SMALLINT';
  if (ty === 'double precision') return 'FLOAT';
  if (ty === 'real') return 'REAL';
  if (ty === 'boolean') return 'BIT';
  if (ty === 'bytea') return 'VARBINARY(MAX)';
  if (/^timestamp/.test(ty)) return 'DATETIME2(6)';
  if (/^numeric/.test(ty)) return ty.replace('numeric', 'DECIMAL');
  throw new Error(`unmapped type ${ty} on ${t}.${c.name}`);
}
function colDefault(c) {
  if (!c.def || /^nextval/.test(c.def)) return '';
  let d = c.def;
  if (/CURRENT_TIMESTAMP|now\(\)/i.test(d)) return ' DEFAULT SYSUTCDATETIME()';
  if (d === 'false') return ' DEFAULT 0';
  if (d === 'true') return ' DEFAULT 1';
  const m = d.match(/^'(.*)'::text$/); if (m) return ` DEFAULT N'${m[1].replace(/'/g, "''")}'`;
  if (/^-?[\d.]+$/.test(d)) return ` DEFAULT ${d}`;
  throw new Error('unmapped default ' + d);
}

let sql = `-- Swipr + Quality on SQL Server. GENERATED from the real PostgreSQL catalog (tools/gen-mssql-schema.cjs); idempotent.
-- Run by the DBA (or by the app with AUTO_INIT_DB=true) — statements are separated by lines that contain only GO.
-- Conventions: EVERY text column carries the same BINARY collation (PostgreSQL compares text case-sensitively, and two columns with
-- different collations cannot be compared in SQL Server at all); keys are NVARCHAR(450) so they can be indexed, the rest NVARCHAR(MAX); JSON documents are NVARCHAR(MAX) with ISJSON checks; timestamps are DATETIME2(6) in UTC; epoch-ms columns stay BIGINT.
SET NOCOUNT ON;
GO
`;
const views = [];
for (const [t, d] of Object.entries(cat)) {
  if (d.view) { views.push(t); continue; }
  const keys = keyCols(t);
  const pk = d.cons.find((x) => x.contype === 'p');
  const pkCols = pk ? pk.def.match(/\(([^)]*)\)/)[1].split(',').map((s) => s.trim().replace(/"/g, '')) : [];
  const lines = [];
  const notNull = new Set(d.cons.filter((x) => x.contype === 'n').map((x) => x.def.replace(/^NOT NULL\s+/i, '').replace(/"/g, '').trim()));
  for (const c of d.cols) {
    const ident = c.def && /^nextval/.test(c.def) ? ' IDENTITY(1,1)' : '';
    // NOT NULL comes from the catalog's 'n' constraints ("NOT NULL colname") — the attnotnull alias was unreliable
    const nn = notNull.has(c.name) || pkCols.includes(c.name) ? ' NOT NULL' : ' NULL';
    lines.push(`  ${q(c.name)} ${colType(t, c, keys)}${ident}${nn}${colDefault(c)}`);
  }
  if (t === 'users') lines.push(`  [username] AS (JSON_VALUE([data], '$.username') ${BIN})`);
  for (const c of d.cols) if (c.type === 'jsonb') lines.push(`  CONSTRAINT ${q('ck_' + t + '_' + c.name + '_json')} CHECK (ISJSON(${q(c.name)}) = 1)`);
  if (pk) lines.push(`  CONSTRAINT ${q('pk_' + t)} PRIMARY KEY (${pkCols.map(q).join(', ')})`);
  sql += `IF OBJECT_ID(N'dbo.${t}', N'U') IS NULL\nCREATE TABLE dbo.${q(t)} (\n${lines.join(',\n')}\n);\nGO\n`;
  for (const i of d.idx) {
    if (/_pkey$/.test(i.indexname)) continue;
    const unique = /CREATE UNIQUE/.test(i.indexdef) ? 'UNIQUE ' : '';
    const where = (i.indexdef.match(/\s+WHERE\s+\((.*)\)\s*$/i) || [])[1];
    const cols0 = /data ->> 'username'/.test(i.indexdef) ? 'username' : i.indexdef.replace(/\s+WHERE\s+.*$/i, '').match(/\(([^)]*)\)\s*$/)[1];
    let cols = cols0;
    cols = cols.split(',').map((s) => { s = s.trim().replace(/"/g, ''); const m = s.match(/^(\w+)(\s+(DESC|ASC))?$/i); if (!m) throw new Error('index col ' + s); return q(m[1]) + (m[3] ? ' ' + m[3].toUpperCase() : ''); }).join(', ');
    const w = where ? ` WHERE ${where.replace(/\bIS NOT NULL\b/g, 'IS NOT NULL').replace(/"/g, '')}` : '';
    sql += `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'${i.indexname}' AND object_id = OBJECT_ID(N'dbo.${t}'))\nCREATE ${unique}INDEX ${q(i.indexname)} ON dbo.${q(t)} (${cols})${w};\nGO\n`;
  }
}
sql += fs.readFileSync(__dirname + '/mssql-views.sql', 'utf8');
fs.mkdirSync(require('path').dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, sql);
console.log(`wrote ${OUT}: ${Object.keys(cat).length - views.length} tables, views by hand: ${views.join(', ')}`);
