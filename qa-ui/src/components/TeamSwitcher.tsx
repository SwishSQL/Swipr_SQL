import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';

// QA functions ("teams"): Customer Care (Swish) / Complaint Team (Complain) / Technical Team (TEC).
// Every page shows one team at a time. The chosen team travels in the X-QA-Team header (see main.tsx) and the
// server only accepts a team the signed-in person may see, so this control is a convenience, not the guard.
export const TEAM_LABELS: Record<string, string> = { Swish: 'Customer Care', Complain: 'Complaint Team', TEC: 'Technical Team' };
export const teamOfDepartment = (d: any): string => {
  const v = String(d || '').trim().toLowerCase();
  return v.startsWith('tec') ? 'TEC' : v.startsWith('compl') ? 'Complain' : 'Swish';
};
export const TEAM_STORAGE_KEY = 'qa_team';

export type TeamInfo = { current: string; allowed: string[]; labels: Record<string, string>; call_types: Record<string, string[] | null> };

export default function TeamSwitcher() {
  const [info, setInfo] = useState<TeamInfo | null>(null);

  useEffect(() => {
    fetch('/api/teams')
      .then(r => (r.ok ? r.json() : null))
      .then((t: TeamInfo | null) => {
        if (!t) return;
        setInfo(t);
        // keep the stored choice in step with what the server accepted
        try { localStorage.setItem(TEAM_STORAGE_KEY, t.current); } catch { /* storage may be unavailable */ }
      })
      .catch(() => {});
  }, []);

  if (!info || info.allowed.length < 2) return null;

  const choose = (team: string) => {
    if (team === info.current) return;
    try { localStorage.setItem(TEAM_STORAGE_KEY, team); } catch { /* ignore */ }
    // every page reads its data on mount with the header, so a reload is the simplest way to switch everything at once
    window.location.reload();
  };

  return (
    <div className="flex items-center gap-1 p-1 rounded-2xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800" title="Team being viewed">
      <Users size={12} className="ml-2 mr-1 text-indigo-500 shrink-0" />
      {info.allowed.map(t => (
        <button
          key={t}
          type="button"
          onClick={() => choose(t)}
          className={`px-2.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-colors whitespace-nowrap ${
            t === info.current
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-white dark:hover:bg-zinc-800'
          }`}
        >
          <span className="hidden md:inline">{info.labels?.[t] || TEAM_LABELS[t] || t}</span>
          <span className="md:hidden">{t === 'Swish' ? 'CC' : t === 'Complain' ? 'CT' : t}</span>
        </button>
      ))}
    </div>
  );
}
