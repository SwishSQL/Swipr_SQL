/**
 * QA (call quality) module for Swipr. Mounted by server.js at /api/qa.
 *
 *   authenticate   Swipr's own Bearer-token check (passed in, so the rules are identical to the rest of Swipr)
 *   qaIdentity     the signed-in Swipr person must have a QA profile (qa_user_profile) or gets 403
 *   routes         the original QA routes (generated into qa-module.ts from the QA server), unchanged in behaviour
 *
 * The old QA server had NO authentication at all: every route trusted whatever user_id / role the browser sent.
 * Here a valid Swipr login is required, and user_id / role are overwritten with the authenticated person's own
 * values, so they can no longer be forged.
 */
import express from 'express';
import { createQaDb } from './db';
import { buildQaRoutes } from './qa-module';

export interface QaModuleOptions {
  /** Swipr's data layer (db.js `pool`): the module runs on the same SQL Server connection pool. */
  pool: any;
  /** Swipr's `authenticate` middleware (sets req.user from the Bearer token). */
  authenticate: express.RequestHandler;
}

export async function createQaModule(opts: QaModuleOptions): Promise<express.Router> {
  const db = createQaDb({ pool: opts.pool });
  const router = express.Router();

  // QA evaluations carry attached images (base64 when Cloudinary is off): same 20mb allowance the QA server had.
  router.use(express.json({ limit: '20mb' }));
  // <audio src> cannot send an Authorization header, so recording streams may pass the token in the URL.
  router.use((req: any, _res, next) => {
    if (!req.headers.authorization && req.method === 'GET' && req.path === '/xontel/stream' && typeof req.query.access_token === 'string') {
      req.headers.authorization = 'Bearer ' + req.query.access_token;
    }
    next();
  });
  router.use(opts.authenticate);

  const qaIdentity: express.RequestHandler = async (req: any, res, next) => {
    try {
      const me = await db.prepare(
        'SELECT id, display_name, username, role, department, tl_id, status, allowed_departments, allowed_brands, cc_supervisor_id FROM users WHERE id = ?',
      ).get(String(req.user?.id));
      if (!me) return res.status(403).json({ error: 'You do not have access to the Quality module.' });
      if (me.status && me.status !== 'active') return res.status(403).json({ error: 'Your Quality account is not active.' });
      req.qaUser = me;
      // The QA routes read the caller from these. Overwrite whatever the browser sent.
      req.headers['x-user-id'] = String(me.id);
      req.query.user_id = String(me.id);
      req.query.role = me.role;
      if (req.body && typeof req.body === 'object' && 'user_id' in req.body) req.body.user_id = String(me.id);
      next();
    } catch (e: any) {
      console.error('[qa] identity lookup failed:', e?.message || e);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  };
  router.use(qaIdentity);

  // ---- Role guards: the QA server trusted the browser for all of this; here the role comes from the profile. ----
  const S = ['supervisor'], SC = ['supervisor', 'cc_supervisor'];
  const RULES: Array<[string, RegExp, string[]]> = [
    ['POST', /^\/settings\/form\/?$/, S], ['DELETE', /^\/settings\/form\//, S], ['POST', /^\/forms\/?$/, S],
    ['PUT', /^\/kpi\/config\//, SC], ['PUT', /^\/kpi\/qa\/[^/]+\/day-override\/?$/, SC],
    ['POST', /^\/xontel\//, S],
    ['POST', /^\/audit-logs\/clear\/?$/, S], ['DELETE', /^\/audit-logs\//, S],
    ['POST', /^\/evaluations\/?$/, ['qa', 'supervisor']], ['PUT', /^\/evaluations\/[^/]+\/?$/, ['qa', 'supervisor']],
    ['POST', /^\/evaluations\/[^/]+\/tl-action\/?$/, ['tl', 'supervisor']], ['POST', /^\/evaluations\/[^/]+\/qa-action\/?$/, ['qa', 'supervisor']],
    ['POST', /^\/evaluations\/[^/]+\/wow\/?$/, ['qa', 'supervisor', 'cc_supervisor', 'tl']],
    ['POST', /^\/coaching(-requests)?\/?$/, ['tl', 'supervisor']],
    ['POST', /^\/accuracy-cases\/?$/, ['qa', 'tl', 'supervisor']], ['PUT', /^\/accuracy-cases\//, ['qa', 'tl', 'supervisor']], ['DELETE', /^\/accuracy-cases\//, ['qa', 'tl', 'supervisor']],
    ['POST', /^\/leaves\/?$/, ['supervisor', 'cc_supervisor', 'tl']], ['DELETE', /^\/leaves\//, ['supervisor', 'cc_supervisor', 'tl']],
    ['POST', /^\/cc\/notes\//, SC],
  ];
  const COMPLIANCE_OK = /^\/(me|compliance\/|notifications|sessions\/|attendance\/)/;
  router.use((req: any, res, next) => {
    const me = req.qaUser;
    if (me.role === 'compliance' && !COMPLIANCE_OK.test(req.path)) return res.status(403).json({ error: 'Not allowed for your role.' });
    for (const [m, re, roles] of RULES) {
      if (req.method === m && re.test(req.path) && !roles.includes(me.role)) return res.status(403).json({ error: 'Not allowed for your role.' });
    }
    // Actor fields always mean "me" — never trust what the browser says about who is acting.
    const b = req.body && typeof req.body === 'object' ? req.body : null;
    if (b) {
      if ('role' in b && /\/escalation-respond\/?$/.test(req.path)) b.role = me.role;
      if (!req.path.startsWith('/access')) for (const k of ['editor_id', 'owner_id', 'set_by_user_id', 'approved_by']) if (k in b) b[k] = String(me.id);
      if (me.role === 'tl' && 'tl_id' in b && !req.path.startsWith('/access')) b.tl_id = String(me.id);
      if (me.role === 'qa' && req.path === '/evaluations' && req.method === 'POST') { b.qa_id = String(me.id); if (b.data && typeof b.data === 'object') b.data.evaluator_id = String(me.id); }
    }
    if ('owner_id' in req.query) req.query.owner_id = String(me.id);
    if ('viewer_role' in req.query) req.query.viewer_role = me.role;
    next();
  });

  const parse = (v: any) => {
    if (Array.isArray(v)) return v;
    try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch { return []; }
  };
  // ---- Quality access: who can use the Quality module and in what role (supervisors only). Replaces QA's User Management. ----
  const ROLES = ['supervisor', 'cc_supervisor', 'qa', 'tl', 'agent', 'compliance'];
  const asArr = (v: any): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  const auditAccess = (req: any, details: string) =>
    db.pool.query(
      'INSERT INTO qa_audit_logs (user_id, user_name, action_type, section, details, ip_address, status) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [String(req.qaUser.id), req.qaUser.display_name, 'UPDATE', 'Users', details, req.ip, 'success'],
    ).catch(() => {});
  router.use('/access', (req: any, res, next) => (req.qaUser.role === 'supervisor' ? next() : res.status(403).json({ error: 'Not allowed for your role.' })));
  router.get('/access', async (_req, res) => {
    try {
      const r = await db.pool.query(
        `SELECT u.id, u.data->>'name' AS name, u.data->>'username' AS username, u.data->>'companyName' AS company, u.data->>'jobTitle' AS job_title,
                p.qa_role, p.qa_status, p.qa_department, p.tl_user_id, p.cc_supervisor_user_id, p.allowed_departments, p.allowed_brands
         FROM users u LEFT JOIN qa_user_profile p ON p.user_id = u.id
         WHERE COALESCE(u.data->>'status','active') <> 'deleted'
         ORDER BY CASE WHEN p.user_id IS NULL THEN 1 ELSE 0 END, u.data->>'name'`,
      );
      res.json(r.rows.map((x: any) => ({ ...x, allowed_departments: parse(x.allowed_departments), allowed_brands: parse(x.allowed_brands) })));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  router.put('/access/:userId', async (req: any, res) => {
    try {
      const { role, status, department, tl_id, cc_supervisor_id } = req.body || {};
      const depts = asArr(req.body?.allowed_departments), brands = asArr(req.body?.allowed_brands);
      if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
      if (role === 'tl' && brands.length === 0) return res.status(400).json({ error: 'Team Leader users must have at least one assigned brand.' });
      if (role === 'qa' && (brands.length === 0 || depts.length === 0)) return res.status(400).json({ error: 'QA users must have at least one allowed department AND one allowed brand.' });
      const st = status === 'inactive' ? 'inactive' : 'active';
      if (String(req.params.userId) === String(req.qaUser.id) && (role !== 'supervisor' || st !== 'active')) {
        return res.status(400).json({ error: 'You cannot remove your own supervisor access.' });
      }
      const exists = await db.pool.query('SELECT 1 FROM users WHERE id = $1', [req.params.userId]);
      if (!exists.rowCount) return res.status(404).json({ error: 'Swipr user not found.' });
      for (const ref of [tl_id, cc_supervisor_id]) {
        if (ref) { const ok = await db.pool.query('SELECT 1 FROM qa_user_profile WHERE user_id = $1', [String(ref)]); if (!ok.rowCount) return res.status(400).json({ error: 'The chosen team leader / supervisor has no Quality access.' }); }
      }
      await db.pool.query(
        `INSERT INTO qa_user_profile (user_id, qa_role, qa_status, qa_department, tl_user_id, cc_supervisor_user_id, allowed_departments, allowed_brands)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (user_id) DO UPDATE SET qa_role=EXCLUDED.qa_role, qa_status=EXCLUDED.qa_status, qa_department=EXCLUDED.qa_department,
           tl_user_id=EXCLUDED.tl_user_id, cc_supervisor_user_id=EXCLUDED.cc_supervisor_user_id, allowed_departments=EXCLUDED.allowed_departments, allowed_brands=EXCLUDED.allowed_brands`,
        [req.params.userId, role, st, department || 'Swish', tl_id ? String(tl_id) : null, cc_supervisor_id ? String(cc_supervisor_id) : null, JSON.stringify(depts), JSON.stringify(brands)],
      );
      await auditAccess(req, `Set Quality access for user ${req.params.userId}: role=${role}, status=${st}`);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  router.delete('/access/:userId', async (req: any, res) => {
    try {
      if (String(req.params.userId) === String(req.qaUser.id)) return res.status(400).json({ error: 'You cannot remove your own access.' });
      const r = await db.pool.query('DELETE FROM qa_user_profile WHERE user_id = $1', [req.params.userId]);
      await auditAccess(req, `Removed Quality access for user ${req.params.userId}`);
      res.json({ success: true, removed: r.rowCount });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Replaces QA's POST /login response: tells the browser who it is inside the Quality module.
  router.get('/me', (req: any, res) => {
    const u = req.qaUser;
    res.json({ ...u, allowed_departments: parse(u.allowed_departments), allowed_brands: parse(u.allowed_brands) });
  });

  // Replaces the session row QA's login used to open (feeds the online-duration KPI).
  router.post('/sessions/start', async (req: any, res) => {
    try {
      const r = await db.prepare('INSERT INTO user_sessions (user_id, login_at, last_seen_at) VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)').run(String(req.qaUser.id));
      res.json({ session_id: r.lastInsertRowid });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  const routes: any = await buildQaRoutes(db);
  // The QA routes were written for a process of their own: a rejected promise in one handler would crash the whole
  // server. Inside Swipr that would take every other module down too, so turn it into a 500 for that one request.
  for (const layer of routes.stack) {
    if (!layer.route) continue;
    for (const rl of layer.route.stack) {
      const h = rl.handle;
      if (h.length >= 4) continue;
      rl.handle = (req: any, res: any, next: any) => {
        const fail = (e: any) => {
          console.error('[qa] unhandled error in', req.method, req.path, '-', e?.message || e);
          if (!res.headersSent) res.status(500).json({ error: 'Internal Server Error' });
        };
        try { const p = h(req, res, next); if (p && typeof p.catch === 'function') p.catch(fail); } catch (e) { fail(e); }
      };
    }
  }
  router.use(routes);
  return router;
}
