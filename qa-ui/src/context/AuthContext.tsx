import React, { createContext, useContext, useState, useEffect } from 'react';
import { User } from '../types';

// Inside Swipr there is no separate QA login: the Swipr session (swipr_token) is the identity,
// and GET /api/qa/me says who that person is in the Quality module.
interface AuthContextType {
  user: User | null;
  login: (userData: { token: string; user: User; session_id?: number | null }) => void;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const HEARTBEAT_MS = 2 * 60 * 1000;
const SWIPR_HOME = '/';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionId, setSessionId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!localStorage.getItem('swipr_token')) throw new Error('not signed in');
        const r = await fetch('/api/me');
        if (!r.ok) throw new Error(String(r.status));
        const me = await r.json();
        if (cancelled) return;
        localStorage.setItem('user', JSON.stringify(me));
        setUser(me);
        try {
          const s = await fetch('/api/sessions/start', { method: 'POST' });
          if (s.ok) setSessionId((await s.json()).session_id ?? null);
        } catch { /* duration tracking is best-effort */ }
      } catch {
        if (!cancelled) window.location.href = SWIPR_HOME;      // not signed in to Swipr (or no Quality access)
        return;
      }
      if (!cancelled) setIsLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!user || !sessionId) return;
    let cancelled = false;
    const ping = async () => {
      if (cancelled || document.hidden) return;
      try {
        await fetch('/api/sessions/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: sessionId }) });
      } catch {}
    };
    ping();
    const id = setInterval(ping, HEARTBEAT_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [user, sessionId]);

  const login = () => {};      // sign-in happens in Swipr

  // One login for Swipr and Quality, so logging out here signs out of both — the same steps as Swipr's own logout
  // (store.ts setToken(null) + App.tsx): drop the token from localStorage AND its cookie mirror, and the cached user.
  const logout = () => {
    if (sessionId) fetch('/api/sessions/logout', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: sessionId }) }).catch(() => {});
    try {
      localStorage.removeItem('user');
      localStorage.removeItem('swipr_token');
      localStorage.removeItem('swipr_auth');
      ['qa:access', 'qa:lastPath', 'swipr:lastPath'].forEach((k) => sessionStorage.removeItem(k));
    } catch { /* storage blocked */ }
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `swipr_token=; path=/; max-age=0; SameSite=Lax${secure}`;
    window.location.href = SWIPR_HOME + '#/login';
  };

  return <AuthContext.Provider value={{ user, login, logout, isLoading }}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
