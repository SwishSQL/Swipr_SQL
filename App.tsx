
import React, { useState, useEffect, useRef, createContext, useContext } from 'react';
import { HashRouter, Routes, Route, Navigate, Link, useLocation, useParams, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Calendar, 
  Users as UsersIcon, 
  ArrowLeftRight, 
  LogOut, 
  Menu, 
  X,
  Users,
  FileText,
  History,
  PhoneCall,
  Headphones,
  KeyRound,
  Save,
  BarChart3,
  Bell,
  Moon,
  Sun,
  Building2,
  Award,
  Coffee,
  Camera,
  Trash2,
  QrCode,
  Languages,
  Thermometer,
  Gauge
} from 'lucide-react';
import { User, UserRole, AppNotification, roleLabel, unitOf } from './types';
import { store } from './store';
import { enablePushNotifications } from './push';
import { enableNativePush } from './nativePush';
import { LanguageProvider, useLanguage } from './i18n';
import { CallProvider, useCall, requestJoinCall } from './calling';
import CallOverlay from './CallOverlay';
import Avatar, { fileToAvatarDataUri } from './Avatar';
import LoginPage from './pages/LoginPage';
import { SystemSwitcher, rememberPage } from './SystemSwitcher';
import Dashboard from './pages/Dashboard';
import ScheduleManagement from './pages/ScheduleManagement';
import UserManagement from './pages/UserManagement';
import MySchedule from './pages/MySchedule';
import SwapRequests from './pages/SwapRequests';
import AllEmployees from './pages/AllEmployees';
import BranchSchedule from './pages/BranchSchedule';
import Evaluations from './pages/Evaluations';
import BreakMonitor from './pages/BreakMonitor';
import Attendance from './pages/Attendance';
import Scan from './pages/Scan';
import Requests from './pages/Requests';
import AuditLog from './pages/AuditLog';
import CallLog from './pages/CallLog';
import StaffDirectory from './pages/StaffDirectory';
import NotificationGate from './NotificationGate';
import Coverage from './pages/Coverage';
import SickDocuments from './pages/SickDocuments';
import AgentKpis from './pages/AgentKpis';

interface AuthContextType {
  user: User | null;
  login: (u: string, p: string) => Promise<boolean>;
  logout: () => void;
  updateUser: (u: User) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);
export const useAuth = () => useContext(AuthContext)!;

const SidebarItem: React.FC<{ to: string, icon: any, label: string, active: boolean, badge?: number, onClick?: () => void }> = ({ to, icon: Icon, label, active, badge, onClick }) => (
  <Link
    to={to}
    onClick={onClick}
    className={`flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-200 ${
      active
        ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20 translate-x-1'
        : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
    }`}
  >
    <Icon size={18} />
    <span className="font-semibold text-sm tracking-tight flex-1">{label}</span>
    {badge ? (
      <span className="min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-black shadow-lg shadow-rose-500/30">
        {badge > 99 ? '99+' : badge}
      </span>
    ) : null}
  </Link>
);

const ChangePasswordModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (next.length < 4) { setError('New password must be at least 4 characters.'); return; }
    if (next !== confirm) { setError('New passwords do not match.'); return; }
    setBusy(true);
    const ok = await store.changePassword(current, next);
    setBusy(false);
    if (ok) {
      alert('Password changed successfully.');
      onClose();
    } else {
      setError('Current password is incorrect.');
    }
  };

  const inputClass = "w-full px-5 py-3.5 rounded-2xl bg-gray-50 border border-gray-100 text-gray-900 text-sm font-medium outline-none focus:ring-4 focus:ring-blue-500/10 focus:bg-white placeholder:text-gray-400 transition-all";

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-md">
      <div className="bg-white rounded-[32px] shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="px-8 py-6 flex justify-between items-center border-b border-gray-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600 flex items-center justify-center text-white"><KeyRound size={20} /></div>
            <h2 className="text-lg font-black text-gray-900">Change Password</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-50 rounded-xl text-gray-400"><X size={22} /></button>
        </div>
        <form onSubmit={submit} className="p-8 space-y-4">
          {error && <div className="p-3 bg-rose-50 text-rose-600 rounded-xl text-xs font-black uppercase tracking-wide border border-rose-100">{error}</div>}
          <input type="password" placeholder="Current password" value={current} onChange={e => setCurrent(e.target.value)} className={inputClass} required />
          <input type="password" placeholder="New password" value={next} onChange={e => setNext(e.target.value)} className={inputClass} required />
          <input type="password" placeholder="Confirm new password" value={confirm} onChange={e => setConfirm(e.target.value)} className={inputClass} required />
          <button type="submit" disabled={busy} className="w-full flex items-center justify-center gap-2 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-blue-100 transition-all active:scale-95 disabled:opacity-50">
            <Save size={16} /> {busy ? 'Saving...' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  );
};

const PhotoModal: React.FC<{ user: User; onClose: () => void; onSaved: (u: User) => void }> = ({ user, onClose, onSaved }) => {
  const [preview, setPreview] = useState<string | null>(user.photoUrl || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const pickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      setPreview(await fileToAvatarDataUri(file));
    } catch (err: any) {
      setError(err?.message || 'Could not read that image.');
    }
    e.target.value = '';
  };

  const save = async () => {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      const updated = await store.updateMyPhoto(preview);
      onSaved(updated);
      onClose();
    } catch {
      setError('Could not upload that photo. Try a smaller image.');
    }
    setBusy(false);
  };

  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      const updated = await store.removeMyPhoto();
      onSaved(updated);
      onClose();
    } catch {
      setError('Could not remove your photo.');
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-md">
      <div className="bg-white rounded-[32px] shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="px-8 py-6 flex justify-between items-center border-b border-gray-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600 flex items-center justify-center text-white"><Camera size={20} /></div>
            <h2 className="text-lg font-black text-gray-900">Profile Photo</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-50 rounded-xl text-gray-400"><X size={22} /></button>
        </div>
        <div className="p-8 space-y-5">
          {error && <div className="p-3 bg-rose-50 text-rose-600 rounded-xl text-xs font-black uppercase tracking-wide border border-rose-100">{error}</div>}
          <div className="flex flex-col items-center gap-4">
            <Avatar
              name={user.name}
              photoUrl={preview || undefined}
              className="w-28 h-28 rounded-[28px] bg-blue-600/10 border-2 border-blue-100 flex items-center justify-center text-blue-600 font-black text-3xl uppercase overflow-hidden"
            />
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={pickFile} className="hidden" />
            <button
              onClick={() => fileInput.current?.click()}
              className="flex items-center gap-2 px-5 py-3 bg-gray-900 hover:bg-black text-white rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all active:scale-95"
            >
              <Camera size={14} /> Choose Photo
            </button>
          </div>
          <button
            onClick={save}
            disabled={busy || !preview}
            className="w-full flex items-center justify-center gap-2 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-blue-100 transition-all active:scale-95 disabled:opacity-50"
          >
            <Save size={16} /> {busy ? 'Saving...' : 'Save Photo'}
          </button>
          {user.photoUrl && (
            <button
              onClick={remove}
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 py-3 text-rose-500 hover:bg-rose-50 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50"
            >
              <Trash2 size={14} /> Remove Photo
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// What tapping "Answer" on an incoming-call push notification opens —
// hands the call id to the CallProvider (mounted above the router, so it
// isn't reachable via context here) and bounces to the dashboard, leaving
// the CallOverlay to take it from there.
const CallDeepLink: React.FC = () => {
  const { callId } = useParams<{ callId: string }>();
  const navigate = useNavigate();
  useEffect(() => {
    if (callId) requestJoinCall(callId);
    navigate('/', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId]);
  return null;
};

const timeAgo = (ts: number) => {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

let sharedAudioCtx: any = null;
const playBeep = () => {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    sharedAudioCtx = sharedAudioCtx || new Ctx();
    if (sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume();
    const o = sharedAudioCtx.createOscillator();
    const g = sharedAudioCtx.createGain();
    o.connect(g); g.connect(sharedAudioCtx.destination);
    o.type = 'sine'; o.frequency.value = 880;
    const t = sharedAudioCtx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.start(t); o.stop(t + 0.36);
  } catch { /* ignore */ }
};

const NotifBell: React.FC<{ data: { items: AppNotification[]; unread: number }, onOpen: () => void, mobile?: boolean }> = ({ data, onOpen, mobile }) => {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const toggle = () => { const next = !open; setOpen(next); if (next) onOpen(); };
  const dot = (type: string) => type === 'swap' ? 'bg-amber-500' : type === 'leave' ? 'bg-emerald-500' : type === 'break' ? 'bg-orange-500' : type === 'attendance' ? 'bg-violet-500' : 'bg-blue-500';
  return (
    <div className="relative">
      <button onClick={toggle} title={t('notifications.title')}
        className={`relative p-2 rounded-xl transition-colors ${mobile ? 'text-white hover:bg-white/10' : 'text-gray-400 hover:bg-gray-800/60 hover:text-white'}`}>
        <Bell size={mobile ? 22 : 20} />
        {data.unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-rose-500 text-white text-[9px] font-black shadow">
            {data.unread > 9 ? '9+' : data.unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[190]" onClick={() => setOpen(false)} />
          <div className="fixed z-[200] top-16 left-4 right-4 md:left-64 md:right-auto md:ml-3 md:w-96 bg-white rounded-[24px] shadow-2xl border border-gray-100 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-4 border-b border-gray-50">
              <h3 className="font-black text-gray-900 text-sm">{t('notifications.title')}</h3>
            </div>
            <div className="max-h-[60vh] overflow-y-auto hide-scrollbar divide-y divide-gray-50">
              {data.items.length === 0 ? (
                <p className="px-5 py-12 text-center text-gray-300 font-bold text-sm">{t('notifications.empty')}</p>
              ) : data.items.map(n => (
                <div key={n.id} className={`px-5 py-3.5 flex gap-3 ${n.read ? '' : 'bg-blue-50/30'}`}>
                  <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${dot(n.type)}`} />
                  <div className="min-w-0">
                    <p className="font-bold text-gray-900 text-sm leading-tight">{n.title}</p>
                    {n.body && <p className="text-xs text-gray-500 mt-0.5 break-words">{n.body}</p>}
                    <p className="text-[10px] font-bold text-gray-300 uppercase tracking-wide mt-1">{timeAgo(n.ts)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// Swipr <-> Quality switcher, shown only to people who have Quality access. The answer is cached for the tab so the
// sidebar does not jump on every reload.
const QualitySwitcher: React.FC = () => {
  const [ok, setOk] = useState(() => { try { return sessionStorage.getItem('qa:access') === '1'; } catch { return false; } });
  useEffect(() => {
    const token = localStorage.getItem('swipr_token');
    if (!token) return;
    fetch('/api/qa/me', { headers: { Authorization: 'Bearer ' + token } })
      .then(r => { setOk(r.ok); try { sessionStorage.setItem('qa:access', r.ok ? '1' : '0'); } catch { /* storage blocked */ } })
      .catch(() => {});
  }, []);
  if (!ok) return null;
  return <div className="px-4 pt-4"><SystemSwitcher current="swipr" /></div>;
};

const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout, updateUser } = useAuth();
  const { lang, toggleLang, t } = useLanguage();
  const location = useLocation();
  useEffect(() => { rememberPage('swipr', location.pathname + location.search); }, [location.pathname, location.search]);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showPhoto, setShowPhoto] = useState(false);
  const [badges, setBadges] = useState({ requests: 0, swaps: 0 });
  const [dark, setDark] = useState(() => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));

  const toggleTheme = () => {
    const el = document.documentElement;
    const next = !el.classList.contains('dark');
    el.classList.toggle('dark', next);
    try { localStorage.setItem('swipr_theme', next ? 'dark' : 'light'); } catch { /* ignore */ }
    setDark(next);
  };
  const [notifs, setNotifs] = useState<{ items: AppNotification[]; unread: number }>({ items: [], unread: 0 });
  const seenNotif = useRef<Set<string>>(new Set());
  const firstNotif = useRef(true);

  // In-app notifications: poll, beep + native popup on new ones.
  useEffect(() => {
    if (!user) return;
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then((perm) => {
        if (perm === 'granted') enablePushNotifications();
      }).catch(() => {});
    } else if ('Notification' in window && Notification.permission === 'granted') {
      enablePushNotifications();
    }
    // No-ops on the website — see nativePush.ts. Not gated on the web
    // Notification API above since the Android WebView doesn't implement it
    // the same way; Capacitor's own permission prompt handles that instead.
    enableNativePush();
    const unsub = store.subscribeToNotifications((data) => {
      setNotifs(data);
      const fresh = data.items.filter(i => !seenNotif.current.has(i.id) && !i.read);
      if (!firstNotif.current && fresh.length) {
        playBeep();
        try {
          if ('Notification' in window && Notification.permission === 'granted') {
            const n = fresh[0];
            new Notification(n.title, { body: n.body || '', icon: '/favicon.svg' });
          }
        } catch { /* ignore */ }
      }
      data.items.forEach(i => seenNotif.current.add(i.id));
      firstNotif.current = false;
    });
    return () => unsub();
  }, [user]);

  const markNotifsRead = async () => {
    if (notifs.unread === 0) return;
    try { await store.markNotificationsRead(); } catch { /* ignore */ }
    setNotifs(p => ({ items: p.items.map(i => ({ ...i, read: true })), unread: 0 }));
  };

  // Live counts of items awaiting this user's action, shown on the sidebar.
  useEffect(() => {
    if (!user) return;
    let users: User[] = [], leaves: any[] = [], swaps: any[] = [];
    const co = (user.companyName || '').trim().toLowerCase();
    const recompute = () => {
      let requests: number;
      if (user.role === UserRole.EMPLOYEE) {
        requests = leaves.filter(l => l.userId === user.id && l.status === 'PENDING').length;
      } else if (user.role === UserRole.ADMIN) {
        requests = leaves.filter(l => l.status === 'PENDING').length;
      } else {
        requests = leaves.filter(l => (l.companyName || '').trim().toLowerCase() === co && l.status === 'PENDING').length;
      }
      let swapCount: number;
      if (user.role === UserRole.EMPLOYEE) {
        swapCount = swaps.filter(s => s.targetId === user.id && s.status === 'PENDING_TARGET').length;
      } else if (user.role === UserRole.SUPERVISOR || user.role === UserRole.ADMIN) {
        swapCount = swaps.filter(s => s.status === 'PENDING_MANAGER').length;
      } else {
        const byId = (id: string) => users.find(u => u.id === id);
        swapCount = swaps.filter(s => {
          if (s.status !== 'PENDING_MANAGER') return false;
          const r = byId(s.requesterId), t = byId(s.targetId);
          return (r && (r.companyName || '').trim().toLowerCase() === co) || (t && (t.companyName || '').trim().toLowerCase() === co);
        }).length;
      }
      setBadges({ requests, swaps: swapCount });
    };
    const u1 = store.subscribeToUsers(d => { users = d; recompute(); });
    const u2 = store.subscribeToLeaveRequests(d => { leaves = d; recompute(); });
    const u3 = store.subscribeToSwaps(d => { swaps = d; recompute(); });
    return () => { u1(); u2(); u3(); };
  }, [user]);

  if (!user) return <Navigate to="/login" />;

  const badgeFor = (to: string) => to === '/requests' ? badges.requests : to === '/swaps' ? badges.swaps : 0;

  const menuItems = [
    // Call-centre agents already land here after sign-in ("/" is the
    // dashboard for everyone) — the entry lets them get back to it. The data
    // behind it is scoped server-side to their own department (/app-data).
    { to: '/', icon: LayoutDashboard, label: t('nav.dashboard'), roles: [UserRole.EMPLOYEE, UserRole.MANAGER, UserRole.SUPERVISOR, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.AREA_MANAGER, UserRole.OPERATION_MANAGER] },
    { to: '/schedule-manager', icon: Calendar, label: t('nav.scheduleManagement'), roles: [UserRole.MANAGER, UserRole.SUPERVISOR, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.AREA_MANAGER, UserRole.OPERATION_MANAGER] },
    { to: '/coverage', icon: BarChart3, label: t('nav.coverage'), roles: [UserRole.MANAGER, UserRole.SUPERVISOR, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.AREA_MANAGER, UserRole.OPERATION_MANAGER] },
    { to: '/users', icon: UsersIcon, label: t('nav.userManagement'), roles: [UserRole.MANAGER, UserRole.SUPERVISOR, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.AREA_MANAGER, UserRole.OPERATION_MANAGER] },
    { to: '/my-schedule', icon: Calendar, label: t('nav.mySchedule'), roles: [UserRole.EMPLOYEE, UserRole.BRANCH_EMPLOYEE, UserRole.BRANCH_MANAGER, UserRole.AREA_MANAGER, UserRole.OPERATION_MANAGER] },
    { to: '/all-employees', icon: Users, label: t('nav.allEmployees'), roles: [UserRole.EMPLOYEE, UserRole.SUPERVISOR, UserRole.ADMIN, UserRole.BRANCH_EMPLOYEE, UserRole.BRANCH_MANAGER, UserRole.AREA_MANAGER, UserRole.OPERATION_MANAGER] },
    // Company-wide branch directory — visible to every account.
    { to: '/branch-schedule', icon: Building2, label: t('nav.branchSchedule'), roles: Object.values(UserRole).filter(r => r !== UserRole.BRANCH_EMPLOYEE) },
    // The reverse of Branch Schedule: lets branch staff find and call the
    // call-center / technical side, who could previously only call them.
    { to: '/staff-directory', icon: Headphones, label: t('nav.staffDirectory'), roles: [UserRole.BRANCH_EMPLOYEE, UserRole.BRANCH_MANAGER, UserRole.AREA_MANAGER, UserRole.OPERATION_MANAGER] },
    // Employee of the Month scoring — branch managers score, branch employees view their own.
    { to: '/evaluations', icon: Award, label: t('nav.evaluations'), roles: [UserRole.BRANCH_EMPLOYEE, UserRole.BRANCH_MANAGER, UserRole.AREA_MANAGER, UserRole.OPERATION_MANAGER, UserRole.ADMIN] },
    // Call-centre agent KPIs from XonTel — leads see their department, Admin all.
    { to: '/agent-kpis', icon: Gauge, label: t('nav.agentKpis'), roles: [UserRole.MANAGER, UserRole.SUPERVISOR, UserRole.ADMIN] },
    { to: '/breaks', icon: Coffee, label: t('nav.liveBreaks'), roles: [UserRole.BRANCH_MANAGER, UserRole.MANAGER, UserRole.SUPERVISOR, UserRole.ADMIN] },
    { to: '/attendance', icon: QrCode, label: t('nav.attendance'), roles: [UserRole.BRANCH_EMPLOYEE, UserRole.BRANCH_MANAGER, UserRole.EMPLOYEE, UserRole.MANAGER, UserRole.SUPERVISOR, UserRole.ADMIN] },
    { to: '/requests', icon: FileText, label: t('nav.requests'), roles: [UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.SUPERVISOR, UserRole.ADMIN] },
    { to: '/swaps', icon: ArrowLeftRight, label: t('nav.swaps'), roles: [UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.SUPERVISOR, UserRole.ADMIN] },
    // Medical reports are Admin-only by design (plus the uploader, on My Schedule).
    { to: '/sick-docs', icon: Thermometer, label: t('nav.sickDocs'), roles: [UserRole.ADMIN] },
    { to: '/audit', icon: History, label: t('nav.audit'), roles: [UserRole.ADMIN] },
    { to: '/call-log', icon: PhoneCall, label: t('nav.callLog'), roles: [UserRole.ADMIN] },
  ].filter(item => item.roles.includes(user.role));

  return (
    <div className="flex h-screen bg-[#F8FAFC] overflow-hidden">
      {/* Overlay for mobile sidebar */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-[#0F172A] text-white flex flex-col transform transition-transform duration-300 md:relative md:translate-x-0 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <QualitySwitcher />
        <div className="p-6">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center space-x-3 min-w-0">
              <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center font-black text-xl shadow-xl shadow-blue-600/30 shrink-0">SS</div>
              <div className="min-w-0">
                <h1 className="text-sm font-black tracking-tight leading-none uppercase">{t('app.name')}</h1>
                <p className="text-[9px] text-gray-500 font-bold uppercase tracking-widest mt-1">{t('app.tagline')}</p>
              </div>
            </div>
            {/* Only the bell lives up here — the sidebar is 256px wide and a
                third control pushed the bell off the edge. Theme and language
                sit with the other per-user preferences at the bottom. */}
            <div className="flex items-center gap-1 shrink-0">
              <NotifBell data={notifs} onOpen={markNotifsRead} />
              <button onClick={() => setIsMobileMenuOpen(false)} className="md:hidden text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-1.5 overflow-y-auto hide-scrollbar">
          <p className="px-4 text-[10px] font-black text-gray-500 uppercase tracking-[0.25em] mb-4">{t('nav.section')}</p>
          {menuItems.map(item => (
            <SidebarItem
              key={item.to}
              to={item.to}
              icon={item.icon}
              label={item.label}
              active={location.pathname === item.to}
              badge={badgeFor(item.to)}
              onClick={() => setIsMobileMenuOpen(false)}
            />
          ))}
        </nav>

        {/* Bottom Section - compact */}
        <div className="p-3 border-t border-gray-800/50 space-y-2">
          <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl bg-gray-900/40 border border-gray-800/40">
            <button onClick={() => setShowPhoto(true)} title="Change your photo" className="relative shrink-0 group">
              <Avatar
                name={user.name}
                photoUrl={user.photoUrl}
                className="w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 flex items-center justify-center text-blue-500 font-black uppercase text-sm overflow-hidden"
              />
              <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-blue-600 border-2 border-[#0F172A] flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera size={9} />
              </span>
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-white font-bold truncate text-[13px] leading-tight">{user.name}</p>
              <p className="text-[9px] uppercase tracking-wider font-bold text-gray-500 truncate">{user.jobTitle || roleLabel(user.role)} · {unitOf(user) || t('sidebar.corporate')}</p>
            </div>
          </div>

          {/* Per-user preferences: language and theme. */}
          <div className="flex items-center gap-2">
            <button
              onClick={toggleLang}
              title={t('toggle.language')}
              className="flex-1 flex items-center justify-center gap-2 px-2 py-2.5 text-gray-400 hover:bg-gray-800/50 hover:text-gray-200 rounded-xl transition-all border border-transparent hover:border-gray-700/50 active:scale-95"
            >
              <Languages size={15} />
              <span className="text-[10px] font-black uppercase tracking-widest">{lang === 'en' ? 'العربية' : 'English'}</span>
            </button>
            <button
              onClick={toggleTheme}
              title={t('toggle.theme')}
              className="px-3 py-2.5 text-gray-400 hover:bg-gray-800/50 hover:text-gray-200 rounded-xl transition-all border border-transparent hover:border-gray-700/50 active:scale-95 shrink-0"
            >
              {dark ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowChangePassword(true)}
              title={t('sidebar.password')}
              className="flex-1 flex items-center justify-center gap-2 px-2 py-2.5 text-gray-400 hover:bg-gray-800/50 hover:text-gray-200 rounded-xl transition-all border border-transparent hover:border-gray-700/50 active:scale-95"
            >
              <KeyRound size={15} />
              <span className="text-[10px] font-black uppercase tracking-widest">{t('sidebar.password')}</span>
            </button>
            <button
              onClick={logout}
              title={t('sidebar.logout')}
              className="flex-1 flex items-center justify-center gap-2 px-2 py-2.5 text-rose-400 hover:bg-rose-500/10 rounded-xl transition-all border border-transparent hover:border-rose-500/20 active:scale-95"
            >
              <LogOut size={16} />
              <span className="text-[10px] font-black uppercase tracking-widest">{t('sidebar.logout')}</span>
            </button>
          </div>

          <div className="flex items-center justify-center gap-1.5 pt-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-[8px] font-black text-emerald-400/70 uppercase tracking-[0.2em]">{t('sidebar.systemOnline')} v1.1</span>
          </div>
        </div>
      </aside>

      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
      {showPhoto && <PhotoModal user={user} onClose={() => setShowPhoto(false)} onSaved={updateUser} />}

      <div className="flex flex-col flex-1 overflow-hidden">
        <header className="md:hidden flex items-center justify-between p-4 bg-[#0F172A] text-white">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-black shrink-0">SS</div>
            <h1 className="text-lg font-black text-blue-400 tracking-tighter uppercase truncate">{t('app.name')}</h1>
          </div>
          {/* Language lives in the sidebar drawer on mobile — this bar is
              already tight on a narrow phone. */}
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={toggleTheme} title={t('toggle.theme')} className="p-2 rounded-xl text-white hover:bg-white/10 transition-colors">
              {dark ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <NotifBell data={notifs} onOpen={markNotifsRead} mobile />
            <button onClick={() => setIsMobileMenuOpen(true)}>
              <Menu size={24} />
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-12 bg-[#F8FAFC]">
          <div className="max-w-[1200px] mx-auto">
            <NotificationGate />
          </div>
          {children}
        </main>
      </div>
    </div>
  );
};

export default function App() {
  // Kept in localStorage so closing the tab / backgrounding the phone browser
  // doesn't sign the user out — see the matching note in store.ts.
  const [user, setUser] = useState<User | null>(() => {
    try {
      const legacy = sessionStorage.getItem('swipr_auth');
      if (legacy) {
        localStorage.setItem('swipr_auth', legacy);
        sessionStorage.removeItem('swipr_auth');
      }
      const saved = localStorage.getItem('swipr_auth');
      return saved ? JSON.parse(saved) : null;
    } catch {
      // Storage unreadable or holding corrupt JSON — the token may still be
      // good, so let the restore below decide rather than forcing a login.
      return null;
    }
  });

  // A phone can lose the cached profile on its own while the token survives
  // (separate storage bucket for a home-screen app, storage eviction). Rebuild
  // the session from the token instead of showing the login screen.
  const [restoring, setRestoring] = useState(() => !user && store.hasToken());
  useEffect(() => {
    if (!restoring) return;
    let alive = true;
    store.getMe()
      .then((me) => {
        if (!alive) return;
        if (me) {
          setUser(me);
          try { localStorage.setItem('swipr_auth', JSON.stringify(me)); } catch { /* ignore */ }
        }
      })
      .finally(() => { if (alive) setRestoring(false); });
    return () => { alive = false; };
  }, [restoring]);

  const login = async (u: string, p: string) => {
    const found = await store.login(u, p);
    if (found) {
      setUser(found);
      localStorage.setItem('swipr_auth', JSON.stringify(found));
      return true;
    }
    return false;
  };

  const logout = () => {
    setUser(null);
    store.logout();
    localStorage.removeItem('swipr_auth');
  };

  // Refreshes the cached session user (e.g. after the profile photo changes)
  // without a re-login.
  const updateUser = (u: User) => {
    setUser(u);
    localStorage.setItem('swipr_auth', JSON.stringify(u));
  };

  // Showing the login form while the session is still being restored would be
  // the very bug this fixes, briefly.
  if (restoring) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#F8FAFC]">
        <div className="w-10 h-10 rounded-full border-[3px] border-gray-200 border-t-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <LanguageProvider>
    <AuthContext.Provider value={{ user, login, logout, updateUser }}>
    <CallProvider userId={user?.id ?? null}>
      <HashRouter>
        <Routes>
          {/* Being signed in on the login route is a real state, not a stray
              one: the hash survives a reload, so anyone bounced here once came
              back to the form even after the session was restored. */}
          <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
          <Route path="/" element={<AppLayout children={<Dashboard />} />} />
          <Route path="/schedule-manager" element={<AppLayout children={<ScheduleManagement />} />} />
          <Route path="/users" element={<AppLayout children={<UserManagement />} />} />
          <Route path="/my-schedule" element={<AppLayout children={<MySchedule />} />} />
          <Route path="/all-employees" element={<AppLayout children={<AllEmployees />} />} />
          <Route path="/branch-schedule" element={<AppLayout children={<BranchSchedule />} />} />
          <Route path="/evaluations" element={<AppLayout children={<Evaluations />} />} />
          <Route path="/breaks" element={<AppLayout children={<BreakMonitor />} />} />
          <Route path="/agent-kpis" element={<AppLayout children={[UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPERVISOR].includes(user?.role as UserRole) ? <AgentKpis /> : <Navigate to="/" replace />} />} />
          <Route path="/sick-docs" element={<AppLayout children={user?.role === UserRole.ADMIN ? <SickDocuments /> : <Navigate to="/" replace />} />} />
          <Route path="/attendance" element={<AppLayout children={<Attendance />} />} />
          {/* Standalone (no sidebar) — this is what the QR opens on a phone. */}
          <Route path="/scan" element={<Scan />} />
          {/* Standalone — this is what tapping "Answer" on an incoming-call notification opens. */}
          <Route path="/call/:callId" element={<CallDeepLink />} />
          <Route path="/swaps" element={<AppLayout children={<SwapRequests />} />} />
          <Route path="/requests" element={<AppLayout children={<Requests />} />} />
          <Route path="/audit" element={<AppLayout children={<AuditLog />} />} />
          <Route path="/call-log" element={<AppLayout children={<CallLog />} />} />
          <Route path="/staff-directory" element={<AppLayout children={<StaffDirectory />} />} />
          <Route path="/coverage" element={<AppLayout children={<Coverage />} />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </HashRouter>
      <CallOverlay />
    </CallProvider>
    </AuthContext.Provider>
    </LanguageProvider>
  );
}
