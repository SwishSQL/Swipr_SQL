import {
  AppData,
  User,
  ScheduleDay,
  SwapRequest,
  SwapStatus,
  LeaveRequest,
  LeaveStatus,
  PublicHoliday,
  ShiftTemplate,
  AuditEntry,
  AppNotification,
  Evaluation,
  BreakEntry,
  TeamBreakStatus,
  BreakReportRow,
  BreakReport,
  BreakFreeze,
  ActiveBreak,
  AgentKpiReport,
  AdherenceReport,
  KpiTargets,
  MissedReport,
  ReportConfig,
  CallsReport,
  CallsGroup,
  SickDocument,
  SickDocsAdminView,
  AttendanceRecord,
  TeamAttendanceRow,
  LatenessReport,
  LatenessAction,
  XontelAgent,
  XontelMapRow,
  XontelDay,
  CallLogEntry,
  DirectoryContact,
} from './types';

const API = '/api';
const POLL_INTERVAL = 5000;
const TOKEN_KEY = 'swipr_token';

// Credentials live in localStorage, not sessionStorage: sessionStorage is
// wiped the moment the tab (or the phone's browser app) closes, which logged
// people out every time they backgrounded the app. The token itself is valid
// for 7 days server-side.
//
// The token is mirrored into a cookie as well. localStorage is not always
// available or durable on a phone — a home-screen web app can be given its own
// storage bucket, and browsers evict script-writable storage — and every access
// here is wrapped in a try/catch, so a failure signed people out silently with
// nothing to show for it. The cookie survives cases the mirror does not, and
// vice versa; whichever still holds the token restores the session. It is
// readable by script either way, so this is no weaker than localStorage alone.
const TOKEN_MAX_AGE = 7 * 24 * 60 * 60; // matches the server's 7d JWT

function readTokenCookie(): string | null {
  try {
    const hit = document.cookie.split('; ').find((c) => c.startsWith(TOKEN_KEY + '='));
    return hit ? decodeURIComponent(hit.slice(TOKEN_KEY.length + 1)) : null;
  } catch { return null; }
}

function writeTokenCookie(token: string | null) {
  try {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = token
      ? `${TOKEN_KEY}=${encodeURIComponent(token)}; path=/; max-age=${TOKEN_MAX_AGE}; SameSite=Lax${secure}`
      : `${TOKEN_KEY}=; path=/; max-age=0; SameSite=Lax${secure}`;
  } catch { /* cookies unavailable — localStorage may still hold it */ }
}

let authToken: string | null = (() => {
  try {
    // Carry over anyone still holding a session-scoped token from before.
    const legacy = sessionStorage.getItem(TOKEN_KEY);
    if (legacy) {
      localStorage.setItem(TOKEN_KEY, legacy);
      sessionStorage.removeItem(TOKEN_KEY);
    }
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored) return stored;
  } catch { /* fall through to the cookie */ }
  return readTokenCookie();
})();

export function setToken(token: string | null) {
  authToken = token;
  writeTokenCookie(token);
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
}

async function http<T = any>(method: string, path: string, body?: any): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const res = await fetch(API + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Session expired or missing — drop credentials and return to login.
  if (res.status === 401) {
    // An admin deactivated the account: say so on the login page.
    const why = await res.clone().json().catch(() => null);
    if (why?.disabled) { try { sessionStorage.setItem('swipr_logout_reason', 'disabled'); } catch { /* ignore */ } }
    setToken(null);
    try { localStorage.removeItem('swipr_auth'); } catch { /* ignore */ }
    if (!location.hash.startsWith('#/login')) {
      location.hash = '#/login';
      location.reload();
    }
    throw new Error('Session expired');
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${path} ${txt}`);
  }
  if (res.status === 204) return null as unknown as T;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : (null as unknown as T);
}

// Emulates Firestore's onSnapshot via polling. Returns an unsubscribe function.
//
// Skips ticks while the tab is hidden/backgrounded. Every page keeps at
// least one of these running the whole time it's open (notifications, sidebar
// badges), so a staff member who leaves the app open in a background tab all
// day was polling it just as hard as someone actively watching it — a large,
// silent share of server load and egress that nobody was actually looking at.
function poll<T>(fetcher: () => Promise<T>, callback: (data: T) => void): () => void {
  let active = true;
  const tick = async () => {
    if (!active) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      const data = await fetcher();
      if (active) callback(data);
    } catch (err) {
      console.error('[store] poll error', err);
    }
  };
  tick();
  const id = setInterval(tick, POLL_INTERVAL);
  // Catch back up immediately when the tab regains focus, instead of waiting
  // out the rest of the current interval with stale data.
  const onVisible = () => { if (!document.hidden) tick(); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  return () => {
    active = false;
    clearInterval(id);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
  };
}

export class Store {
  // ---- Live subscriptions (polling) ---------------------------------------
  // `all` requests the read-only global view (honoured server-side for
  // supervisors and admins only).
  subscribeToUsers(callback: (users: User[]) => void, opts?: { all?: boolean }) {
    return poll(() => this.getUsers(opts?.all), callback);
  }

  subscribeToSwaps(callback: (swaps: SwapRequest[]) => void) {
    return poll(() => this.getSwapRequests(), callback);
  }

  subscribeToSchedules(callback: (schedules: Record<string, Record<string, ScheduleDay>>) => void, opts?: { all?: boolean }) {
    return poll(() => http('GET', opts?.all ? '/schedules?all=1' : '/schedules'), callback);
  }

  subscribeToLeaveRequests(callback: (leaves: LeaveRequest[]) => void) {
    return poll(() => http('GET', '/leaves'), callback);
  }

  subscribeToPublicHolidays(callback: (holidays: PublicHoliday[]) => void) {
    return poll(() => http('GET', '/holidays'), callback);
  }

  // ---- Aggregate ----------------------------------------------------------
  async getCurrentAppData(): Promise<AppData> {
    return http('GET', '/app-data');
  }

  // ---- Users --------------------------------------------------------------
  async getUsers(all = false): Promise<User[]> {
    return http('GET', all ? '/users?all=1' : '/users');
  }

  // ---- Branch directory (Branch Schedule page) -----------------------------
  // Company-wide across every brand/branch, visible to any authenticated user.
  subscribeToBranchDirectory(callback: (users: User[]) => void) {
    return poll(() => this.getBranchDirectory(), callback);
  }

  async getBranchDirectory(): Promise<User[]> {
    return http('GET', '/branch-directory');
  }

  subscribeToBranchSchedules(callback: (schedules: Record<string, Record<string, ScheduleDay>>) => void) {
    return poll(() => http('GET', '/branch-schedules'), callback);
  }

  async addUser(user: User) {
    await http('POST', '/users', user);
  }

  async updateUser(user: User) {
    await http('PUT', `/users/${user.id}`, user);
  }

  async deleteUser(userId: string) {
    await http('DELETE', `/users/${userId}`);
  }

  async login(username: string, password: string): Promise<User | null> {
    const res = await http<{ user: User | null; token?: string; disabled?: boolean }>('POST', '/login', { username, password });
    if (res?.disabled) throw new Error('ACCOUNT_DISABLED');
    if (res?.user && res.token) setToken(res.token);
    return res?.user || null;
  }

  logout() {
    setToken(null);
  }

  async getSetupStatus(): Promise<boolean> {
    const res = await http<{ needsSetup: boolean }>('GET', '/setup-status');
    return !!res?.needsSetup;
  }

  async bootstrapSupervisor(user: Partial<User>): Promise<User | null> {
    const res = await http<{ user: User | null; token?: string }>('POST', '/bootstrap-supervisor', user);
    if (res?.user && res.token) setToken(res.token);
    return res?.user || null;
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<boolean> {
    try {
      const res = await http<{ success: boolean }>('POST', '/change-password', { currentPassword, newPassword });
      return !!res?.success;
    } catch {
      return false;
    }
  }

  async copyWeek(fromStart: string, toStart: string, userIds: string[]): Promise<number> {
    const res = await http<{ copied: number }>('POST', '/schedules/copy-week', { fromStart, toStart, userIds });
    return res?.copied || 0;
  }

  async parseSchedule(text: string, weekStart: string): Promise<{
    employeeId: string;
    employeeName: string;
    note?: string;
    days: { date: string; type: string; startTime?: string | null; endTime?: string | null }[];
  }> {
    return http('POST', '/schedule/parse', { text, weekStart });
  }

  // ---- Shift templates ----------------------------------------------------
  subscribeToTemplates(callback: (templates: ShiftTemplate[]) => void) {
    return poll(() => this.getTemplates(), callback);
  }

  async getTemplates(): Promise<ShiftTemplate[]> {
    return http('GET', '/templates');
  }

  async addTemplate(tpl: ShiftTemplate) {
    await http('POST', '/templates', tpl);
  }

  async deleteTemplate(id: string) {
    await http('DELETE', `/templates/${id}`);
  }

  // ---- Audit log (supervisor only) ----------------------------------------
  subscribeToAuditLog(callback: (entries: AuditEntry[]) => void, limit?: number) {
    return poll(() => this.getAuditLog(limit), callback);
  }

  async getAuditLog(limit = 500): Promise<AuditEntry[]> {
    return http('GET', `/audit?limit=${limit}`);
  }

  // ---- Notifications ------------------------------------------------------
  subscribeToNotifications(callback: (data: { items: AppNotification[]; unread: number }) => void) {
    return poll(() => this.getNotifications(), callback);
  }

  async getNotifications(): Promise<{ items: AppNotification[]; unread: number }> {
    return http('GET', '/notifications');
  }

  async markNotificationsRead(ids?: string[]) {
    await http('POST', '/notifications/read', ids ? { ids } : {});
  }

  // ---- Swap requests ------------------------------------------------------
  async getSwapRequests(): Promise<SwapRequest[]> {
    return http('GET', '/swaps');
  }

  async addSwapRequest(req: SwapRequest) {
    await http('POST', '/swaps', req);
  }

  async updateSwapRequest(id: string, status: SwapStatus) {
    await http('PUT', `/swaps/${id}`, { status });
  }

  // ---- Schedules ----------------------------------------------------------
  async getSchedule(userId: string): Promise<Record<string, ScheduleDay>> {
    return http('GET', `/schedules/${userId}`);
  }

  async updateDay(userId: string, date: string, dayData: any) {
    await http('PUT', `/schedules/${userId}/day`, { date, data: dayData });
  }

  async updateBatchDays(userId: string, batch: Record<string, ScheduleDay>) {
    await http('POST', `/schedules/${userId}/batch`, { batch });
  }

  async clearBatchDays(userId: string, dates: string[]) {
    await http('POST', `/schedules/${userId}/clear`, { dates });
  }

  // ---- Leave requests -----------------------------------------------------
  async addLeaveRequest(req: LeaveRequest) {
    await http('POST', '/leaves', req);
  }

  async updateLeaveRequestStatus(id: string, status: LeaveStatus): Promise<boolean> {
    try {
      const res = await http<{ success: boolean }>('PUT', `/leaves/${id}`, { status });
      return !!res?.success;
    } catch (err) {
      console.error('Update status error:', err);
      return false;
    }
  }

  // ---- Employee of the Month evaluations -----------------------------------
  async getEvaluations(userId: string): Promise<Evaluation[]> {
    return http('GET', `/evaluations/${userId}`);
  }

  async createEvaluation(payload: { employeeId: string; scores: Record<string, number>; approvedByName?: string }): Promise<Evaluation> {
    return http('POST', '/evaluations', payload);
  }

  async deleteEvaluation(id: string) {
    await http('DELETE', `/evaluations/${id}`);
  }

  // ---- Live breaks ----------------------------------------------------------
  subscribeToMyBreaks(callback: (data: { active: BreakEntry | null; history: BreakEntry[]; freeze: BreakFreeze | null }) => void) {
    return poll(() => this.getMyBreaks(), callback);
  }

  async getMyBreaks(): Promise<{ active: BreakEntry | null; history: BreakEntry[]; freeze: BreakFreeze | null }> {
    return http('GET', '/breaks/me');
  }

  async startBreak(): Promise<BreakEntry> {
    return http('POST', '/breaks/start');
  }

  async endBreak(): Promise<BreakEntry> {
    return http('POST', '/breaks/end');
  }

  subscribeToTeamBreaks(callback: (rows: TeamBreakStatus[]) => void) {
    return poll(() => this.getTeamBreaks(), callback);
  }

  async getTeamBreaks(): Promise<TeamBreakStatus[]> {
    return http('GET', '/breaks/team');
  }

  async endBreakFor(userId: string): Promise<BreakEntry> {
    return http('POST', `/breaks/end-for/${userId}`);
  }

  // Who in the viewer's own department/branch is on a break right now.
  async getActiveBreaks(): Promise<ActiveBreak[]> {
    return http('GET', '/breaks/now');
  }

  async getBreaksReport(from: string, to: string): Promise<BreakReport> {
    return http('GET', `/breaks/report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  }

  // A manager's pause on Start Break across their own scope.
  subscribeToBreakFreeze(callback: (freeze: BreakFreeze | null) => void) {
    return poll(() => this.getBreakFreeze(), callback);
  }

  async getBreakFreeze(): Promise<BreakFreeze | null> {
    return http('GET', '/breaks/freeze');
  }

  async freezeBreaks(minutes: number, reason?: string): Promise<BreakFreeze> {
    return http('POST', '/breaks/freeze', { minutes, reason });
  }

  async cancelBreakFreeze(): Promise<void> {
    await http('POST', '/breaks/freeze/cancel');
  }

  // ---- Attendance (QR clock-in/out) -------------------------------------------
  // `scope: 'callcentre'` is only meaningful for an admin (every other viewer's
  // scope is implied by their own role); brand/branch likewise only apply to
  // an admin displaying a specific branch screen.
  async getKioskCode(opts?: { brand?: string; branch?: string; scope?: 'callcentre' }): Promise<{ qrDataUri: string; expiresInSeconds: number; refreshInSeconds: number; brand: string; branch: string; scope: 'BRANCH' | 'CALLCENTRE'; label: string }> {
    const params = new URLSearchParams();
    if (opts?.brand) params.set('brand', opts.brand);
    if (opts?.branch) params.set('branch', opts.branch);
    if (opts?.scope) params.set('scope', opts.scope);
    const qs = params.toString();
    return http('GET', `/attendance/kiosk-code${qs ? `?${qs}` : ''}`);
  }

  async scanAttendance(code: string): Promise<{ kind: 'IN' | 'OUT'; ts: number; brand: string; branch: string; unit: string; name: string }> {
    return http('POST', '/attendance/scan', { code });
  }

  subscribeToMyAttendance(callback: (rows: AttendanceRecord[]) => void) {
    return poll(() => this.getMyAttendance(), callback);
  }

  async getMyAttendance(): Promise<AttendanceRecord[]> {
    return http('GET', '/attendance/me');
  }

  subscribeToTeamAttendance(callback: (rows: TeamAttendanceRow[]) => void, date?: string) {
    return poll(() => this.getTeamAttendance(date), callback);
  }

  // Admin only — corrects or removes a specific punch. See PUT/DELETE
  // /attendance/:id for why a corrected terminal punch changes id.
  async editAttendance(id: string, ts: number, kind: 'IN' | 'OUT'): Promise<{ id: string; userId: string; kind: 'IN' | 'OUT'; ts: number }> {
    return http('PUT', `/attendance/${encodeURIComponent(id)}`, { ts, kind });
  }

  async deleteAttendance(id: string): Promise<void> {
    await http('DELETE', `/attendance/${encodeURIComponent(id)}`);
  }

  async getTeamAttendance(date?: string): Promise<TeamAttendanceRow[]> {
    return http('GET', date ? `/attendance/team?date=${date}` : '/attendance/team');
  }

  // ---- Lateness (admin only) -------------------------------------------------
  // The server derives these from the terminal against the roster; they are
  // suggestions until someone confirms one.
  async getLateness(from: string, to: string, status?: string): Promise<LatenessReport> {
    const q = new URLSearchParams({ from, to });
    if (status) q.set('status', status);
    return http('GET', `/attendance/lateness?${q.toString()}`);
  }

  async reviewLateness(userId: string, date: string, action: LatenessAction, minutes?: number): Promise<void> {
    await http('POST', '/attendance/lateness/review', { userId, date, action, minutes });
  }

  async recomputeLateness(from: string, to: string): Promise<{ rows: number; people: number }> {
    return http('POST', '/attendance/lateness/recompute', { from, to });
  }

  // ---- XonTel link (admin only) ----------------------------------------------
  async getXontelAgentMap(): Promise<{ agents: XontelAgent[]; rows: XontelMapRow[] }> {
    return http('GET', '/xontel/agent-map');
  }

  async setXontelAgent(userId: string, agent: XontelAgent | null): Promise<void> {
    await http('PUT', '/xontel/agent-map', {
      userId, xontelAgentId: agent?.id ?? null, xontelAgentName: agent?.name ?? null,
    });
  }

  async syncXontel(from: string, to: string): Promise<{ received: number; stored: number }> {
    return http('POST', '/xontel/sync', { from, to });
  }

  // One person's XonTel sessions for one attendance day.
  async getXontelDay(userId: string, date: string): Promise<XontelDay> {
    return http('GET', `/xontel/day?userId=${encodeURIComponent(userId)}&date=${date}`);
  }

  // ---- Profile photo (self-service) ------------------------------------------
  async updateMyPhoto(photoUrl: string): Promise<User> {
    return http('POST', '/profile/photo', { photoUrl });
  }

  async removeMyPhoto(): Promise<User> {
    return http('DELETE', '/profile/photo');
  }

  // ---- Overtime -------------------------------------------------------------
  async getOvertimeReport(month?: string): Promise<{ month: string; rows: { id: string; name: string; employeeCode: string; brand: string; branch: string; totalHours: number; days: { date: string; hours: number }[] }[] }> {
    return http('GET', month ? `/overtime/report?month=${month}` : '/overtime/report');
  }

  // True when a token survived, so the app can tell "never logged in" apart
  // from "logged in, but the cached profile is gone".
  hasToken(): boolean {
    return !!authToken;
  }

  async getMe(): Promise<User | null> {
    try {
      return await http<User>('GET', '/me');
    } catch {
      return null;
    }
  }

  // ---- In-system voice calls --------------------------------------------------
  // Fetched once per page visit rather than polled — a staff list barely
  // changes, and polling it would add traffic for no benefit.
  async getStaffDirectory(): Promise<DirectoryContact[]> {
    return http<DirectoryContact[]>('GET', '/staff-directory');
  }

  async getIceServers(): Promise<RTCIceServer[]> {
    const res = await http<{ iceServers: RTCIceServer[] }>('GET', '/calls/ice-servers');
    return res?.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }];
  }

  // Audio goes up as a raw body rather than JSON — base64 in JSON would inflate
  // every recording by a third for no benefit.
  async uploadCallRecording(callId: string, blob: Blob): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': blob.type || 'audio/webm' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    await fetch(`${API}/calls/${encodeURIComponent(callId)}/recording`, {
      method: 'POST', headers, body: blob,
    });
  }

  async getCallLog(limit = 500): Promise<CallLogEntry[]> {
    return http<CallLogEntry[]>('GET', `/calls/log?limit=${limit}`);
  }

  subscribeToCallLog(callback: (entries: CallLogEntry[]) => void, limit = 500) {
    return poll(() => this.getCallLog(limit), callback);
  }

  // Playback needs the auth header, so the audio is fetched as a blob and
  // handed to the <audio> element as an object URL rather than a plain src.
  async getCallRecordingUrl(callId: string): Promise<string> {
    const headers: Record<string, string> = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const res = await fetch(`${API}/calls/${encodeURIComponent(callId)}/recording`, { headers });
    if (!res.ok) throw new Error('Recording unavailable');
    return URL.createObjectURL(await res.blob());
  }

  async deleteCallRecording(callId: string): Promise<void> {
    await http('DELETE', `/calls/${encodeURIComponent(callId)}/recording`);
  }

  // Per-agent call-centre KPIs over a range of days (from XonTel data).
  async getAgentKpis(from: string, to: string): Promise<AgentKpiReport> {
    return http('GET', `/agent-kpis?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  }

  async getAdherence(from: string, to: string): Promise<AdherenceReport> {
    return http('GET', `/agent-kpis/adherence?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  }

  async getKpiTargets(): Promise<KpiTargets> {
    return http('GET', '/agent-kpis/targets');
  }

  async saveKpiTargets(t: Partial<KpiTargets>): Promise<KpiTargets> {
    return http('PUT', '/agent-kpis/targets', t);
  }

  async getCallsReport(from: string, to: string, group: CallsGroup, brand = '', issue = '', aggregator = ''): Promise<CallsReport> {
    const q = new URLSearchParams({ from, to, group, brand, issue, aggregator });
    return http('GET', `/agent-kpis/calls-report?${q}`);
  }

  async getReportConfig(): Promise<ReportConfig> {
    return http('GET', '/agent-kpis/report-config');
  }

  async saveReportConfig(c: Pick<ReportConfig, 'aggregators' | 'queues' | 'statuses'>): Promise<void> {
    await http('PUT', '/agent-kpis/report-config', c);
  }

  async getMissedCalls(from: string, to: string): Promise<MissedReport> {
    return http('GET', `/agent-kpis/missed?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  }

  // ---- Sick-leave medical documents ---------------------------------------
  // Raw-body upload like call recordings; the day, name and note go in the
  // query string. Returns the server's error text when it refuses.
  async uploadSickDoc(file: Blob, date: string, name: string, note: string): Promise<SickDocument> {
    const headers: Record<string, string> = { 'Content-Type': file.type || 'application/octet-stream' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const q = new URLSearchParams({ date, name, note }).toString();
    const res = await fetch(`${API}/sick-docs?${q}`, { method: 'POST', headers, body: file });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error || (res.status === 413 ? 'That file is too large (8 MB max).' : `Upload failed (${res.status})`));
    return body;
  }

  async getMySickDocs(): Promise<{ docs: SickDocument[]; sickDays: string[] }> {
    return http('GET', '/sick-docs/mine');
  }

  async getSickDocsAdmin(from: string, to: string): Promise<SickDocsAdminView> {
    return http('GET', `/sick-docs?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  }

  // Opening needs the auth header, so the file comes down as a blob and is
  // handed to a new tab as an object URL.
  async openSickDoc(id: string): Promise<void> {
    const tab = window.open('', '_blank');
    const headers: Record<string, string> = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const res = await fetch(`${API}/sick-docs/${encodeURIComponent(id)}/file`, { headers });
    if (!res.ok) { tab?.close(); throw new Error('Could not open that document.'); }
    const url = URL.createObjectURL(await res.blob());
    if (tab) tab.location.href = url; else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async deleteSickDoc(id: string): Promise<void> {
    await http('DELETE', `/sick-docs/${encodeURIComponent(id)}`);
  }

  // ---- Web push notifications ----------------------------------------------
  async getVapidPublicKey(): Promise<string | null> {
    const res = await http<{ key: string | null }>('GET', '/push/vapid-public-key');
    return res?.key || null;
  }

  async subscribePush(subscription: PushSubscriptionJSON) {
    await http('POST', '/push/subscribe', subscription);
  }

  async unsubscribePush(endpoint: string) {
    await http('POST', '/push/unsubscribe', { endpoint });
  }

  // ---- Native push (Android app only) ---------------------------------------
  // A separate channel from web push: an FCM token isn't a PushSubscriptionJSON
  // and is delivered through Google's infrastructure rather than the browser's,
  // so the server tracks it in its own table and sends to it differently.
  async registerFcmToken(token: string) {
    await http('POST', '/push/fcm-token', { token });
  }

  // ---- Public holidays ----------------------------------------------------
  async addPublicHoliday(holiday: PublicHoliday) {
    await http('POST', '/holidays', holiday);
  }

  async deletePublicHoliday(id: string) {
    await http('DELETE', `/holidays/${id}`);
  }
}

export const store = new Store();
