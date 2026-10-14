import React, { useState, useEffect } from 'react';
import { Coffee, Play, Square, UserCheck, PauseCircle } from 'lucide-react';
import { format } from 'date-fns';
import { store } from './store';
import { BreakEntry, BreakFreeze, LONG_BREAK_MINUTES, UserRole, isBranchRole } from './types';

// Renders a running duration as H:MM:SS (or MM:SS under an hour).
export const formatElapsed = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

// Compact duration for finished breaks, e.g. "42m" or "1h 5m".
export const formatDuration = (ms: number) => {
  const mins = Math.max(0, Math.round(ms / 60000));
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
};

// http() throws `Error(\`HTTP ${status} ${path} ${rawBody}\`)` — rawBody is
// the server's own JSON, e.g. {"error":"Ahmed is already on a break..."}.
// Pulling that out surfaces the server's actual reason (already-on-a-break,
// someone-else-from-your-team, ...) instead of collapsing every 409 into one
// generic sentence.
const serverError = (e: unknown): string | null => {
  const m = String((e as any)?.message || '').match(/\{.*\}/s);
  if (!m) return null;
  try { return JSON.parse(m[0])?.error || null; } catch { return null; }
};

// A clock that re-renders every second, so running breaks tick live.
export const useNowTick = (active: boolean) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
};

// The employee's own break control: one button that starts a break and turns
// into "End Break" (with a live counter) while the break is running. The role
// only decides who the card says is watching.
export default function BreakCard({ role }: { role?: UserRole }) {
  // deptManagersFor (server-side) notifies every Team Leader and Supervisor
  // in the department, not just one assigned lead — say "your department's
  // leads", not "your Team Leader", so this doesn't imply a single person.
  const watcher = isBranchRole(role) ? 'Your Branch Manager is' : "Your department's leads are";
  const [active, setActive] = useState<BreakEntry | null>(null);
  const [history, setHistory] = useState<BreakEntry[]>([]);
  const [freeze, setFreeze] = useState<BreakFreeze | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const now = useNowTick(!!active);

  useEffect(() => {
    const unsub = store.subscribeToMyBreaks((data) => {
      setActive(data.active);
      setHistory(data.history);
      setFreeze(data.freeze);
    });
    return () => unsub();
  }, []);

  const toggle = async () => {
    setBusy(true);
    setError('');
    try {
      if (active) {
        const ended = await store.endBreak();
        setActive(null);
        setHistory((prev) => [ended, ...prev.filter((b) => b.id !== ended.id)]);
      } else {
        const started = await store.startBreak();
        setActive(started);
        setHistory((prev) => [started, ...prev]);
      }
    } catch (e: any) {
      // The manager may have ended it first, or a teammate beat them to the
      // one break slot the department has — refresh rather than guess.
      setError(serverError(e) || 'Something went wrong. Try again.');
      try {
        const fresh = await store.getMyBreaks();
        setActive(fresh.active);
        setHistory(fresh.history);
      } catch { /* ignore */ }
    }
    setBusy(false);
  };

  const elapsed = active ? now - active.startedAt : 0;
  const isLong = elapsed > LONG_BREAK_MINUTES * 60 * 1000;
  const recent = history.filter((b) => b.endedAt != null).slice(0, 5);
  // A freeze only blocks a NEW break from starting — someone already out
  // keeps their End Break button live regardless.
  const frozen = !active && !!freeze;

  return (
    <div
      className={`rounded-[32px] p-8 border-2 shadow-sm transition-colors ${
        active
          ? isLong
            ? 'bg-rose-50 border-rose-200'
            : 'bg-amber-50 border-amber-200'
          : 'bg-white border-gray-100'
      }`}
    >
      <div className="flex flex-col sm:flex-row items-center gap-8">
        <div
          className={`w-16 h-16 rounded-2xl flex items-center justify-center text-white shadow-lg shrink-0 ${
            active ? (isLong ? 'bg-rose-600' : 'bg-amber-500') : 'bg-gray-900'
          }`}
        >
          <Coffee size={32} />
        </div>

        <div className="flex-1 text-center sm:text-left">
          <p
            className={`text-[10px] font-black uppercase tracking-widest mb-1 ${
              active ? (isLong ? 'text-rose-600' : 'text-amber-600') : 'text-gray-400'
            }`}
          >
            {active ? 'On Break' : 'Status'}
          </p>
          {active ? (
            <>
              <p className="text-3xl font-black text-gray-900 tabular-nums leading-none">{formatElapsed(elapsed)}</p>
              <p className="text-xs font-bold text-gray-500 mt-1.5">
                Started at {format(new Date(active.startedAt), 'p')}
                {active.source === 'xontel' && <span className="text-violet-600"> · on XonTel{active.xontelStatus ? ` (${active.xontelStatus})` : ''}</span>}
                {isLong && <span className="text-rose-600"> · over {LONG_BREAK_MINUTES}m</span>}
              </p>
            </>
          ) : (
            <>
              <p className="text-xl font-black text-gray-900 leading-none">Available · Working</p>
              <p className="text-xs font-bold text-gray-400 mt-1.5">{watcher} notified when you start or end a break.</p>
            </>
          )}
        </div>

        <button
          onClick={toggle}
          disabled={busy || frozen}
          className={`w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest text-white shadow-xl transition-all active:scale-95 disabled:opacity-50 ${
            active ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-100' : 'bg-amber-500 hover:bg-amber-600 shadow-amber-100'
          }`}
        >
          {active ? <Square size={16} /> : frozen ? <PauseCircle size={16} /> : <Play size={16} />}
          {busy ? 'Saving...' : active ? 'End Break' : frozen ? 'Breaks Paused' : 'Start Break'}
        </button>
      </div>

      {frozen && freeze && (
        <div className="mt-4 flex items-start gap-3 p-4 bg-gray-50 border border-gray-200 rounded-2xl">
          <PauseCircle size={18} className="text-gray-400 shrink-0 mt-0.5" />
          <p className="text-xs font-bold text-gray-600">
            Your {isBranchRole(role) ? 'Branch Manager has' : "team's lead has"} paused breaks until{' '}
            <span className="font-black text-gray-900">{format(new Date(freeze.endsAt), 'p')}</span>
            {freeze.reason ? <> — {freeze.reason}</> : null}.
          </p>
        </div>
      )}

      {error && (
        <p className="mt-4 p-3 bg-rose-50 text-rose-600 rounded-xl text-xs font-black uppercase tracking-wide border border-rose-100">{error}</p>
      )}

      {recent.length > 0 && (
        <div className="mt-8 pt-6 border-t border-gray-100">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Recent Breaks</p>
          <div className="space-y-2">
            {recent.map((b) => (
              <div key={b.id} className="flex items-center gap-3 text-xs">
                <span className="font-bold text-gray-900 tabular-nums">
                  {format(new Date(b.startedAt), 'MMM d · p')}
                </span>
                <span className="text-gray-300">→</span>
                <span className="font-bold text-gray-500 tabular-nums">{format(new Date(b.endedAt!), 'p')}</span>
                <span className="ml-auto font-black text-gray-900 tabular-nums">{formatDuration(b.endedAt! - b.startedAt)}</span>
                {b.endedByRole === 'MANAGER' && (
                  <span
                    title={`Ended by ${b.endedByName}`}
                    className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wide text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100 shrink-0"
                  >
                    <UserCheck size={10} /> By Manager
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
