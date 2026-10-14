import React, { useState, useEffect, useMemo } from 'react';
import { Coffee, Users, Search, RotateCcw, CheckCircle2, AlertTriangle, Clock, X, ChevronLeft, ChevronRight, Calendar as CalendarIcon, PauseCircle, PlayCircle } from 'lucide-react';
import { format } from 'date-fns';
import { store } from '../store';
import { TeamBreakStatus, BreakEntry, BreakReport, BreakReportRow, BreakFreeze, LONG_BREAK_MINUTES, UserRole, isBranchRole } from '../types';
import { formatElapsed, formatDuration, useNowTick } from '../BreakCard';
import { useLanguage } from '../i18n';
import { useAuth } from '../App';

// Live view of a manager's employees — a branch for a Branch Manager, a
// department for a Team Leader or Supervisor, everyone for Admin: who is on
// break right now, for how long, and a one-click way to bring them back —
// plus a Report tab for any past day's breaks, since the live view only ever
// carries today.
export default function BreakMonitor() {
  const { t } = useLanguage();
  const [tab, setTab] = useState<'live' | 'report'>('live');
  return (
    <div className="space-y-6">
      <div className="inline-flex p-1.5 bg-gray-100 rounded-2xl">
        {([['live', 'liveBreaks.tabLive'], ['report', 'liveBreaks.tabReport']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-5 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${
              tab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {t(label)}
          </button>
        ))}
      </div>
      {tab === 'live' ? <LiveBreaks /> : <BreaksReport />}
    </div>
  );
}

function LiveBreaks() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const viewerRole = user?.role;
  const subtitle = viewerRole === UserRole.ADMIN ? t('liveBreaks.subtitleAll')
    : isBranchRole(viewerRole) ? t('liveBreaks.subtitle') : t('liveBreaks.subtitleDept');
  const [team, setTeam] = useState<TeamBreakStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [endingId, setEndingId] = useState<string | null>(null);
  // The avatar opens a breakdown for that one employee; kept as an id so it
  // re-points at the live row in `team` (poll refreshes it) instead of going
  // stale the moment their break state changes underneath the open panel.
  const [detailId, setDetailId] = useState<string | null>(null);
  const [freeze, setFreeze] = useState<BreakFreeze | null>(null);
  const [freezeModalOpen, setFreezeModalOpen] = useState(false);
  const [resuming, setResuming] = useState(false);
  const now = useNowTick(true);
  // Admin oversees every unit rather than owning one itself, so "pause
  // breaks for your unit" has nothing to point at for them — the button is
  // for the three roles that actually run one.
  const canFreeze = viewerRole === UserRole.BRANCH_MANAGER || viewerRole === UserRole.MANAGER || viewerRole === UserRole.SUPERVISOR;

  useEffect(() => {
    const unsub = store.subscribeToTeamBreaks((rows) => {
      setTeam(rows);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!canFreeze) return;
    const unsub = store.subscribeToBreakFreeze(setFreeze);
    return () => unsub();
  }, [canFreeze]);

  const resumeBreaks = async () => {
    setResuming(true);
    try {
      await store.cancelBreakFreeze();
      setFreeze(null);
    } catch {
      alert('Could not lift the pause. Try again.');
    }
    setResuming(false);
  };

  const endFor = async (emp: TeamBreakStatus) => {
    const onXontel = emp.active?.source === 'xontel';
    if (!confirm(`End ${emp.name}'s break now? They will be notified${onXontel ? ', and set back to Ready on XonTel' : ''}.`)) return;
    setEndingId(emp.id);
    try {
      await store.endBreakFor(emp.id);
      const fresh = await store.getTeamBreaks();
      setTeam(fresh);
    } catch {
      alert('Could not end that break — they may have already returned.');
    }
    setEndingId(null);
  };

  // Admin's roster spans every branch and department (~280 cards), so it can
  // be narrowed to one; a lead with a single unit never sees the picker.
  const [unit, setUnit] = useState('');
  const units = useMemo(() => [...new Set(team.map((e) => e.unit).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [team]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = team.filter((e) =>
      (!unit || e.unit === unit) &&
      (!q || e.name.toLowerCase().includes(q) || e.employeeCode.toLowerCase().includes(q))
    );
    // On-break first, then on-shift-and-working, then off-shift last;
    // longest-running break at the top within the first group.
    const rank = (e: TeamBreakStatus) => (e.active ? 0 : e.onShift ? 1 : 2);
    return [...rows].sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      if (a.active && b.active) return a.active.startedAt - b.active.startedAt;
      return a.name.localeCompare(b.name);
    });
  }, [team, query, unit]);

  const detail = detailId ? team.find((e) => e.id === detailId) || null : null;

  const onBreak = filtered.filter((e) => e.active);
  // "Working" means actually inside their shift right now — someone whose
  // shift hasn't started yet or already ended is not working just because
  // they aren't on a break (that read as a bug: everyone showed "Working"
  // around the clock, shift or no shift).
  const working = filtered.filter((e) => !e.active && e.onShift);
  const offShift = filtered.filter((e) => !e.active && !e.onShift);

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">{t('liveBreaks.title')}</h1>
          <p className="text-sm font-bold text-gray-400 mt-1">{subtitle}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          <span className="bg-amber-50 text-amber-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border border-amber-100">
            {onBreak.length} On Break
          </span>
          <span className="bg-emerald-50 text-emerald-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border border-emerald-100">
            {working.length} Working
          </span>
          {offShift.length > 0 && (
            <span className="bg-gray-50 text-gray-500 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border border-gray-200">
              {offShift.length} Off Shift
            </span>
          )}
          {canFreeze && (
            freeze ? (
              <button
                onClick={resumeBreaks}
                disabled={resuming}
                className="flex items-center gap-2 bg-gray-900 hover:bg-black text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50"
              >
                <PlayCircle size={14} />
                {resuming ? 'Resuming...' : `Resume Breaks · until ${format(new Date(freeze.endsAt), 'p')}`}
              </button>
            ) : (
              <button
                onClick={() => setFreezeModalOpen(true)}
                className="flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border border-gray-200 transition-all active:scale-95"
              >
                <PauseCircle size={14} />
                Pause Breaks
              </button>
            )
          )}
        </div>
      </div>

      {freeze && (
        <div className="flex items-start gap-3 p-4 bg-gray-50 border border-gray-200 rounded-2xl">
          <PauseCircle size={18} className="text-gray-400 shrink-0 mt-0.5" />
          <p className="text-xs font-bold text-gray-600">
            Breaks are paused until <span className="font-black text-gray-900">{format(new Date(freeze.endsAt), 'p')}</span>
            {freeze.reason ? <> — {freeze.reason}</> : null}. Nobody in your scope can start a new one until then; anyone already out can still end theirs.
          </p>
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-3">
        {units.length > 1 && (
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className="md:w-72 px-4 py-3.5 rounded-2xl bg-white border border-gray-100 text-sm font-bold text-gray-900 outline-none focus:ring-4 focus:ring-blue-500/10"
          >
            <option value="">All departments &amp; branches</option>
            {units.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        )}
        <div className="relative flex-1">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('liveBreaks.search')}
            className="w-full pl-11 pr-5 py-3.5 rounded-2xl bg-white border border-gray-100 text-gray-900 text-sm font-medium outline-none focus:ring-4 focus:ring-blue-500/10 placeholder:text-gray-400 transition-all"
          />
        </div>
      </div>

      {loading ? (
        <p className="text-center py-20 text-gray-300 font-bold">Loading your team...</p>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-[32px] p-16 text-center border border-gray-100">
          <Users size={48} className="mx-auto text-gray-200 mb-4" />
          <p className="text-gray-400 font-bold">
            {query ? t('liveBreaks.noMatch') : t('liveBreaks.empty')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((emp) => {
            const elapsed = emp.active ? now - emp.active.startedAt : 0;
            const isLong = elapsed > LONG_BREAK_MINUTES * 60 * 1000;
            return (
              <div
                key={emp.id}
                className={`rounded-[32px] p-6 border-2 shadow-sm transition-colors ${
                  emp.active
                    ? isLong
                      ? 'bg-rose-50 border-rose-200'
                      : 'bg-amber-50 border-amber-200'
                    : emp.onShift
                    ? 'bg-white border-gray-100'
                    : 'bg-gray-50/60 border-gray-100 opacity-75'
                }`}
              >
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => setDetailId(emp.id)}
                    title={`${emp.name} — today's breaks`}
                    className={`w-11 h-11 rounded-2xl flex items-center justify-center text-white shrink-0 transition-transform hover:scale-105 active:scale-95 ${
                      emp.active ? (isLong ? 'bg-rose-600' : 'bg-amber-500') : emp.onShift ? 'bg-emerald-500' : 'bg-gray-300'
                    }`}
                  >
                    {emp.active ? <Coffee size={20} /> : emp.onShift ? <CheckCircle2 size={20} /> : <Clock size={20} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="font-black text-gray-900 text-sm leading-tight truncate">{emp.name}</p>
                    <p className="text-[11px] font-bold text-gray-400 truncate mt-0.5">
                      {emp.jobTitle || (isBranchRole(emp.role) ? 'Branch Employee' : 'Agent')}
                      {emp.employeeCode && ` · ${emp.employeeCode}`}
                    </p>
                    {/* Admin's list mixes branches and departments — say which. */}
                    {viewerRole === UserRole.ADMIN && emp.unit && (
                      <p className="text-[10px] font-black text-gray-300 uppercase tracking-wider truncate mt-0.5">{emp.unit}</p>
                    )}
                  </div>
                  {isLong && <AlertTriangle size={16} className="text-rose-600 shrink-0" />}
                </div>

                <div className="mt-5">
                  {emp.active ? (
                    <>
                      <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${isLong ? 'text-rose-600' : 'text-amber-600'}`}>
                        On break for
                      </p>
                      <p className="text-2xl font-black text-gray-900 tabular-nums leading-none">{formatElapsed(elapsed)}</p>
                      <p className="text-[11px] font-bold text-gray-500 mt-1.5 flex items-center gap-2">
                        Since {format(new Date(emp.active.startedAt), 'p')}
                        {emp.active.source === 'xontel' && <XontelTag status={emp.active.xontelStatus} />}
                      </p>
                    </>
                  ) : emp.onShift ? (
                    <>
                      <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1">Available</p>
                      <p className="text-xl font-black text-gray-900 leading-none">Working</p>
                      <p className="text-[11px] font-bold text-gray-400 mt-1.5">
                        {emp.breaksToday === 0
                          ? 'No breaks today'
                          : `${emp.breaksToday} break${emp.breaksToday > 1 ? 's' : ''} · ${formatDuration(emp.msToday)} total`}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Not scheduled now</p>
                      <p className="text-xl font-black text-gray-500 leading-none">Off Shift</p>
                      <p className="text-[11px] font-bold text-gray-400 mt-1.5">
                        {emp.breaksToday === 0
                          ? 'No breaks today'
                          : `${emp.breaksToday} break${emp.breaksToday > 1 ? 's' : ''} · ${formatDuration(emp.msToday)} total`}
                      </p>
                    </>
                  )}
                </div>

                {emp.active && (
                  <button
                    onClick={() => endFor(emp)}
                    disabled={endingId === emp.id}
                    className="mt-5 w-full flex items-center justify-center gap-2 py-3.5 bg-gray-900 hover:bg-black text-white rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50"
                  >
                    <RotateCcw size={14} />
                    {endingId === emp.id ? 'Ending...' : 'End Break'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {detail && <BreakDetail emp={detail} now={now} onClose={() => setDetailId(null)} />}
      {freezeModalOpen && (
        <FreezeBreaksModal
          onClose={() => setFreezeModalOpen(false)}
          onConfirm={async (minutes, reason) => {
            const f = await store.freezeBreaks(minutes, reason);
            setFreeze(f);
            setFreezeModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

// Duration + optional reason for a break pause. Confirming closes itself
// (via onConfirm awaiting the request) only once the server call succeeds,
// so a failed request leaves the modal open with the error visible.
const FreezeBreaksModal: React.FC<{ onClose: () => void; onConfirm: (minutes: number, reason: string) => Promise<void> }> = ({ onClose, onConfirm }) => {
  const [minutes, setMinutes] = useState(30);
  const [custom, setCustom] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const presets = [15, 30, 45, 60];
  const effective = custom.trim() ? Number(custom) : minutes;

  const confirm = async () => {
    if (!Number.isFinite(effective) || effective < 1) { setError('Pick a duration first.'); return; }
    setBusy(true);
    setError('');
    try {
      await onConfirm(Math.round(effective), reason.trim());
    } catch (e: any) {
      const m = String(e?.message || '').match(/\{.*\}/s);
      let msg = 'Could not pause breaks. Try again.';
      try { msg = (m && JSON.parse(m[0])?.error) || msg; } catch { /* keep default */ }
      setError(msg);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm" onClick={() => !busy && onClose()}>
      <div className="bg-white rounded-[32px] w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-7 pt-7 pb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-gray-900 tracking-tight">Pause Breaks</h2>
            <p className="text-xs font-bold text-gray-400 mt-1">Nobody in your scope can start a new break until it lifts.</p>
          </div>
          <button onClick={() => !busy && onClose()} className="w-10 h-10 rounded-2xl flex items-center justify-center bg-gray-50 text-gray-500 hover:bg-gray-100 shrink-0"><X size={16} /></button>
        </div>

        <div className="px-7 pb-7 space-y-5">
          <div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Duration</p>
            <div className="grid grid-cols-4 gap-2">
              {presets.map((m) => (
                <button
                  key={m}
                  onClick={() => { setMinutes(m); setCustom(''); }}
                  className={`py-2.5 rounded-xl text-xs font-black transition-all ${
                    !custom.trim() && minutes === m ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  {m}m
                </button>
              ))}
            </div>
            <input
              type="number"
              min={1}
              max={480}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Custom minutes"
              className="mt-2 w-full px-4 py-2.5 rounded-xl bg-gray-50 border border-gray-100 text-sm font-bold text-gray-900 outline-none focus:ring-4 focus:ring-blue-500/10 placeholder:text-gray-400 placeholder:font-medium"
            />
          </div>

          <div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Reason (optional)</p>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Rush hour — need everyone on the floor"
              maxLength={200}
              className="w-full px-4 py-2.5 rounded-xl bg-gray-50 border border-gray-100 text-sm font-medium text-gray-900 outline-none focus:ring-4 focus:ring-blue-500/10 placeholder:text-gray-400"
            />
          </div>

          {error && <p className="text-xs font-bold text-rose-600">{error}</p>}

          <button
            onClick={confirm}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-gray-900 hover:bg-black text-white rounded-2xl font-black text-xs uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50"
          >
            <PauseCircle size={16} />
            {busy ? 'Pausing...' : `Pause for ${Number.isFinite(effective) && effective > 0 ? Math.round(effective) : '—'} min`}
          </button>
        </div>
      </div>
    </div>
  );
};

// Today's breakdown behind an employee's avatar: how many breaks, how many
// minutes total, and each one's times. Reads straight off the `team` row the
// list already has, so it updates live from the same poll instead of its own
// fetch.
const BreakDetail: React.FC<{ emp: TeamBreakStatus; now: number; onClose: () => void }> = ({ emp, now, onClose }) => (
  <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm" onClick={onClose}>
    <div className="bg-white rounded-[32px] w-full max-w-md max-h-[80vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
      <div className="px-7 pt-7 pb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-black text-gray-900 tracking-tight truncate">{emp.name}</h2>
          <p className="text-xs font-bold text-gray-400 mt-1 truncate">{emp.jobTitle || (isBranchRole(emp.role) ? 'Branch Employee' : 'Agent')}{emp.unit ? ` · ${emp.unit}` : ''}</p>
        </div>
        <button onClick={onClose} className="w-10 h-10 rounded-2xl flex items-center justify-center bg-gray-50 text-gray-500 hover:bg-gray-100 shrink-0"><X size={16} /></button>
      </div>

      <div className="px-7 grid grid-cols-2 gap-3 mb-2">
        <div className="rounded-2xl border border-gray-100 px-4 py-3.5 text-center">
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-300">Breaks Today</p>
          <p className="text-2xl font-black text-gray-900 tabular-nums">{emp.breaksToday}</p>
        </div>
        <div className="rounded-2xl border border-gray-100 px-4 py-3.5 text-center">
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-300">Total Time</p>
          <p className="text-2xl font-black text-gray-900 tabular-nums">
            {emp.msToday === 0 && !emp.active ? '0m' : formatDuration(emp.msToday + (emp.active ? now - emp.active.startedAt : 0))}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-7 pb-7 pt-4">
        <BreakEntryRows entries={emp.history} now={now} empty="No breaks today." />
      </div>
    </div>
  </div>
);

// Marks a break that came from a status the agent set on XonTel rather than
// the Start Break button, with which status it was.
const XontelTag: React.FC<{ status: string | null }> = ({ status }) => (
  <span title="Taken on XonTel" className="text-[8px] font-black uppercase tracking-wide text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded shrink-0">
    XonTel{status ? ` · ${status}` : ''}
  </span>
);

// One break's row — start, end (or "now" while still running), duration,
// and who ended it if a manager did. Shared by the avatar popover and the
// Report tab so both read the same shape the same way.
const BreakEntryRows: React.FC<{ entries: BreakEntry[]; now: number; empty: string }> = ({ entries, now, empty }) =>
  entries.length === 0 ? (
    <p className="text-center py-10 text-sm font-bold text-gray-300">{empty}</p>
  ) : (
    <div className="space-y-2">
      {entries.map((b) => {
        const ongoing = b.endedAt == null;
        return (
          <div key={b.id} className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-xs border ${ongoing ? 'bg-amber-50 border-amber-100' : 'border-gray-100'}`}>
            <span className="font-bold text-gray-900 tabular-nums">{format(new Date(b.startedAt), 'p')}</span>
            <span className="text-gray-300">→</span>
            <span className="font-bold text-gray-500 tabular-nums">{ongoing ? 'now' : format(new Date(b.endedAt!), 'p')}</span>
            {b.source === 'xontel' && <XontelTag status={b.xontelStatus} />}
            <span className={`ml-auto font-black tabular-nums ${ongoing ? 'text-amber-600' : 'text-gray-900'}`}>
              {ongoing ? formatElapsed(now - b.startedAt) : formatDuration(b.endedAt! - b.startedAt)}
            </span>
            {b.endedByRole === 'MANAGER' && (
              <span title={`Ended by ${b.endedByName}`} className="text-[8px] font-black uppercase tracking-wide text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded shrink-0">Mgr</span>
            )}
          </div>
        );
      })}
    </div>
  );

// Breaks over any range of days for the viewer's scope — the live tab only
// ever shows today. Filters: a date range (with the usual shortcuts), the
// unit (department or branch) and a name / employee-number search. The unit
// and name filters apply in the page, so changing them is instant; only the
// date range goes back to the server.
const ymd = (d: Date) => format(d, 'yyyy-MM-dd');
const REPORT_PRESETS: { key: string; label: string; range: () => [string, string] }[] = [
  { key: 'today', label: 'Today', range: () => [ymd(new Date()), ymd(new Date())] },
  { key: 'yesterday', label: 'Yesterday', range: () => { const d = new Date(); d.setDate(d.getDate() - 1); return [ymd(d), ymd(d)]; } },
  { key: 'week', label: 'Last 7 days', range: () => { const d = new Date(); d.setDate(d.getDate() - 6); return [ymd(d), ymd(new Date())]; } },
  { key: 'month', label: 'This month', range: () => { const d = new Date(); return [ymd(new Date(d.getFullYear(), d.getMonth(), 1)), ymd(d)]; } },
];

function BreaksReport() {
  const { user } = useAuth();
  const viewerRole = user?.role;
  const today = ymd(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [unit, setUnit] = useState('');
  const [query, setQuery] = useState('');
  const [report, setReport] = useState<BreakReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const now = useNowTick(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    store.getBreaksReport(from, to)
      .then((r) => { if (live) setReport(r); })
      .catch((e: any) => {
        if (!live) return;
        const m = String(e?.message || '').match(/\{.*\}/s);
        let msg = 'Could not load those days.';
        try { msg = (m && JSON.parse(m[0])?.error) || msg; } catch { /* keep default */ }
        setError(msg);
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [from, to]);

  // Keep the range the right way round whichever end is moved.
  const setFromSafe = (v: string) => { if (!v) return; setFrom(v); if (v > to) setTo(v); };
  const setToSafe = (v: string) => { if (!v) return; setTo(v); if (v < from) setFrom(v); };
  const activePreset = REPORT_PRESETS.find((p) => { const [a, b] = p.range(); return a === from && b === to; })?.key;

  const units = report?.units || [];
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (report?.rows || []).filter((r) =>
      (!unit || r.unit === unit) &&
      (!q || r.userName.toLowerCase().includes(q) || (r.employeeCode || '').toLowerCase().includes(q))
    );
  }, [report, unit, query]);

  const msOf = (b: BreakReportRow) => (b.endedAt != null ? b.endedAt - b.startedAt : now - b.startedAt);

  // Newest day first; inside a day, one card per employee.
  const days = useMemo(() => {
    const byDay = new Map<string, Map<string, { name: string; unit: string; entries: BreakReportRow[] }>>();
    for (const r of rows) {
      if (!byDay.has(r.day)) byDay.set(r.day, new Map());
      const people = byDay.get(r.day)!;
      if (!people.has(r.userId)) people.set(r.userId, { name: r.userName, unit: r.unit, entries: [] });
      people.get(r.userId)!.entries.push(r);
    }
    return [...byDay.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([day, people]) => ({ day, people: [...people.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name)) }));
  }, [rows]);

  const totalMs = rows.reduce((sum, b) => sum + msOf(b), 0);
  const employees = new Set(rows.map((r) => r.userId)).size;
  const filtering = !!unit || !!query.trim();

  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-100 rounded-[28px] shadow-sm p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <CalendarIcon size={14} className="text-gray-300" />
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">From</label>
            <input type="date" value={from} max={today} onChange={(e) => setFromSafe(e.target.value)}
              className="px-3 py-2 rounded-xl bg-gray-50 border border-gray-100 font-black text-sm text-gray-900 outline-none focus:ring-4 focus:ring-blue-500/10" />
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">To</label>
            <input type="date" value={to} max={today} onChange={(e) => setToSafe(e.target.value)}
              className="px-3 py-2 rounded-xl bg-gray-50 border border-gray-100 font-black text-sm text-gray-900 outline-none focus:ring-4 focus:ring-blue-500/10" />
          </div>
          <div className="flex items-center gap-2 flex-wrap lg:ml-auto">
            {REPORT_PRESETS.map((p) => (
              <button key={p.key} onClick={() => { const [a, b] = p.range(); setFrom(a); setTo(b); }}
                className={`px-3.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                  activePreset === p.key ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                }`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-3">
          {units.length > 1 && (
            <select value={unit} onChange={(e) => setUnit(e.target.value)}
              className="md:w-72 px-4 py-3 rounded-2xl bg-gray-50 border border-gray-100 text-sm font-bold text-gray-900 outline-none focus:ring-4 focus:ring-blue-500/10">
              <option value="">All departments &amp; branches</option>
              {units.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          )}
          <div className="relative flex-1">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by employee name or ID..."
              className="w-full pl-11 pr-10 py-3 rounded-2xl bg-gray-50 border border-gray-100 text-gray-900 text-sm font-medium outline-none focus:ring-4 focus:ring-blue-500/10 placeholder:text-gray-400" />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"><X size={16} /></button>
            )}
          </div>
        </div>

        {report && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="bg-gray-50 text-gray-600 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border border-gray-100">
              {rows.length} break{rows.length !== 1 ? 's' : ''} · {employees} employee{employees !== 1 ? 's' : ''}
            </span>
            <span className="bg-amber-50 text-amber-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border border-amber-100">
              {formatDuration(totalMs)} total
            </span>
            {filtering && (
              <button onClick={() => { setUnit(''); setQuery(''); }}
                className="text-[10px] font-black uppercase tracking-widest text-blue-600 hover:text-blue-700 px-2">
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-center py-20 text-gray-300 font-bold">Loading...</p>
      ) : error ? (
        <div className="bg-rose-50 border border-rose-100 rounded-2xl px-5 py-4 text-sm font-bold text-rose-600">{error}</div>
      ) : days.length === 0 ? (
        <div className="bg-white rounded-[32px] p-16 text-center border border-gray-100">
          <Coffee size={48} className="mx-auto text-gray-200 mb-4" />
          <p className="text-gray-400 font-bold">
            {filtering ? 'No breaks match these filters.' : `No breaks recorded ${from === to ? `on ${format(new Date(from + 'T00:00:00'), 'MMMM d, yyyy')}` : 'in this range'}.`}
          </p>
        </div>
      ) : (
        <div className="space-y-10">
          {days.map(({ day, people }) => {
            const dayRows = people.flatMap(([, p]) => p.entries);
            return (
              <section key={day} className="space-y-4">
                <div className="flex items-baseline justify-between gap-3 border-b border-gray-100 pb-2">
                  <h3 className="text-lg font-black text-gray-900">{format(new Date(day + 'T00:00:00'), 'EEEE, MMMM d')}</h3>
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                    {dayRows.length} break{dayRows.length !== 1 ? 's' : ''} · {people.length} employee{people.length !== 1 ? 's' : ''} · {formatDuration(dayRows.reduce((s, b) => s + msOf(b), 0))}
                  </span>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {people.map(([userId, g]) => (
                    <div key={userId} className="bg-white rounded-[28px] border border-gray-100 shadow-sm p-6">
                      <div className="flex items-start justify-between gap-3 mb-4">
                        <div className="min-w-0">
                          <p className="font-black text-gray-900 text-sm truncate">{g.name}</p>
                          {(viewerRole === UserRole.ADMIN || units.length > 1) && g.unit && (
                            <p className="text-[10px] font-black text-gray-300 uppercase tracking-wider truncate mt-0.5">{g.unit}</p>
                          )}
                        </div>
                        <span className="shrink-0 text-[10px] font-black text-gray-400 uppercase tracking-wide">
                          {g.entries.length} · {formatDuration(g.entries.reduce((s, b) => s + msOf(b), 0))}
                        </span>
                      </div>
                      <BreakEntryRows entries={g.entries} now={now} empty="No breaks." />
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
