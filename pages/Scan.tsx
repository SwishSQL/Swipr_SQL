import React, { useState, useEffect, useRef } from 'react';
import { Navigate, useLocation, Link } from 'react-router-dom';
import { CheckCircle2, XCircle, LogIn, LogOut, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { store } from '../store';
import { useAuth } from '../App';
import { getPendingScan, setPendingScan, clearPendingScan } from '../pendingScan';

// Landing page for the QR the branch screen shows. The phone's camera opens
// this URL; we post the code straight through and report the result.
export default function Scan() {
  const { user } = useAuth();
  const location = useLocation();
  const [state, setState] = useState<'working' | 'done' | 'error'>('working');
  const [result, setResult] = useState<{ kind: 'IN' | 'OUT'; ts: number; unit: string } | null>(null);
  const [error, setError] = useState('');
  const submitted = useRef(false);

  // The code arrives in the query string; keep it across a login round-trip.
  // index.tsx moves the code out of the real query string into storage before
  // the router mounts; the in-hash form is still accepted as a fallback.
  //
  // Captured once, deliberately: the effect below clears the stored code as
  // soon as it has posted it, so re-reading it on every render would blank
  // `code` the moment the result arrives and drop us on the "no code found"
  // screen — hiding the real outcome, success or error alike.
  const [code] = useState(() => new URLSearchParams(location.search).get('c') || getPendingScan() || '');

  useEffect(() => {
    if (!user || !code || submitted.current) return;
    submitted.current = true;
    store.scanAttendance(code)
      .then((r) => {
        clearPendingScan();
        setResult({ kind: r.kind, ts: r.ts, unit: r.unit });
        setState('done');
      })
      .catch((e: any) => {
        clearPendingScan();
        // http() throws "HTTP <status> <path> <raw body>" — pull the server's
        // message out of the JSON body when there is one.
        const msg = String(e?.message || '');
        const brace = msg.indexOf('{');
        let text = 'Could not record that scan.';
        if (brace !== -1) {
          try { text = JSON.parse(msg.slice(brace)).error || text; } catch { /* keep default */ }
        }
        setError(text);
        setState('error');
      });
  }, [user, code]);

  // Not logged in yet — stash the code so the scan still completes after login.
  if (!user) {
    if (code) setPendingScan(code);
    return <Navigate to="/login" replace />;
  }

  if (!code) {
    return (
      <Shell>
        <XCircle size={56} className="text-rose-500" />
        <h1 className="text-2xl font-black text-gray-900">No code found</h1>
        <p className="text-sm font-bold text-gray-400 text-center">Scan the attendance QR with your camera.</p>
        <HomeLink />
      </Shell>
    );
  }

  if (state === 'working') {
    return (
      <Shell>
        <Loader2 size={56} className="text-blue-600 animate-spin" />
        <h1 className="text-2xl font-black text-gray-900">Recording...</h1>
      </Shell>
    );
  }

  if (state === 'error') {
    return (
      <Shell>
        <XCircle size={56} className="text-rose-500" />
        <h1 className="text-2xl font-black text-gray-900">Not recorded</h1>
        <p className="text-sm font-bold text-gray-500 text-center">{error}</p>
        <HomeLink />
      </Shell>
    );
  }

  const isIn = result!.kind === 'IN';
  return (
    <Shell>
      <div className={`w-24 h-24 rounded-[32px] flex items-center justify-center text-white shadow-xl ${isIn ? 'bg-emerald-600 shadow-emerald-100' : 'bg-gray-900'}`}>
        {isIn ? <LogIn size={44} /> : <LogOut size={44} />}
      </div>
      <div className="flex items-center gap-2">
        <CheckCircle2 size={18} className={isIn ? 'text-emerald-600' : 'text-gray-500'} />
        <h1 className="text-2xl font-black text-gray-900">{isIn ? 'Clocked in' : 'Clocked out'}</h1>
      </div>
      <p className="text-4xl font-black text-gray-900 tabular-nums">{format(new Date(result!.ts), 'p')}</p>
      <p className="text-xs font-black text-gray-400 uppercase tracking-widest">{result!.unit}</p>
      <HomeLink />
    </Shell>
  );
}

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
    <div className="bg-white rounded-[40px] shadow-xl border border-gray-100 p-10 w-full max-w-sm flex flex-col items-center gap-5">
      {children}
    </div>
  </div>
);

const HomeLink = () => (
  <Link to="/my-schedule" className="mt-2 text-[10px] font-black text-blue-600 uppercase tracking-widest hover:text-blue-800">
    Go to my schedule
  </Link>
);
