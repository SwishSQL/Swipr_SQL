
export enum UserRole {
  ADMIN = 'ADMIN',
  SUPERVISOR = 'SUPERVISOR',
  MANAGER = 'MANAGER',
  EMPLOYEE = 'EMPLOYEE',
  // Field-operations hierarchy (brand/branch based, department-free)
  BRANCH_EMPLOYEE = 'BRANCH_EMPLOYEE',
  BRANCH_MANAGER = 'BRANCH_MANAGER',
  AREA_MANAGER = 'AREA_MANAGER',
  OPERATION_MANAGER = 'OPERATION_MANAGER'
}

// Roles that belong to the brand/branch hierarchy.
export const BRANCH_ROLES: UserRole[] = [
  UserRole.BRANCH_EMPLOYEE,
  UserRole.BRANCH_MANAGER,
  UserRole.AREA_MANAGER,
  UserRole.OPERATION_MANAGER,
];

export const isBranchRole = (r?: UserRole): boolean => !!r && BRANCH_ROLES.includes(r);

// Display names for roles.
export const ROLE_LABELS: Partial<Record<UserRole, string>> = {
  [UserRole.MANAGER]: 'Team Leader',
  [UserRole.BRANCH_EMPLOYEE]: 'Branch Employee',
  [UserRole.BRANCH_MANAGER]: 'Branch Manager',
  [UserRole.AREA_MANAGER]: 'Area Manager',
  [UserRole.OPERATION_MANAGER]: 'Operation Manager',
};

export const roleLabel = (r?: UserRole): string => (r && ROLE_LABELS[r]) || String(r || '');

export enum DayType {
  NORMAL_SHIFT = 'NORMAL_SHIFT',
  WORK_FROM_HOME = 'WORK_FROM_HOME',
  DAY_OFF = 'DAY_OFF',
  ABSENT = 'ABSENT',
  PUBLIC_HOLIDAY = 'PUBLIC_HOLIDAY',
  ANNUAL_LEAVE = 'ANNUAL_LEAVE',
  TARDY = 'TARDY',
  EARLY_LEAVE = 'EARLY_LEAVE',
  TASK = 'TASK',
  SICK = 'SICK',
  TRAINING = 'TRAINING',
  DELAY_WAS_PERMISSION = 'DELAY_WAS_PERMISSION',
  OFF_SET = 'OFF_SET',
  CANCEL_OFF = 'CANCEL_OFF'
}

// Display names for day types. Stored enum values never change — these
// are UI labels only.
export const DAY_TYPE_LABELS: Partial<Record<DayType, string>> = {
  [DayType.TARDY]: 'Late',
  [DayType.EARLY_LEAVE]: 'Leave with Permission',
  [DayType.DELAY_WAS_PERMISSION]: 'Late with Permission',
  [DayType.CANCEL_OFF]: 'Cancel Off',
};

export const dayTypeLabel = (t?: string): string =>
  (t && DAY_TYPE_LABELS[t as DayType]) || String(t || '').replace(/_/g, ' ');

export enum SwapStatus {
  PENDING_TARGET = 'PENDING_TARGET',
  PENDING_MANAGER = 'PENDING_MANAGER',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED'
}

export enum LeaveStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED'
}

export interface Break {
  id: string;
  start: string; // HH:mm
  end: string;   // HH:mm
}

export interface Shift {
  startTime: string; // HH:mm
  endTime: string;   // HH:mm
  breaks: [Break, Break, Break];
}

export interface ScheduleDay {
  id: string;
  date: string; // YYYY-MM-DD
  type: DayType;
  shift?: Shift;
  minutes?: number; // For Tardy/Early Leave duration
  overtimeHours?: number; // Extra hours worked that day, set by the manager
}

export interface User {
  id: string;
  name: string;
  username: string;
  password?: string;
  role: UserRole;
  jobTitle?: string;
  employeeId?: string;
  companyName?: string;
  managerName?: string;
  teamLeader?: string;
  // Visible to admins only (and the person themself) — set by an admin.
  adminOnly?: boolean;
  // Deactivated by an admin: can't sign in or use the app until reactivated.
  disabled?: boolean;
  annualBalance?: number;
  publicBalance?: number;
  managedDepartments?: string[];
  // Field-operations hierarchy assignment (see BRANCH_ROLES):
  brand?: string;       // Branch Employee / Branch Manager / Area Manager
  branch?: string;      // Branch Employee / Branch Manager
  branches?: string[];  // Area Manager (multi-branch within one brand)
  brands?: string[];    // Operation Manager (multi-brand, all their branches)
  phone?: string;       // Branch Employee / Area Manager contact number
  photoUrl?: string;    // Self-uploaded profile photo (data URI)
}

// Human-readable unit an employee belongs to: department for the call-center
// hierarchy, "BRAND · Branch" for the field-operations hierarchy.
export const unitOf = (u?: Pick<User, 'companyName' | 'brand' | 'branch' | 'brands'>): string => {
  if (!u) return '';
  if (u.companyName?.trim()) return u.companyName.trim();
  if (u.brand?.trim()) return [u.brand.trim(), u.branch?.trim()].filter(Boolean).join(' · ');
  if (u.brands?.length) return u.brands.join(', ');
  return '';
};

export interface SwapRequest {
  id: string;
  requesterId: string;
  targetId: string;
  requesterDate: string; // The date the requester wants to give away
  targetDate: string;    // The date the requester wants to take from the target
  status: SwapStatus;
  originalShift?: Shift;
  targetShift?: Shift;
}

export interface LeaveRequest {
  id: string;
  userId: string;
  userName: string;
  type: DayType;
  date: string; // YYYY-MM-DD
  earlyLeaveTime?: string; // HH:mm
  status: LeaveStatus;
  companyName: string;
  managerId: string; // The specific manager assigned to the request
  createdAt: number;
}

export interface PublicHoliday {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
}

export interface ShiftTemplate {
  id: string;
  name: string;
  type: DayType;
  shift?: Shift;
}

export interface AppNotification {
  id: string;
  type: string;       // 'shift' | 'swap' | 'leave'
  title: string;
  body?: string;
  ts: number;
  read: boolean;
}

export interface AuditEntry {
  id: string;
  ts: number;          // epoch ms
  actorId: string | null;
  actorName: string;
  action: string;      // e.g. "schedule.update", "user.create"
  entityType: string | null;
  entityId: string | null;
  summary: string | null;
  details?: any;
}

// 'ringing' only appears while a call is live; 'interrupted' marks calls a
// server restart cut short.
// 'disconnected' means a side lost its connection while the call was still
// ringing — deliberately distinct from 'declined'/'canceled', which are choices
// somebody actually made.
export type CallStatusLog =
  | 'ringing' | 'answered' | 'missed' | 'declined' | 'canceled' | 'interrupted' | 'disconnected';

export interface CallLogEntry {
  id: string;
  startedAt: number;              // epoch ms
  answeredAt: number | null;
  endedAt: number | null;
  durationSec: number;
  callerId: string;
  callerName: string;
  calleeId: string;
  calleeName: string;
  status: CallStatusLog;
  // Whether the incoming call actually reached one of the callee's open tabs,
  // which is what separates "rang and ignored" from "never got through".
  ringDelivered: boolean;
  pushSent: boolean;
  endedBy: string | null;
  hasRecording: boolean;
  recordingBytes: number | null;
  recordingMime: string | null;
}

// A person a branch employee can reach in-app. Intentionally carries no phone
// number, username or employee id — it exists to place a call, not to expose
// department staff's personal details to every branch.
export interface DirectoryContact {
  id: string;
  name: string;
  role: UserRole;
  department: string;
  jobTitle: string;
}

export interface AppData {
  users: User[];
  schedules: Record<string, Record<string, ScheduleDay>>; // userId -> date -> ScheduleDay
  swapRequests: SwapRequest[];
  leaveRequests: LeaveRequest[];
  publicHolidays: PublicHoliday[];
}

// ---- Employee of the Month evaluations -------------------------------------
// Scored by Branch Manager / Area Manager / Operation Manager against a
// branch employee; the employee can read their own history.
export const EVAL_CRITERIA: { key: string; label: string; description: string }[] = [
  { key: 'qualityOfWork', label: 'Quality of Work', description: 'Consistently performs tasks to a high standard, pays attention to detail & delivers quality results.' },
  { key: 'teamwork', label: 'Teamwork and Collaboration', description: 'Works well with colleagues, assists team members, effective communication.' },
  { key: 'punctuality', label: 'Punctuality & Attendance', description: 'Strong attendance record, no record of tardiness & absences.' },
  { key: 'attitude', label: 'Attitude', description: 'Demonstrates a positive and professional attitude, motivates others.' },
  { key: 'adaptability', label: 'Adaptability and Flexibility', description: 'Adapts to changes, willing to work different shifts, maintains composure under pressure.' },
  { key: 'compliance', label: 'Compliance with Company Policy', description: 'Follows company policies and procedures diligently.' },
  { key: 'foodSafety', label: 'Food Safety & Hygiene Protocols', description: 'Keeps work areas clean, follows hygiene practices, maintains cleanliness standards.' },
];

// ---- Live breaks -----------------------------------------------------------
// An employee clocks in/out of a break; whoever runs their unit (Branch
// Manager, or Team Leader / Supervisor for the call centre) sees it live and
// may end it on their behalf.
export interface BreakEntry {
  id: string;
  userId: string;
  startedAt: number;          // epoch ms
  endedAt: number | null;     // null while the break is still running
  endedById: string | null;
  endedByName: string | null;
  // XONTEL: the agent set themselves back to ready on XonTel.
  endedByRole: 'EMPLOYEE' | 'MANAGER' | 'XONTEL' | null;
  // 'xontel' = a break status (Break, Toilet, Pray, Eating) the agent set on
  // XonTel, mirrored here; 'swipr' = the Start Break button.
  source: 'swipr' | 'xontel';
  xontelStatus: string | null;
}

// One row of a manager's live team roster.
export interface TeamBreakStatus {
  id: string;
  name: string;
  role: UserRole;
  jobTitle: string;
  employeeCode: string;
  brand: string;
  branch: string;
  unit: string;               // "BRAND · Branch" or the department
  active: BreakEntry | null;
  breaksToday: number;
  msToday: number;            // total completed break time today (Kuwait day)
  onShift: boolean;           // inside their scheduled shift window right now
  history: BreakEntry[];      // today's breaks, newest first (includes `active`)
}

// Someone on a break right now, as the dashboard shows it (GET /breaks/now).
export interface ActiveBreak {
  userId: string;
  startedAt: number;
  source: 'swipr' | 'xontel';
  xontelStatus: string | null;
}

// One break row on the Report tab — a BreakEntry plus who it belongs to,
// since a report spans the whole scope rather than one employee's card.
export interface BreakReportRow extends BreakEntry {
  userName: string;
  employeeCode: string;
  role: UserRole;
  unit: string;
  day: string;                // Kuwait day it started (YYYY-MM-DD), clamped to the range
}

export interface BreakReport {
  from: string;
  to: string;
  units: string[];            // every unit in the viewer's scope, breaks or not
  rows: BreakReportRow[];
}

// A manager's Start-Break pause over their own scope (their branch, or their
// department) for a stretch of time. Blocks new breaks only — one already
// running is unaffected.
export interface BreakFreeze {
  id: string;
  startsAt: number;
  endsAt: number;
  reason: string | null;
  createdByName: string;
}

// A running break longer than this is highlighted for the manager. Nothing
// is blocked — it is a visual cue only.
export const LONG_BREAK_MINUTES = 30;

// ---- Attendance (QR clock-in/out) -------------------------------------------
export interface AttendanceRecord {
  id: string;
  kind: 'IN' | 'OUT';
  ts: number;
  brand: string;
  branch: string;
  // "BRAND · Branch" for branch staff, the department name for call centre.
  unit: string;
}

// One row of the Branch Manager's daily attendance board.
export interface TeamAttendanceRow {
  id: string;
  name: string;
  jobTitle: string;
  employeeCode: string;
  photoUrl: string;
  firstIn: number | null;
  lastOut: number | null;
  // Row ids behind firstIn/lastOut, so an admin can correct a specific punch.
  firstInId: string | null;
  lastOutId: string | null;
  onSite: boolean;
  scanCount: number;
}

// One scheduled working day measured against the fingerprint terminal.
// A finding, not a verdict: nothing here changes an employee's record until
// an admin confirms it, which is what writes DayType.TARDY onto the roster.
export type LatenessStatus =
  | 'ON_TIME'        // arrived within the grace period
  | 'LATE'           // arrived later than the grace period allows
  | 'LEFT_EARLY'     // arrived fine but went home before the shift was over
  | 'EXCUSED'        // the roster already records a permitted delay or early leave
  | 'SHIFT_MISMATCH' // arrived late AND left equally late — the roster is wrong, not the person
  | 'LONE_PUNCH'     // a single punch all day: which end of the shift it was is unknowable
  | 'ONLY_OUT'       // punches exist but none reads as an arrival
  | 'NO_PUNCH'       // scheduled, fully synced, and nothing was recorded
  | 'NOT_SYNCED'     // the terminal has not reported in since this shift started
  | 'PENDING';       // the shift has not started, or the grace period has not run out

export interface LatenessRow {
  userId: string;
  name: string;
  role: string;
  company: string | null;
  employeeId: string | null;
  date: string;
  dayType: string;
  scheduledStart: number | null;
  scheduledEnd: number | null;
  arrivalTs: number | null;
  departureTs: number | null;
  offsetMin: number | null;
  earlyLeaveMin: number | null;
  punchCount: number;
  status: LatenessStatus;
  // What a manager already typed on the roster for that day, if anything.
  recordedMinutes: number | null;
  reviewedBy: string | null;
  reviewedName: string | null;
  reviewedAt: number | null;
  reviewAction: LatenessAction | null;
  // The second clock. A XonTel login is when the agent began taking calls;
  // the gap is measured from the fingerprint arrival, or from the scheduled
  // start when the terminal never saw them.
  xontelMapped: boolean;
  xontelLoginTs: number | null;
  xontelLogoutTs: number | null;
  xontelGapMin: number | null;
}

export interface XontelStatus {
  configured: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
}

export interface XontelAgent { id: string; name: string }

export interface XontelMapRow {
  userId: string;
  name: string;
  role: string;
  company: string | null;
  xontelAgentId: string | null;
  xontelAgentName: string | null;
  suggestion: XontelAgent | null;
}

export type LatenessAction = 'CONFIRM' | 'EARLY_LEAVE' | 'ABSENT' | 'DISMISS';

export interface LatenessReport {
  graceMinutes: number;
  // Thresholds come from the server so the screen offers exactly the
  // decisions the engine was willing to stand behind.
  earlyLeaveMinutes: number;
  earlyLeaveAmbiguousMinutes: number;
  lastSyncAt: number | null;
  xontel: XontelStatus;
  rows: LatenessRow[];
}

export interface Evaluation {
  id: string;
  employeeName: string;
  employeeCode: string;
  position: string;
  location: string;
  evaluatorId: string;
  evaluatorName: string;
  scores: Record<string, number>; // one entry per EVAL_CRITERIA key, 1-4
  total: number;
  maxTotal: number;
  approvedByName: string;
  date: number; // epoch ms
}

// One person's XonTel day, behind an avatar on the attendance board.
export interface XontelDaySession {
  status: string;
  startTs: number;
  endTs: number | null;
  durationSec: number | null;
  // Two different questions: signedIn is false only when offline, and is what
  // login and logout are measured from. available is true only for the
  // statuses on which a call can actually reach them.
  signedIn: boolean;
  available: boolean;
}

export interface XontelStatusTotal {
  status: string;
  seconds: number;
  // How many separate spells on that status — twelve one-minute breaks read
  // very differently from one twelve-minute break.
  count: number;
  signedIn: boolean;
  available: boolean;
}

// A real call from the CDR — as opposed to the "in call" STATUS, which keeps
// running until the agent changes it and has been seen at 87 minutes with no
// call underneath it at all.
export interface XontelCall {
  startTs: number;
  endTs: number;
  durationSec: number;
  // The answered portion (Asterisk billsec); zero for a call nobody took.
  talkSec: number;
  direction: string | null;
  status: string | null;
  number: string | null;
  queue: string | null;
}

export interface XontelDay {
  mapped: boolean;
  configured: boolean;
  agentName?: string | null;
  firstIn: number | null;
  lastOut: number | null;
  loginTs?: number | null;
  logoutTs?: number | null;
  awaySeconds?: number;
  availableSeconds?: number;
  // Per-status totals for the day, longest first.
  totals?: XontelStatusTotal[];
  calls?: XontelCall[];
  talkSeconds?: number;
  // "in call" status time with no real call under it — parked, not spoken.
  phantomCallSeconds?: number;
  answeredCalls?: number;
  missedCalls?: number;
  sessions: XontelDaySession[];
}

// ---- Sick-leave medical documents ------------------------------------------
// Visible to the employee who uploaded it and to Admin only.
export interface SickDocument {
  id: string;
  userId: string;
  date: string;               // the sick day it is for (YYYY-MM-DD)
  filename: string | null;
  mime: string;
  bytes: number;
  note: string | null;
  createdAt: number;
}

export interface SickDocsAdminView {
  from: string;
  to: string;
  people: Record<string, { name: string; employeeCode: string; unit: string; role: UserRole }>;
  docs: SickDocument[];
  sickDays: { userId: string; date: string }[];   // SICK days on the roster
}

// ---- Agent KPIs (from XonTel) -------------------------------------------------
// Seconds throughout. availableSec = signed in minus talk, breaks, complain and
// other, so the parts add up to the signed-in time (see /agent-kpis).
export interface AgentKpiTotals {
  answered: number;           // incoming calls answered
  missed: number;             // incoming calls that rang the agent, not picked up
  inTalkSec: number;          // talk on incoming calls (the AHT's numerator)
  outCalls: number;           // outgoing calls made
  outAnswered: number;        // of those, the customer picked up
  talkSec: number;            // talk in both directions (the day strip)
  ahtSec: number;
  signedInSec: number;
  breakSec: number;
  breakCount: number;
  complainSec: number;
  otherSec: number;
  availableSec: number;
}

export interface AgentKpiRow extends AgentKpiTotals {
  userId: string;
  name: string;
  unit: string;
  employeeCode: string;
  activeDays: number;
  flags: string[];            // 'long_signin' = signed in >12h a day on average
}

export interface AgentKpiReport {
  from: string;
  to: string;
  hourly: boolean;            // one day → the series is per hour
  units: string[];
  lastSync: number | null;
  agents: AgentKpiRow[];
  series: { key: string; answered: number; missed: number }[];
  agentDays: (AgentKpiTotals & { userId: string; day: string })[];
}

// ---- Shift adherence (roster vs XonTel vs fingerprint) ------------------------
export type AdherenceStatus = 'ok' | 'late_login' | 'early_logout' | 'no_login' | 'upcoming';
export interface AdherenceRow {
  userId: string;
  name: string;
  unit: string;
  employeeCode: string;
  date: string;               // roster day (YYYY-MM-DD)
  dayType: string;
  shiftStart: number;         // epoch ms, anchored like the lateness engine
  shiftEnd: number;
  running: boolean;           // the shift hasn't ended yet
  loginTs: number | null;     // first XonTel sign-in for this shift
  logoutTs: number | null;    // last XonTel session end (null while running)
  loginLateMin: number | null;   // negative = early
  earlyLogoutMin: number | null;
  signedInSec: number;        // signed in to XonTel inside the shift so far
  elapsedSec: number;         // of the shift elapsed so far
  adherencePct: number | null;
  fpIn: number | null;        // fingerprint arrival / departure, when the bridge ran
  fpOut: number | null;
  status: AdherenceStatus;
}
export interface AdherenceReport {
  from: string;
  to: string;
  units: string[];
  lateGraceMin: number;
  earlyLeaveMin: number;
  fingerprintLastSync: number | null;
  xontelLastSync: number | null;
  rows: AdherenceRow[];
}

// Targets a lead sets; figures outside them are flagged on the page.
export interface KpiTargets {
  ahtMaxSec: number;
  breakMaxSecPerDay: number;
  pickupMinPct: number;
  adherenceMinPct: number;
  lateLoginMaxMin: number;
}

// ---- Calls report (Ops email 1.1 / 1.4) ----------------------------------------
export type CallsGroup = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';
export interface CallsStat {
  answered: number;
  waitN: number;              // calls the queue wait is known for
  waitAvgSec: number | null;
  waitMaxSec: number;
  talkSec: number;
  connN: number;              // calls the CONNECT time is known for
  ahtTrueSec: number | null;  // call end - CONNECT, over connN
  ahtApproxSec: number | null; // billsec / answered, includes IVR and queue time
}
export interface CallsReport {
  from: string; to: string; group: CallsGroup; days: number;
  callCenterAgents: number;
  dataStart: number | null;
  otherAgentsAnswered: number;
  options: { brands: string[]; issues: string[]; aggregators: string[] };
  totals: CallsStat & { waitBuckets: { lt10: number; lt20: number; lt30: number; gte30: number }; waitCoverage: number | null };
  series: (CallsStat & { key: string })[];
  brands: (CallsStat & { brand: string; issue: string })[];
  aggregators: (CallsStat & { aggregator: string })[];
  outgoing: {
    calls: number; answered: number; talkSec: number; ahtAllSec: number | null; ahtAnsweredSec: number | null;
    byStatus: { status: string; calls: number; talkSec: number }[];
    series: { key: string; calls: number }[];
  };
}

// ---- Reporting setup (aggregator numbers, queue -> brand / issue, status classes) ----
export interface ReportAggregator { number: string; aggregator: string; kind: string; note?: string | null }
export interface ReportQueue { queue: string; brand: string; issue: string; note?: string | null }
export interface ReportStatus { status: string; class: string }
export interface ReportConfig {
  canEdit: boolean;
  aggregators: ReportAggregator[];
  queues: ReportQueue[];
  statuses: ReportStatus[];
  unmapped: { queues: { queue: string; calls: number }[]; callers: { number: string; calls: number }[]; statuses: { status: string; hours: number }[] };
  classes: string[];
  kinds: string[];
}

// ---- Missed customer calls (XonTel's queue-level Missed Calls list) -----------
export interface MissedCallback {
  agent: string;              // Swipr name when linked, else the XonTel username
  linked: boolean;
  outcome: string;            // Done / Busy / No Answer, as XonTel recorded it
  at: number;
}
export interface MissedCall {
  id: string;
  missedTs: number;
  caller: string;
  queue: string;
  handled: boolean;           // XonTel marked it done (an agent was assigned)
  status: string;
  assignee: string | null;    // display name XonTel shows
  assignedTs: number | null;
  waitSec: number | null;     // missed → assigned
  calledBackBy: string | null;
  callbacks: MissedCallback[];
}
export interface CallbackAgentRow {
  userId: string | null;      // null = XonTel user not linked to anyone (admins only)
  name: string;
  unit: string;
  employeeCode: string;
  linked: boolean;
  callbacks: number;
  reached: number;
  busy: number;
  noAnswer: number;
  avgWaitSec: number | null;
}
export interface MissedReport {
  from: string;
  to: string;
  units: string[];
  lastSync: number | null;
  oldestMissed: number | null; // earliest missed call stored; days before it only hold called-back ones
  calls: MissedCall[];
  agents: CallbackAgentRow[];
}
