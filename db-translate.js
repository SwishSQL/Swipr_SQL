// PostgreSQL -> T-SQL translation of the SQL text the Swipr server and the Quality module send.
//
// The application was written against PostgreSQL ($1 placeholders, ->> JSON access, = ANY($1), UNNEST batches,
// ON CONFLICT upserts, RETURNING, LIMIT, ::casts). Rather than rewrite ~430 statements by hand, those constructs are
// translated here, mechanically and deterministically, one rule per construct; the few statements that have no safe
// mechanical translation are written in T-SQL directly in the code (marked "T-SQL").
//
// Rules are applied in the order of translateSql(). Every rule leaves text it does not recognise untouched, and
// tools/sweep.mjs compiles every statement of the app against a real SQL Server to prove nothing was missed.

const BIN = 'COLLATE Latin1_General_100_BIN2';

// ---- helpers ---------------------------------------------------------------------------------------------------
/** index of the ')' that closes the '(' at `open`, skipping string literals; -1 if unbalanced */
export function matchParen(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'") { i++; while (i < s.length && !(s[i] === "'" && s[i + 1] !== "'")) { if (s[i] === "'") i++; i++; } continue; }
    if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i;
  }
  return -1;
}
/** split a top-level comma list (ignoring commas inside parens / literals) */
export function splitTopLevel(s) {
  const out = []; let depth = 0, cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'") { let j = i + 1; while (j < s.length && !(s[j] === "'" && s[j + 1] !== "'")) { if (s[j] === "'") j++; j++; } cur += s.slice(i, j + 1); i = j; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
/** apply fn to the parts of the statement that are not inside '...' literals */
function outsideLiterals(sql, fn) {
  return sql.split(/('(?:[^']|'')*')/).map((p, i) => (i % 2 ? p : fn(p))).join('');
}

// ---- individual rules ---------------------------------------------------------------------------------------------
const stripComments = (s) => s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** $1 -> @p0 */
export function convertPlaceholders(sql) {
  return outsideLiterals(sql, (p) => p.replace(/\$(\d+)/g, (_, n) => `@p${Number(n) - 1}`));
}

/** a ->> 'key'  ->  JSON_VALUE(a, '$.key')   (users.data->>'username' uses the binary-collated computed column) */
export function convertJsonArrow(sql) {
  return sql.replace(/(\b(?:\w+\.)?)data\s*->>\s*'username'/g, '$1[username]')
    .replace(/\b([A-Za-z_][\w.]*)\s*->>\s*'(\w+)'/g, (_, expr, key) => `JSON_VALUE(${expr}, '$.${key}')`);
}

/** true / false literals */
export function convertBoolLiterals(sql) {
  return outsideLiterals(sql, (p) => p.replace(/\bTRUE\b/gi, '1').replace(/\bFALSE\b/gi, '0'));
}

/** x IS [NOT] DISTINCT FROM y -> null-safe comparison that works at any compatibility level */
export function convertDistinctFrom(sql) {
  return sql.replace(/([\w.\[\]]+)\s+IS\s+(NOT\s+)?DISTINCT\s+FROM\s+([\w.\[\]]+)/gi, (_, a, not, b) =>
    not ? `(${a} = ${b} OR (${a} IS NULL AND ${b} IS NULL))`
        : `(${a} <> ${b} OR (${a} IS NULL AND ${b} IS NOT NULL) OR (${a} IS NOT NULL AND ${b} IS NULL))`);
}

const SQL_WORDS = new Set(['SELECT', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'ON', 'WHEN', 'THEN', 'ELSE', 'CASE', 'BY', 'FROM', 'AS', 'SET', 'VALUES', 'HAVING', 'EXISTS']);
const CAST_TYPES = { int: 'INT', integer: 'INT', bigint: 'BIGINT', numeric: 'FLOAT', float: 'FLOAT', text: 'NVARCHAR(MAX)', boolean: 'BIT', date: 'DATE' };
/** expr::type -> CAST(expr AS type); casts of a bare parameter are dropped (the driver already types it) */
export function convertCasts(sql) {
  // 1) parameter casts: @p3::jsonb / ::text / ::bigint ...
  let out = sql.replace(/(@p\d+)::(?:jsonb|json|text|int|integer|bigint|numeric|boolean|float)\b/gi, '$1');
  // 2) anything else: find the operand to the left (a balanced (...) with an optional function name, or a plain token)
  for (let guard = 0; guard < 200; guard++) {
    const m = /::(\w+)(\[\])?/.exec(out);
    if (!m) break;
    const type = CAST_TYPES[m[1].toLowerCase()] || m[1].toUpperCase();
    let end = m.index, start;
    if (out[end - 1] === ')') {
      let depth = 0, i = end - 1;
      for (; i >= 0; i--) { if (out[i] === ')') depth++; else if (out[i] === '(' && --depth === 0) break; }
      start = i;
      const fn = /([A-Za-z_][\w.]*)\s*$/.exec(out.slice(0, start));
      if (fn && !SQL_WORDS.has(fn[1].toUpperCase())) start -= fn[0].length;
    } else {
      const tok = /([A-Za-z_@'][\w.@']*|\d[\d.]*)$/.exec(out.slice(0, end));
      if (!tok) { out = out.slice(0, m.index) + out.slice(m.index + m[0].length); continue; }
      start = end - tok[0].length;
    }
    out = `${out.slice(0, start)}CAST(${out.slice(start, end)} AS ${type})${out.slice(m.index + m[0].length)}`;
  }
  return out;
}

/** col = ANY(@p0) -> col IN (SELECT value FROM OPENJSON(@p0))   (the array is bound as a JSON array) */
export function convertAny(sql) {
  return sql.replace(/=\s*ANY\s*\(\s*(@p\d+)(?:::\w+\[\])?\s*\)/gi, (_, p) => `IN (SELECT [value] ${BIN} FROM OPENJSON(${p}))`);
}

/** UNNEST(@p0::text[], @p1::bigint[]) [AS k(a, b)]  ->  a derived table that zips OPENJSON arrays by position */
const UNNEST_TYPES = { text: 'NVARCHAR(MAX)', varchar: 'NVARCHAR(MAX)', bigint: 'BIGINT', int: 'INT', integer: 'INT', boolean: 'BIT', jsonb: 'NVARCHAR(MAX)', json: 'NVARCHAR(MAX)', numeric: 'FLOAT', float8: 'FLOAT' };
export function convertUnnest(sql) {
  let out = sql;
  for (let guard = 0; guard < 20; guard++) {
    const m = /\bUNNEST\s*\(/i.exec(out);
    if (!m) break;
    const open = m.index + m[0].length - 1, close = matchParen(out, open);
    const args = splitTopLevel(out.slice(open + 1, close));
    let rest = out.slice(close + 1);
    const alias = /^\s*(?:AS\s+)?(\w+)\s*\(([^)]*)\)/i.exec(rest);
    let names = null, name = 'u';
    if (alias) { name = alias[1]; names = alias[2].split(',').map((s) => s.trim()); rest = rest.slice(alias[0].length); }
    const cols = args.map((a, i) => {
      const t = (/::(\w+)\[\]/.exec(a) || [])[1] || 'text';
      const p = /@p\d+/.exec(a)[0];
      const sqlType = UNNEST_TYPES[t.toLowerCase()] || 'NVARCHAR(MAX)';
      return { p, expr: `CAST(j${i}.[value] AS ${sqlType})${sqlType.startsWith('NVARCHAR') ? ' ' + BIN : ''}`, name: names ? names[i] : `c${i + 1}` };
    });
    const from = cols.map((c, i) => (i === 0 ? `OPENJSON(${c.p}) j0` : `JOIN OPENJSON(${c.p}) j${i} ON j${i}.[key] = j0.[key]`)).join(' ');
    const derived = `(SELECT ${cols.map((c) => `${c.expr} AS [${c.name}]`).join(', ')} FROM ${from}) AS [${name}]`;
    out = out.slice(0, m.index) + derived + rest;
  }
  return out;
}

/** LIMIT n [OFFSET m] -> OFFSET/FETCH (needs the ORDER BY every LIMIT in this app has); without ORDER BY -> TOP */
export function convertLimit(sql) {
  const m = /\s+LIMIT\s+(@p\d+|\d+)(?:\s+OFFSET\s+(@p\d+|\d+))?\s*;?\s*$/i.exec(sql);
  if (!m) return sql;
  const head = sql.slice(0, m.index);
  if (/\bORDER\s+BY\b/i.test(head.slice(head.lastIndexOf(')') + 1)) || /\bORDER\s+BY\b/i.test(head)) {
    const n = (x) => (String(x).startsWith('@') ? `CAST(${x} AS INT)` : x);
    return `${head} OFFSET ${n(m[2] || 0)} ROWS FETCH NEXT ${n(m[1])} ROWS ONLY`;
  }
  return head.replace(/^(\s*SELECT\s+(?:DISTINCT\s+)?)/i, `$1TOP (${m[1]}) `);
}

/** FOR UPDATE -> lock hint on the (single) table in FROM */
export function convertForUpdate(sql) {
  if (!/\s+FOR\s+UPDATE\s*$/i.test(sql)) return sql;
  const body = sql.replace(/\s+FOR\s+UPDATE\s*$/i, '');
  return body.replace(/(\bFROM\s+)(\w+)(\s+(?:AS\s+)?(?!WHERE\b|JOIN\b|ORDER\b|LEFT\b|INNER\b|GROUP\b)\w+)?/i, (_, f, t, alias) => `${f}${t}${alias || ''} WITH (UPDLOCK, ROWLOCK)`);
}

/** ORDER BY x DESC NULLS LAST is T-SQL's default (NULLs sort lowest); ASC NULLS FIRST likewise */
export function convertNulls(sql) {
  return sql.replace(/\b(DESC)\s+NULLS\s+LAST\b/gi, '$1').replace(/\b(ASC)\s+NULLS\s+FIRST\b/gi, '$1');
}

/** DELETE FROM t alias WHERE ... -> DELETE alias FROM t alias WHERE ... */
export function convertDeleteAlias(sql) {
  return sql.replace(/^(\s*)DELETE\s+FROM\s+(\w+)\s+(?:AS\s+)?(?!WHERE\b|OUTPUT\b)(\w+)\s+/i, '$1DELETE $3 FROM $2 $3 ');
}

/** RETURNING for plain INSERT / UPDATE / DELETE */
export function convertReturning(sql) {
  const m = /\s+RETURNING\s+(\*|[\w\s,.]+?)\s*;?\s*$/i.exec(sql);
  if (!m) return sql;
  const body = sql.slice(0, m.index);
  const cols = m[1].trim();
  const out = (prefix) => `OUTPUT ${cols === '*' ? `${prefix}.*` : cols.split(',').map((c) => `${prefix}.${c.trim()}`).join(', ')}`;
  if (/^\s*INSERT\b/i.test(body)) {
    // OUTPUT sits between the column list and VALUES / SELECT
    const mm = /^(\s*INSERT\s+INTO\s+\S+\s*(?:\([^)]*\))?)\s*([\s\S]*)$/i.exec(body);
    return `${mm[1]} ${out('INSERTED')} ${mm[2]}`;
  }
  if (/^\s*UPDATE\b/i.test(body)) {
    const w = body.search(/\s+WHERE\s+/i);
    return w < 0 ? `${body} ${out('INSERTED')}` : `${body.slice(0, w)} ${out('INSERTED')}${body.slice(w)}`;
  }
  if (/^\s*DELETE\b/i.test(body)) {
    const w = body.search(/\s+WHERE\s+/i);
    return w < 0 ? `${body} ${out('DELETED')}` : `${body.slice(0, w)} ${out('DELETED')}${body.slice(w)}`;
  }
  return sql;
}

/**
 * INSERT ... ON CONFLICT  ->  MERGE (or TRY/CATCH for the single-row "DO NOTHING without a key" form).
 *   target alias: tgt   source alias: src   EXCLUDED.x -> src.x    <table>.x -> tgt.x
 */
export function convertOnConflict(sql) {
  const head = /^\s*INSERT\s+INTO\s+(\w+)\s*\(([^)]*)\)\s*([\s\S]*?)\s+ON\s+CONFLICT\s*(?:\(([^)]*)\))?\s*DO\s+(NOTHING|UPDATE)\b([\s\S]*)$/i.exec(sql);
  if (!head) return sql;
  const [, table, colList, source, keyList, action, tail] = head;
  const cols = colList.split(',').map((c) => c.trim());
  const keys = keyList ? keyList.split(',').map((c) => c.trim()) : null;
  let tailSql = tail;
  let returning = '';
  const r = /\s+RETURNING\s+(\*|[\w\s,.]+?)\s*;?\s*$/i.exec(tailSql);
  if (r) { returning = r[1].trim(); tailSql = tailSql.slice(0, r.index); }
  const outputClause = returning ? ` OUTPUT ${returning === '*' ? 'INSERTED.*' : returning.split(',').map((c) => 'INSERTED.' + c.trim()).join(', ')}` : '';

  // the source rows
  let using;
  const vals = /^\s*VALUES\s*([\s\S]*)$/i.exec(source);
  if (vals) using = `(VALUES ${vals[1]}) AS src (${cols.map((c) => `[${c}]`).join(', ')})`;
  else {
    const sel = /^\s*SELECT\s+\*\s+FROM\s+(\([\s\S]*\))\s+AS\s+\[(\w+)\]\s*$/i.exec(source);
    if (!sel) return sql;                       // not a shape we know: leave it, the sweep will flag it
    // the UNNEST derived table names its columns c1..cn (no alias given): map them onto the INSERT's column list
    using = `(SELECT ${cols.map((c, i) => `[${sel[2]}].[c${i + 1}] AS [${c}]`).join(', ')} FROM ${sel[1]} AS [${sel[2]}]) AS src`;
  }

  if (action.toUpperCase() === 'NOTHING') {
    if (!keys) {
      // single row, conflict target unknown (a partial unique index): swallow only duplicate-key errors
      const ins = `INSERT INTO ${table} (${colList}) ${outputClause ? outputClause.trim() + ' ' : ''}${source}`;
      return `BEGIN TRY ${ins}; END TRY BEGIN CATCH IF ERROR_NUMBER() NOT IN (2601, 2627) THROW; END CATCH`;
    }
    return `MERGE ${table} WITH (HOLDLOCK) AS tgt USING ${using} ON ${keys.map((k) => `tgt.[${k}] = src.[${k}]`).join(' AND ')} ` +
      `WHEN NOT MATCHED THEN INSERT (${cols.map((c) => `[${c}]`).join(', ')}) VALUES (${cols.map((c) => `src.[${c}]`).join(', ')})${outputClause};`;
  }

  // DO UPDATE SET a = ..., b = ... [WHERE cond]
  const um = /^\s*SET\s+([\s\S]*?)(?:\s+WHERE\s+([\s\S]*))?$/i.exec(tailSql);
  if (!um || !keys) return sql;
  const fix = (s) => s.replace(/\bEXCLUDED\./gi, 'src.').replace(new RegExp(`\\b${table}\\.`, 'gi'), 'tgt.');
  const sets = splitTopLevel(um[1]).map((a) => { const eq = a.indexOf('='); return `[${a.slice(0, eq).trim()}] = ${fix(a.slice(eq + 1).trim())}`; });
  const cond = um[2] ? ` AND (${fix(um[2].trim())})` : '';
  return `MERGE ${table} WITH (HOLDLOCK) AS tgt USING ${using} ON ${keys.map((k) => `tgt.[${k}] = src.[${k}]`).join(' AND ')} ` +
    `WHEN MATCHED${cond} THEN UPDATE SET ${sets.join(', ')} ` +
    `WHEN NOT MATCHED THEN INSERT (${cols.map((c) => `[${c}]`).join(', ')}) VALUES (${cols.map((c) => `src.[${c}]`).join(', ')})${outputClause};`;
}

/** UPDATE t alias SET ... FROM ...  is fine in T-SQL only as UPDATE alias SET ... FROM t alias — handled where used */

export function translateSql(raw) {
  let s = stripComments(raw).trim().replace(/;\s*$/, '');
  if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;?\s*$/i.test(s)) return s;
  s = convertPlaceholders(s);
  s = convertJsonArrow(s);
  s = convertCasts(s);
  s = convertAny(s);
  s = convertUnnest(s);
  s = convertDistinctFrom(s);
  s = convertBoolLiterals(s);
  s = convertOnConflict(s);
  s = convertReturning(s);
  s = convertForUpdate(s);
  s = convertNulls(s);
  s = convertDeleteAlias(s);
  s = convertLimit(s);
  return s;
}
