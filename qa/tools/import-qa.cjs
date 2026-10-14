// Idempotent QA -> Swipr import. READS the QA database (never writes it), WRITES only the Swipr target.
//   node import-qa.cjs --source qa_copy --target swipr_stage [--dry-run]
//   against real servers:  node import-qa.cjs --source-url-env QA_DATABASE_URL --target-url-env SWIPR_DATABASE_URL --schema ../schema.sql --overrides user-overrides.json [--dry-run]
// Re-run it as often as you like: it mirrors QA's current state (upserts + removes rows QA deleted).
// Decisions about people can be pinned in user-overrides.json: { "<qaUserId>": "<swiprUserId>" | "create" }.
const fs = require('fs');
const { Client, types } = require('pg');
const LOCAL = { host: 'localhost', port: 54329, user: 'postgres', password: 'staging' };
const rawTypes = { getTypeParser: (oid, fmt) => (oid === 17 ? types.getTypeParser(oid, fmt) : (v) => v) };
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : d; };
const KEEP_PROFILES = process.argv.includes('--keep-profiles');   // after cutover: Quality Access screen owns the profiles, never overwrite them
const DRY = process.argv.includes('--dry-run');
const q = (s) => '"' + s + '"';
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim().replace(/\s+/g, ' ');
const key2 = (n) => { const t = norm(n).split(' '); return t.length > 1 ? t[0] + ' ' + t[t.length - 1] : t[0]; };

const REFS = {
  evaluations: ['agent_id', 'qa_id', 'last_edited_by'], evaluation_drafts: ['owner_id', 'agent_id'], evaluation_edits: ['editor_id'],
  coaching_requests: ['tl_id', 'agent_id'], coaching_sessions: ['agent_id', 'tl_id'], escalation_logs: ['user_id'], accuracy_cases: ['qa_id', 'tl_id'],
  notifications: ['user_id'], audit_logs: ['user_id'], qa_kpi_config: ['user_id'], qa_kpi_day_overrides: ['qa_id', 'set_by_user_id'],
  tl_kpi_config: ['user_id'], user_sessions: ['user_id'], form_config: [], form_settings: [],
  attendance_records: ['user_id'], user_leaves: ['user_id', 'approved_by'], xontel_agent_map: ['user_id', 'confirmed_by'],
  // xontel_settings (saved XonTel token + url) is deliberately NOT mirrored: handled at cutover
};
const JSON_COLS = { evaluations: 'data', evaluation_drafts: 'data', evaluation_edits: 'changes' };
const JSON_REF_KEYS = new Set(['agent_id', 'evaluator_id', 'qa_id', 'tl_id', 'owner_id', 'editor_id', 'last_edited_by', 'user_id', 'set_by_user_id']);
const tgtName = (t) => (t === 'attendance_records' ? 'qa_attendance_records_legacy' : t.startsWith('qa_') ? t : 'qa_' + t);

const ROLE = { agent: 'EMPLOYEE', tl: 'MANAGER', supervisor: 'SUPERVISOR', cc_supervisor: 'SUPERVISOR', qa: 'EMPLOYEE', compliance: 'EMPLOYEE' };
const JOB = { agent: 'CSR', tl: 'Team Leader', supervisor: 'Super Visor', cc_supervisor: 'Super Visor', qa: 'Quality Agent', compliance: 'Quality Agent' };
const DEPTS = ['Call Center', 'Technical', 'Complain', 'Quality'];
const genId = (taken) => { let id; do { id = Math.random().toString(36).slice(2, 11); } while (taken.has(id) || id.length < 9); taken.add(id); return id; };

(async () => {
  const src = new Client({ ...(arg('source-url-env') ? { connectionString: process.env[arg('source-url-env')], ssl: false } : { ...LOCAL, database: arg('source', 'qa_copy') }), types: rawTypes });
  await src.connect();
  await src.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); // QA is only ever read
  const tgt = new Client({ ...(arg('target-url-env') ? { connectionString: process.env[arg('target-url-env')], ssl: false } : { ...LOCAL, database: arg('target', 'swipr_stage') }), types: rawTypes });
  await tgt.connect();

  if (!DRY) await tgt.query(fs.readFileSync(arg('schema', 'qa-module-schema.sql'), 'utf8'));

  // ---------------- 1. people ----------------
  const qa = (await src.query(`SELECT id, display_name, username, password, role, department, tl_id, status, allowed_departments, allowed_brands, cc_supervisor_id FROM users ORDER BY id`)).rows;
  const sw = (await tgt.query(`SELECT id, data->>'name' AS name, data->>'username' AS username FROM users`)).rows;
  const prior = new Map((await tgt.query(`SELECT qa_user_id, user_id, match_kind FROM qa_user_map`).catch(() => ({ rows: [] }))).rows.map((r) => [Number(r.qa_user_id), r]));
  const overrides = fs.existsSync('user-overrides.json') ? JSON.parse(fs.readFileSync('user-overrides.json', 'utf8')) : {};
  const byUser = new Map(sw.map((u) => [norm(u.username), u])), byName = new Map(sw.map((u) => [norm(u.name), u])), byKey = new Map(sw.map((u) => [key2(u.name), u]));
  const taken = new Set(sw.map((u) => u.id));
  // XonTel agent id is a hard identity key: the same agent mapped in both systems is the same person
  const qaXon = new Map((await src.query(`SELECT user_id, xontel_agent_id FROM xontel_agent_map`)).rows.map((r) => [Number(r.user_id), String(r.xontel_agent_id)]));
  const swXon = new Map((await tgt.query(`SELECT xontel_agent_id, user_id FROM xontel_agent_map`)).rows.map((r) => [String(r.xontel_agent_id), r.user_id]));
  const swById = new Map(sw.map((u) => [u.id, u]));
  const plan = []; // { qa, user_id|null, kind, note }
  for (const u of qa) {
    const p = prior.get(Number(u.id));
    if (p) { plan.push({ qa: u, user_id: p.user_id, kind: p.match_kind }); continue; }
    const ov = overrides[String(u.id)];
    if (ov === 'skip') { plan.push({ qa: u, user_id: null, kind: 'skip' }); continue; }
    if (ov === 'former') { plan.push({ qa: u, user_id: null, kind: 'former' }); continue; }   // left the company: no Swipr account, history keeps the name
    if (ov && ov !== 'create') { plan.push({ qa: u, user_id: ov, kind: 'override' }); continue; }
    const a = byUser.get(norm(u.username)), b = byName.get(norm(u.display_name));
    const xs = swXon.get(qaXon.get(Number(u.id)));
    if (ov !== 'create' && a) plan.push({ qa: u, user_id: a.id, kind: 'username' });
    else if (ov !== 'create' && xs && swById.get(xs)) plan.push({ qa: u, user_id: xs, kind: 'xontel', note: `same XonTel agent: QA "${u.display_name}" [${u.username}] -> Swipr "${swById.get(xs).name}" (${swById.get(xs).username})` });
    else if (ov !== 'create' && b) plan.push({ qa: u, user_id: b.id, kind: 'name', note: `name only: QA "${u.display_name}" -> Swipr "${b.name}" (${b.username})` });
    else plan.push({ qa: u, user_id: null, kind: 'create', note: !ov && byKey.has(key2(u.display_name)) ? `looks like Swipr "${byKey.get(key2(u.display_name)).name}" (${byKey.get(key2(u.display_name)).username}), created as NEW, pin it in user-overrides.json if it is the same person` : '' });
  }
  const claimed = new Map();
  for (const p of plan.filter((x) => x.user_id)) { if (!claimed.has(p.user_id)) claimed.set(p.user_id, []); claimed.get(p.user_id).push(p); }
  const merged = [...claimed.entries()].filter(([, v]) => v.length > 1);
  for (const [uid, v] of merged) console.log(`   MERGE: ${v.map((p) => `QA#${p.qa.id} "${p.qa.display_name}" [${p.qa.username}/${p.qa.role}] via ${p.kind}`).join('  +  ')}  -> ONE Swipr person ${uid} (pin one as "create" in user-overrides.json to keep them separate)`);
  const live = plan.filter((p) => p.kind !== 'skip' && p.kind !== 'former');
  const former = plan.filter((p) => p.kind === 'former');
  const count = (f) => plan.filter(f).length;
  console.log(`people: ${plan.length} QA users -> already mapped ${count((p) => prior.has(Number(p.qa.id)))}, by username ${count((p) => p.kind === 'username' && !prior.has(Number(p.qa.id)))}, by name ${count((p) => p.kind === 'name' && !prior.has(Number(p.qa.id)))}, to create ${count((p) => p.kind === 'create')}, skipped ${count((p) => p.kind === 'skip')}, by xontel ${count((p) => p.kind === 'xontel')}, pinned ${count((p) => p.kind === 'override')}`);
  for (const p of plan.filter((x) => x.note)) console.log('   ! ' + p.note);
  const depts = {}; for (const u of qa) depts[u.department] = (depts[u.department] || 0) + 1;
  console.log('   QA department values:', JSON.stringify(depts));
  if (DRY) { console.log('\n(dry run: nothing written)'); await src.query('ROLLBACK'); await src.end(); await tgt.end(); return; }

  await tgt.query('BEGIN');
  try {
    const now = Date.now();
    const created = [];
    for (const p of plan.filter((x) => x.kind === 'create' && !x.user_id)) {
      const id = genId(taken), u = p.qa;
      const dept = u.role === 'qa' || u.role === 'compliance' ? 'Quality' : DEPTS.includes(u.department) ? u.department : 'Call Center';
      const data = { name: u.display_name, role: ROLE[u.role] || 'EMPLOYEE', brand: '', phone: '', branch: '', brands: [], branches: [], jobTitle: JOB[u.role] || '', username: u.username, employeeId: '', teamLeader: '', companyName: dept, managerName: '', password: u.password };
      await tgt.query(`INSERT INTO users (id, data) VALUES ($1, $2::jsonb)`, [id, JSON.stringify(data)]);
      p.user_id = id; created.push({ id, name: u.display_name, role: u.role, dept });
    }
    for (const p of live) {
      await tgt.query(`INSERT INTO qa_user_map (qa_user_id, user_id, match_kind, created_at) VALUES ($1,$2,$3,$4)
                       ON CONFLICT (qa_user_id) DO UPDATE SET user_id = EXCLUDED.user_id, match_kind = EXCLUDED.match_kind`, [p.qa.id, p.user_id, p.kind, now]);
    }
    const map = new Map(live.map((p) => [Number(p.qa.id), p.user_id])), inv = new Map(); for (const p of live) { if (!inv.has(p.user_id)) inv.set(p.user_id, new Set()); inv.get(p.user_id).add(Number(p.qa.id)); }
    const orphans = new Set();
    const toSw = (v) => { if (v === null || v === undefined || v === '') return null; const m = map.get(Number(v)); if (m) return m; orphans.add(String(v)); return 'qa:' + v; };
    await tgt.query('DELETE FROM qa_former_staff');
    for (const p of former) {
      const u = p.qa;
      await tgt.query(`INSERT INTO qa_former_staff (id, qa_user_id, display_name, username, role, department, tl_user_id, cc_supervisor_user_id, allowed_departments, allowed_brands) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        ['qa:' + u.id, u.id, u.display_name, u.username, u.role, u.department, toSw(u.tl_id), toSw(u.cc_supervisor_id), u.allowed_departments, u.allowed_brands]);
    }
    const toQa = (v) => (v === null || v === undefined ? null : String(v).startsWith('qa:') ? String(v).slice(3) : String(inv.get(v) ?? '?' + v));
    const rw = (v, f) => Array.isArray(v) ? v.map((x) => rw(x, f)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, JSON_REF_KEYS.has(k) && (typeof x === 'number' || (typeof x === 'string' && x !== '')) ? f(x) : rw(x, f)])) : v;

    const profiled = new Set();
    for (const p of live) {
      if (profiled.has(p.user_id)) continue; profiled.add(p.user_id);
      const u = p.qa;
      const onConflict = KEEP_PROFILES ? 'DO NOTHING'
        : 'DO UPDATE SET qa_role=EXCLUDED.qa_role, qa_status=EXCLUDED.qa_status, qa_department=EXCLUDED.qa_department, tl_user_id=EXCLUDED.tl_user_id, cc_supervisor_user_id=EXCLUDED.cc_supervisor_user_id, allowed_departments=EXCLUDED.allowed_departments, allowed_brands=EXCLUDED.allowed_brands';
      await tgt.query(`INSERT INTO qa_user_profile (user_id, qa_role, qa_status, qa_department, tl_user_id, cc_supervisor_user_id, allowed_departments, allowed_brands)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (user_id) ${onConflict}`,
        [p.user_id, u.role, u.status, u.department, toSw(u.tl_id), toSw(u.cc_supervisor_id), u.allowed_departments, u.allowed_brands]);
    }

    // ---------------- 2. mirror the tables ----------------
    const results = [];
    const srcData = {};
    for (const [tbl, refs] of Object.entries(REFS)) {
      const t2 = tgtName(tbl);
      const rows = (await src.query(`SELECT * FROM ${q(tbl)} ORDER BY id`)).rows;
      srcData[tbl] = rows;
      const cols = rows.length ? Object.keys(rows[0]) : (await src.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [tbl])).rows.map((r) => r.column_name);
      const out = rows.map((r) => {
        const o = { ...r };
        for (const c of refs) o[c] = toSw(o[c]);
        if (JSON_COLS[tbl] && o[JSON_COLS[tbl]] !== null) o[JSON_COLS[tbl]] = JSON.stringify(rw(JSON.parse(o[JSON_COLS[tbl]]), toSw));
        return o;
      });
      const per = Math.max(1, Math.min(300, Math.floor(60000 / cols.length)));
      for (let i = 0; i < out.length; i += per) {
        const chunk = out.slice(i, i + per), params = [];
        const values = chunk.map((r) => '(' + cols.map((c) => { params.push(r[c]); return '$' + params.length; }).join(', ') + ')').join(',');
        await tgt.query(`INSERT INTO ${t2} (${cols.map(q).join(', ')}) VALUES ${values} ON CONFLICT (id) DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `${q(c)}=EXCLUDED.${q(c)}`).join(', ')}`, params);
      }
      const ids = rows.map((r) => Number(r.id));
      const del = ids.length ? await tgt.query(`DELETE FROM ${t2} WHERE id <> ALL($1::int[])`, [ids]) : await tgt.query(`DELETE FROM ${t2}`);
      await tgt.query(`SELECT setval(pg_get_serial_sequence('${t2}','id'), GREATEST((SELECT COALESCE(MAX(id),0) FROM ${t2}),1))`).catch(() => {});
      results.push({ tbl, t2, rows: rows.length, removed: del.rowCount, refs, jsonCol: JSON_COLS[tbl], cols });
    }

    // ---------------- 3. XonTel agent mapping: add what Swipr does not have yet ----------------
    const qm = (await src.query(`SELECT user_id, xontel_agent_id, xontel_agent_name, confirmed_by, updated_at FROM xontel_agent_map`)).rows;
    let xAdded = 0, xHave = 0, xRepointed = 0, xConflict = [];
    for (const r of qm) {
      const su = map.get(Number(r.user_id));
      if (!su) continue;   // QA user without a Swipr account (left the company / skipped)
      const has = await tgt.query(`SELECT 1 FROM xontel_agent_map WHERE user_id=$1`, [su]);
      if (has.rowCount) { xHave++; continue; }
      const same = await tgt.query(`SELECT m.user_id, EXISTS (SELECT 1 FROM users u WHERE u.id = m.user_id) AS alive FROM xontel_agent_map m WHERE m.xontel_agent_id=$1`, [String(r.xontel_agent_id)]);
      if (same.rowCount && same.rows[0].alive === 't') { xConflict.push(`${r.xontel_agent_name} (agent ${r.xontel_agent_id}) is mapped to a DIFFERENT live Swipr user`); continue; }
      if (same.rowCount) { await tgt.query(`UPDATE xontel_agent_map SET user_id=$1 WHERE xontel_agent_id=$2`, [su, String(r.xontel_agent_id)]); xRepointed++; continue; } // stale row of a deleted Swipr user
      await tgt.query(`INSERT INTO xontel_agent_map (user_id, xontel_agent_id, xontel_agent_name, confirmed_by, updated_at) VALUES ($1,$2,$3,$4,$5)`,
        [su, String(r.xontel_agent_id), r.xontel_agent_name, toSw(r.confirmed_by), new Date(r.updated_at.replace(' ', 'T') + 'Z').getTime()]);
      xAdded++;
    }
    await tgt.query('COMMIT');

    // ---------------- 4. independent verification (fresh reads, inverse mapping, every cell) ----------------
    console.log('\ntable'.padEnd(26), 'QA rows'.padStart(8), 'target'.padStart(8), 'removed'.padStart(8), ' verdict');
    let bad = 0;
    for (const r of results) {
      const trows = (await tgt.query(`SELECT * FROM ${r.t2} ORDER BY id`)).rows;
      let diffs = 0, cells = 0, example = '';
      const tById = new Map(trows.map((x) => [String(x.id), x]));
      for (const s of srcData[r.tbl]) {
        const t = tById.get(String(s.id));
        if (!t) { diffs++; continue; }
        for (const c of r.cols) {
          cells++;
          let a = s[c], b = t[c];
          if (r.refs.includes(c)) { a = a === null ? null : toSw(a); const okSet = a === null || String(a).startsWith('qa:') || inv.get(a)?.has(Number(s[c])); if (!okSet) b = '<<inverse mismatch>>'; }
          else if (c === r.jsonCol && a !== null) {
            const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;
            a = JSON.stringify(sortKeys(rw(JSON.parse(a), toSw))); b = JSON.stringify(sortKeys(JSON.parse(b)));
          }
          if (a !== b) { diffs++; if (!example) example = `${r.tbl} id=${s.id} col=${c}: ${String(a).slice(0, 50)} vs ${String(b).slice(0, 50)}`; }
        }
      }
      const ok = diffs === 0 && trows.length === r.rows;
      if (!ok) bad++;
      console.log(r.tbl.padEnd(25), String(r.rows).padStart(8), String(trows.length).padStart(8), String(r.removed).padStart(8), ' ' + (ok ? `OK (${cells} cells)` : 'FAIL ' + example));
    }
    console.log(`\nusers created in Swipr: ${created.length}  ${JSON.stringify(created.reduce((m, c) => ((m[c.role] = (m[c.role] || 0) + 1), m), {}))}`);
    console.log(`   they have NO employeeId (needed to match fingerprint attendance): ${created.map((c) => c.name).join(', ') || '-'}`);
    console.log(`references to QA users that no longer exist (kept as "qa:<id>"): ${orphans.size} ${[...orphans].slice(0, 10).join(',')}`);
    console.log(`xontel map: added ${xAdded}, re-pointed stale rows (their Swipr user was deleted) ${xRepointed}, already in Swipr ${xHave}, conflicts with a live user ${xConflict.length}`); xConflict.forEach((x) => console.log('   ! ' + x));
    console.log('also mirrored for the module: attendance_records, user_leaves, xontel_agent_map (until phase 4 switches to Swipr attendance). xontel_settings (credentials) is NOT copied');
    console.log(bad === 0 ? '\nIMPORT VERIFIED: every row and every cell round-trips back to the QA original' : `\n${bad} TABLE(S) FAILED VERIFICATION`);
    process.exitCode = bad === 0 ? 0 : 1;
  } catch (e) { await tgt.query('ROLLBACK').catch(() => {}); throw e; }
  await src.query('ROLLBACK'); await src.end(); await tgt.end();
})().catch((e) => { console.error('IMPORT FAILED:', e.message); process.exit(1); });
