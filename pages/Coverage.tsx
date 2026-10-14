import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../App';
import { useLanguage } from '../i18n';
import { store } from '../store';
import { User, UserRole, ScheduleDay, DayType, isBranchRole, unitOf } from '../types';
import { companyGroup } from '../companies';
import { BRAND_NAMES, BRANDS } from '../brands';
import { format, addDays } from 'date-fns';
import {
  BarChart3, ShieldCheck, Building2, AlertTriangle, Users as UsersIcon,
  TrendingUp, TrendingDown, Coffee, Home, Clock, CalendarDays, Activity, Calendar,
  LogIn, LogOut
} from 'lucide-react';

const parseMinutes = (t?: string) => {
  if (!t) return null;
  const p = t.split(':');
  if (p.length < 2) return null;
  const h = parseInt(p[0], 10), m = parseInt(p[1], 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
};

const addDaysStr = (dateStr: string, n: number) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};

const WORKING_TYPES = [DayType.NORMAL_SHIFT, DayType.WORK_FROM_HOME, DayType.TASK, DayType.TARDY, DayType.EARLY_LEAVE, DayType.DELAY_WAS_PERMISSION, DayType.CANCEL_OFF];
const LEAVE_TYPES = [DayType.ANNUAL_LEAVE, DayType.PUBLIC_HOLIDAY, DayType.SICK, DayType.TRAINING];

const STATUS_META: { key: DayType; label: string; bar: string; text: string }[] = [
  { key: DayType.NORMAL_SHIFT, label: 'On Shift', bar: 'bg-blue-500', text: 'text-blue-600' },
  { key: DayType.WORK_FROM_HOME, label: 'Work From Home', bar: 'bg-indigo-500', text: 'text-indigo-600' },
  { key: DayType.TASK, label: 'Task', bar: 'bg-purple-500', text: 'text-purple-600' },
  { key: DayType.TARDY, label: 'Late', bar: 'bg-amber-500', text: 'text-amber-600' },
  { key: DayType.EARLY_LEAVE, label: 'Leave with Permission', bar: 'bg-orange-500', text: 'text-orange-600' },
  { key: DayType.DELAY_WAS_PERMISSION, label: 'Late with Permission', bar: 'bg-teal-500', text: 'text-teal-600' },
  { key: DayType.ANNUAL_LEAVE, label: 'Annual Leave', bar: 'bg-emerald-500', text: 'text-emerald-600' },
  { key: DayType.PUBLIC_HOLIDAY, label: 'Public Holiday', bar: 'bg-green-500', text: 'text-green-600' },
  { key: DayType.SICK, label: 'Sick', bar: 'bg-rose-500', text: 'text-rose-600' },
  { key: DayType.TRAINING, label: 'Training', bar: 'bg-fuchsia-500', text: 'text-fuchsia-600' },
  { key: DayType.ABSENT, label: 'Absent', bar: 'bg-gray-800', text: 'text-gray-800' },
  { key: DayType.DAY_OFF, label: 'Day Off', bar: 'bg-gray-300', text: 'text-gray-400' },
  { key: DayType.OFF_SET, label: 'Off Set', bar: 'bg-slate-400', text: 'text-slate-500' },
  { key: DayType.CANCEL_OFF, label: 'Cancel Off', bar: 'bg-amber-500', text: 'text-amber-600' },
];

export default function Coverage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [employees, setEmployees] = useState<User[]>([]);
  const [schedules, setSchedules] = useState<Record<string, Record<string, ScheduleDay>>>({});
  const [mode, setMode] = useState<'day' | 'range'>('day');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [rangeStart, setRangeStart] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [rangeEnd, setRangeEnd] = useState(format(addDays(new Date(), 6), 'yyyy-MM-dd'));
  const [company, setCompany] = useState('All');
  const [threshold, setThreshold] = useState(2);
  const [now, setNow] = useState(new Date());

  // Field-operations managers see coverage for their scoped branches.
  const branchViewer = isBranchRole(user?.role) && user?.role !== UserRole.BRANCH_EMPLOYEE;
  const isMgmt = user?.role === UserRole.MANAGER || user?.role === UserRole.SUPERVISOR || user?.role === UserRole.ADMIN || branchViewer;

  // Grouping unit: keyed off the EMPLOYEE's own role, not the viewer's, so
  // it works uniformly whether the viewer is a branch manager (only ever
  // sees branch-role employees) or the admin (sees both hierarchies at
  // once) — department group for call-center staff, "BRAND · Branch" for
  // field-operations staff.
  const groupOf = (e: User) => (isBranchRole(e.role) ? (unitOf(e) || '—') : companyGroup(e.companyName));

  // Admin-only cascading Brand → Branch filter over the field-operations hierarchy.
  const [selectedBrand, setSelectedBrand] = useState('All');
  const [selectedBranch, setSelectedBranch] = useState('All');

  // Live clock for the real-time panels (refreshes every 30s).
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!isMgmt) return;
    const u1 = store.subscribeToUsers((users) => {
      // Branch managers analyse everyone the server scoped to them (their
      // branches' staff, minus themselves); the admin's workforce spans
      // both hierarchies (department + branch employees).
      let list = branchViewer
        ? users.filter(u => isBranchRole(u.role) && u.id !== user?.id)
        : user?.role === UserRole.ADMIN
        ? users.filter(u => u.role === UserRole.EMPLOYEE || u.role === UserRole.BRANCH_EMPLOYEE)
        : users.filter(u => u.role === UserRole.EMPLOYEE);
      if (user?.role === UserRole.MANAGER) {
        const managed = user.managedDepartments || [];
        list = list.filter(u => u.companyName === user.companyName || managed.includes(u.companyName || ''));
      }
      setEmployees(list);
    });
    const u2 = store.subscribeToSchedules(setSchedules);
    return () => { u1(); u2(); };
  }, [user, isMgmt]);

  const companies = useMemo(() => {
    const set = new Set<string>();
    employees.forEach(e => { const g = groupOf(e); if (g && g !== '—') set.add(g); });
    return ['All', ...Array.from(set).sort()];
  }, [employees, branchViewer]);

  const scoped = useMemo(() => {
    if (company !== 'All') return employees.filter(e => groupOf(e) === company);
    if (selectedBrand !== 'All') {
      return employees.filter(e => (e.brand || '').trim().toLowerCase() === selectedBrand.toLowerCase() &&
        (selectedBranch === 'All' || (e.branch || '').trim().toLowerCase() === selectedBranch.toLowerCase()));
    }
    return employees;
  }, [employees, company, selectedBrand, selectedBranch, branchViewer]);

  // Resolve the list of dates being analysed (1 for day mode, N for range).
  const dates = useMemo(() => {
    if (mode === 'day') return [date];
    if (!rangeStart || !rangeEnd || rangeStart > rangeEnd) return [rangeStart || date];
    const out: string[] = [];
    let cur = rangeStart, guard = 0;
    while (cur <= rangeEnd && guard < 92) { out.push(cur); cur = addDaysStr(cur, 1); guard++; }
    return out.length ? out : [date];
  }, [mode, date, rangeStart, rangeEnd]);

  const A = useMemo(() => {
    const days = dates.length || 1;
    const grossSum = new Array(24).fill(0);
    const breakSum = new Array(24).fill(0);
    const startDist = new Array(24).fill(0);
    const statusCounts: Record<string, number> = {};
    STATUS_META.forEach(s => (statusCounts[s.key] = 0));
    const byCompany: Record<string, { total: number; onShiftDays: number; offDays: number; leaveDays: number; absentDays: number }> = {};
    const offAgg: Record<string, { name: string; type: DayType; count: number }> = {};
    let shiftDays = 0;

    scoped.forEach(emp => {
      const co = groupOf(emp);
      if (!byCompany[co]) byCompany[co] = { total: 0, onShiftDays: 0, offDays: 0, leaveDays: 0, absentDays: 0 };
      byCompany[co].total++;
    });

    dates.forEach(ds => {
      scoped.forEach(emp => {
        const co = groupOf(emp);
        const day = schedules[emp.id]?.[ds];
        const type = day?.type;
        const isWorking = !!(type && WORKING_TYPES.includes(type) && day?.shift);

        if (!day || type === DayType.DAY_OFF || type === DayType.OFF_SET) {
          // Off Set behaves like Day Off for coverage purposes, but keeps its own tally.
          statusCounts[type === DayType.OFF_SET ? DayType.OFF_SET : DayType.DAY_OFF]++;
          byCompany[co].offDays++;
        } else {
          statusCounts[type] = (statusCounts[type] || 0) + 1;
        }

        if (type === DayType.ABSENT) {
          byCompany[co].absentDays++;
          const k = emp.id + '|' + type; offAgg[k] = offAgg[k] || { name: emp.name, type, count: 0 }; offAgg[k].count++;
        }
        if (type && LEAVE_TYPES.includes(type)) {
          byCompany[co].leaveDays++;
          const k = emp.id + '|' + type; offAgg[k] = offAgg[k] || { name: emp.name, type, count: 0 }; offAgg[k].count++;
        }

        if (isWorking && day!.shift) {
          const start = parseMinutes(day!.shift.startTime);
          let end = parseMinutes(day!.shift.endTime);
          if (start === null || end === null) return;
          if (end <= start) end += 1440;
          shiftDays++;
          byCompany[co].onShiftDays++;
          startDist[Math.floor(start / 60) % 24]++;
          for (let h = 0; h < 24; h++) {
            const hs = h * 60, he = (h + 1) * 60;
            if ((start < he && end > hs) || (start - 1440 < he && end - 1440 > hs)) grossSum[h]++;
          }
          const breakHours = new Set<number>();
          (day!.shift.breaks || []).forEach(b => {
            const bs = parseMinutes(b?.start), be = parseMinutes(b?.end);
            if (bs === null || be === null || be <= bs) return;
            for (let h = 0; h < 24; h++) { const hs = h * 60, he = (h + 1) * 60; if (bs < he && be > hs) breakHours.add(h); }
          });
          breakHours.forEach(h => breakSum[h]++);
        }
      });
    });

    const grossAvg = grossSum.map(s => s / days);
    const breakAvg = breakSum.map(s => s / days);
    const netAvg = grossAvg.map((g, h) => Math.max(0, g - breakAvg[h]));
    const activeNet = netAvg.filter(n => n > 0);
    const understaffed = netAvg.map((n, h) => ({ n, h, gross: grossAvg[h] })).filter(x => x.gross > 0 && x.n < threshold);

    // Trend: day mode -> the containing week; range mode -> the range days.
    let trendDates: string[];
    if (mode === 'day') {
      const [yy, mm, dd] = date.split('-').map(Number);
      const sel = new Date(yy, mm - 1, dd);
      const ws = addDays(sel, -sel.getDay());
      trendDates = Array.from({ length: 7 }, (_, i) => format(addDays(ws, i), 'yyyy-MM-dd'));
    } else {
      trendDates = dates;
    }
    const trend = trendDates.map(ds => {
      let count = 0;
      scoped.forEach(emp => { const d = schedules[emp.id]?.[ds]; if (d && d.type && WORKING_TYPES.includes(d.type) && d.shift) count++; });
      const [yy, mm, dd] = ds.split('-').map(Number);
      const dt = new Date(yy, mm - 1, dd);
      return { ds, count, label: format(dt, 'EEE'), dayNum: format(dt, 'd'), isSel: mode === 'day' && ds === date };
    });

    return {
      days, grossAvg, breakAvg, netAvg, startDist, statusCounts, byCompany,
      offList: Object.values(offAgg).sort((a, b) => b.count - a.count),
      shiftDays, trend,
      peak: grossAvg.length ? Math.max(...grossAvg) : 0,
      low: activeNet.length ? Math.min(...activeNet) : 0,
      breakPeak: breakAvg.length ? Math.max(...breakAvg) : 0,
      understaffed, total: scoped.length,
    };
  }, [scoped, schedules, dates, mode, date, threshold]);

  // Real-time view (current time vs today's shift windows).
  const liveNow = useMemo(() => {
    const today = format(now, 'yyyy-MM-dd');
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const working: any[] = [], onBreak: any[] = [], startingSoon: any[] = [], justEnded: any[] = [];
    scoped.forEach(emp => {
      const day = schedules[emp.id]?.[today];
      if (!day || !day.type || !WORKING_TYPES.includes(day.type) || !day.shift) return;
      const start = parseMinutes(day.shift.startTime);
      const endRaw = parseMinutes(day.shift.endTime);
      if (start === null || endRaw === null) return;
      let end = endRaw;
      if (end <= start) end += 1440;

      const rec = {
        id: emp.id, name: emp.name, company: unitOf(emp), jobTitle: emp.jobTitle,
        shift: `${day.shift.startTime} - ${day.shift.endTime}`,
        wfh: day.type === DayType.WORK_FROM_HOME,
        startAt: day.shift.startTime, endAt: day.shift.endTime, breakEnd: null as string | null,
      };

      const inShift = (nowMin >= start && nowMin < end) || (nowMin + 1440 >= start && nowMin + 1440 < end);
      if (inShift) {
        let brk: any = null;
        (day.shift.breaks || []).forEach(b => {
          const bs = parseMinutes(b?.start), be = parseMinutes(b?.end);
          if (bs === null || be === null) return;
          if (nowMin >= bs && nowMin < be) brk = b;
        });
        if (brk) onBreak.push({ ...rec, breakEnd: brk.end }); else working.push(rec);
        return;
      }

      // Starting within the next 60 minutes (handles the midnight wrap).
      const startsIn = (start > nowMin && start <= nowMin + 60) ? start - nowMin
        : (start + 1440 > nowMin && start + 1440 <= nowMin + 60) ? start + 1440 - nowMin : null;
      if (startsIn !== null) { startingSoon.push({ ...rec, mins: startsIn }); return; }

      // Ended within the last 60 minutes.
      const endedAgo = (endRaw <= nowMin && endRaw > nowMin - 60) ? nowMin - endRaw
        : (endRaw - 1440 <= nowMin && endRaw - 1440 > nowMin - 60) ? nowMin - (endRaw - 1440) : null;
      if (endedAgo !== null) { justEnded.push({ ...rec, mins: endedAgo }); return; }
    });
    startingSoon.sort((a, b) => a.mins - b.mins);
    justEnded.sort((a, b) => a.mins - b.mins);
    return { working, onBreak, startingSoon, justEnded };
  }, [scoped, schedules, now]);

  // Human label for whichever scope (department, or brand/branch) is active.
  const activeScopeLabel = company !== 'All'
    ? company
    : selectedBrand !== 'All'
    ? (selectedBranch !== 'All' ? `${selectedBrand} · ${selectedBranch}` : selectedBrand)
    : 'All';

  const days = A.days;
  const isRange = days > 1;
  const fmt = (n: number) => isRange ? Math.round(n * 10) / 10 : Math.round(n);
  const maxGross = Math.max(A.peak, 1);
  const maxTrend = Math.max(...A.trend.map(t => t.count), 1);
  const maxStart = Math.max(...A.startDist, 1);
  const periodLabel = isRange
    ? `${format(new Date(dates[0].replace(/-/g, '/')), 'MMM d')} – ${format(new Date(dates[dates.length - 1].replace(/-/g, '/')), 'MMM d')} · ${days} days`
    : format(new Date(date.replace(/-/g, '/')), 'EEE, MMM d');

  if (!isMgmt) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <h2 className="text-xl font-black text-gray-400 uppercase tracking-widest">{t('coverage.managersOnly')}</h2>
      </div>
    );
  }

  const Stat = ({ icon: Icon, label, value, tone }: any) => (
    <div className={`p-5 rounded-3xl border shadow-sm ${tone || 'bg-white border-gray-100'}`}>
      <div className="flex items-center gap-2 mb-2"><Icon size={18} className="text-gray-400" /><span className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</span></div>
      <p className="text-3xl font-black text-gray-900">{value}</p>
    </div>
  );

  const inputBox = "px-4 py-3 bg-white border border-gray-100 rounded-2xl text-xs font-black uppercase tracking-widest outline-none focus:ring-4 focus:ring-blue-500/10 cursor-pointer shadow-sm";

  return (
    <div className="max-w-[1280px] mx-auto space-y-8 pb-24 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-black text-gray-900 tracking-tight">{t('coverage.title')}</h1>
            {(user?.role === UserRole.SUPERVISOR || user?.role === UserRole.ADMIN) && (
              <span className="flex items-center gap-1.5 px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-[10px] font-black uppercase tracking-widest border border-purple-200">
                <ShieldCheck size={12} /> {user?.role === UserRole.ADMIN ? 'Admin Access' : 'Supervisor Access'}
              </span>
            )}
          </div>
          <p className="text-gray-400 font-medium text-sm mt-1">
            {isRange ? `Averaged over ${days} days · ${periodLabel}` : `Full workforce analysis for ${periodLabel}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Day / Range toggle */}
          <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-2xl">
            <button onClick={() => setMode('day')} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${mode === 'day' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400'}`}>Day</button>
            <button onClick={() => setMode('range')} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${mode === 'range' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400'}`}>Range</button>
          </div>

          {mode === 'day' ? (
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputBox} />
          ) : (
            <div className="flex items-center gap-1.5 px-2 py-1.5 bg-white border border-gray-100 rounded-2xl shadow-sm">
              <Calendar size={14} className="text-blue-500 ml-1" />
              <input type="date" value={rangeStart} max={rangeEnd} onChange={e => setRangeStart(e.target.value)} className="bg-transparent text-[10px] font-black uppercase outline-none w-[110px] cursor-pointer" />
              <span className="text-gray-300 font-bold">→</span>
              <input type="date" value={rangeEnd} min={rangeStart} onChange={e => setRangeEnd(e.target.value)} className="bg-transparent text-[10px] font-black uppercase outline-none w-[110px] cursor-pointer" />
            </div>
          )}

          <div className="relative">
            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-500 pointer-events-none" size={16} />
            <select
              value={company}
              onChange={e => {
                setCompany(e.target.value);
                if (e.target.value !== 'All') { setSelectedBrand('All'); setSelectedBranch('All'); }
              }}
              className="pl-9 pr-8 py-3 bg-white border border-gray-100 rounded-2xl text-[10px] font-black uppercase tracking-widest outline-none focus:ring-4 focus:ring-blue-500/10 appearance-none cursor-pointer shadow-sm"
            >
              {companies.map(c => <option key={c} value={c}>{c === 'All' ? (branchViewer ? 'All Branches' : 'All Companies') : c}</option>)}
            </select>
          </div>
          {user?.role === UserRole.ADMIN && (
            <>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-purple-500 pointer-events-none" size={16} />
                <select
                  value={selectedBrand}
                  onChange={e => {
                    setSelectedBrand(e.target.value);
                    setSelectedBranch('All');
                    if (e.target.value !== 'All') setCompany('All');
                  }}
                  className="pl-9 pr-8 py-3 bg-white border border-gray-100 rounded-2xl text-[10px] font-black uppercase tracking-widest outline-none focus:ring-4 focus:ring-purple-500/10 appearance-none cursor-pointer shadow-sm"
                >
                  <option value="All">All Brands</option>
                  {BRAND_NAMES.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              {selectedBrand !== 'All' && (
                <div className="relative">
                  <select
                    value={selectedBranch}
                    onChange={e => setSelectedBranch(e.target.value)}
                    className="pl-4 pr-8 py-3 bg-white border border-gray-100 rounded-2xl text-[10px] font-black uppercase tracking-widest outline-none focus:ring-4 focus:ring-purple-500/10 appearance-none cursor-pointer shadow-sm"
                  >
                    <option value="All">All Branches</option>
                    {(BRANDS[selectedBrand] || []).map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
              )}
            </>
          )}
          <div className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-100 rounded-2xl shadow-sm">
            <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Min staff</span>
            <input type="number" min={1} value={threshold} onChange={e => setThreshold(Math.max(1, parseInt(e.target.value) || 1))} className="w-12 bg-transparent text-sm font-black text-gray-800 outline-none" />
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Stat icon={UsersIcon} label="Workforce" value={A.total} />
        <Stat icon={Clock} label={isRange ? 'Avg On Shift/Day' : 'On Shift'} value={Math.round(A.shiftDays / days)} />
        <Stat icon={TrendingUp} label="Peak / Hr" value={fmt(A.peak)} />
        <Stat icon={TrendingDown} label="Lowest Net" value={fmt(A.low)} />
        <Stat icon={Coffee} label="Breaks (peak hr)" value={fmt(A.breakPeak)} />
        <Stat icon={AlertTriangle} label="Understaffed Hrs" value={A.understaffed.length} tone={A.understaffed.length ? 'bg-rose-50 border-rose-100' : ''} />
      </div>

      {/* Working now (live) */}
      <div className="bg-white p-6 md:p-8 rounded-[32px] border border-gray-100 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-2xl"><Activity size={20} /></div>
            <div>
              <h2 className="text-lg font-black text-gray-900 flex items-center gap-2">
                Working Now
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
              </h2>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Live · {format(now, 'EEE, MMM d · HH:mm')}{activeScopeLabel !== 'All' ? ` · ${activeScopeLabel}` : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-xl text-[10px] font-black uppercase tracking-widest">{liveNow.working.length} On Duty</span>
            <span className="px-3 py-1.5 bg-orange-50 text-orange-700 rounded-xl text-[10px] font-black uppercase tracking-widest">{liveNow.onBreak.length} On Break</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* On Duty */}
          <div>
            <div className="flex items-center gap-2 mb-3"><Clock size={16} className="text-emerald-600" /><h3 className="text-[11px] font-black text-gray-500 uppercase tracking-widest">On Duty ({liveNow.working.length})</h3></div>
            {liveNow.working.length === 0 ? (
              <p className="text-gray-300 font-bold text-sm py-4">No one is on shift right now.</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto hide-scrollbar pr-1">
                {liveNow.working.map(e => (
                  <div key={e.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-2xl border border-gray-100">
                    <div className="w-10 h-10 rounded-xl bg-white border border-gray-100 flex items-center justify-center font-black text-emerald-600 shrink-0">
                      {e.wfh ? <Home size={16} /> : e.name.charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-black text-gray-900 text-sm leading-tight truncate flex items-center gap-2">{e.name}{e.wfh && <span className="bg-indigo-100 text-indigo-600 text-[8px] px-1.5 py-0.5 rounded font-black uppercase">WFH</span>}</p>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide truncate">{e.jobTitle} · {e.company}</p>
                    </div>
                    <span className="text-[10px] font-black text-emerald-700 bg-white px-2.5 py-1 rounded-lg border border-emerald-100 shrink-0">{e.shift}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* On Break */}
          <div>
            <div className="flex items-center gap-2 mb-3"><Coffee size={16} className="text-orange-600" /><h3 className="text-[11px] font-black text-gray-500 uppercase tracking-widest">On Break ({liveNow.onBreak.length})</h3></div>
            {liveNow.onBreak.length === 0 ? (
              <p className="text-gray-300 font-bold text-sm py-4">Nobody is on break right now.</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto hide-scrollbar pr-1">
                {liveNow.onBreak.map(e => (
                  <div key={e.id} className="flex items-center gap-3 p-3 bg-orange-50/40 rounded-2xl border border-orange-100/60">
                    <div className="w-10 h-10 rounded-xl bg-white border border-orange-100 flex items-center justify-center font-black text-orange-600 shrink-0">{e.wfh ? <Home size={16} /> : e.name.charAt(0)}</div>
                    <div className="min-w-0 flex-1">
                      <p className="font-black text-gray-900 text-sm leading-tight truncate">{e.name}</p>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide truncate">{e.jobTitle} · {e.company}</p>
                    </div>
                    <span className="text-[10px] font-black text-orange-700 bg-white px-2.5 py-1 rounded-lg border border-orange-100 shrink-0">Back {e.breakEnd}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Around this hour: starting soon / just ended */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Starting soon */}
        <div className="bg-white p-6 md:p-8 rounded-[32px] border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-blue-50 text-blue-600 rounded-2xl"><LogIn size={20} /></div>
              <div>
                <h2 className="text-base font-black text-gray-900">Starting Soon</h2>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Within the next hour</p>
              </div>
            </div>
            <span className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-xl text-[10px] font-black uppercase tracking-widest">{liveNow.startingSoon.length}</span>
          </div>
          {liveNow.startingSoon.length === 0 ? (
            <p className="text-gray-300 font-bold text-sm py-4">No shifts starting in the next hour.</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto hide-scrollbar pr-1">
              {liveNow.startingSoon.map(e => (
                <div key={e.id} className="flex items-center gap-3 p-3 bg-blue-50/30 rounded-2xl border border-blue-100/60">
                  <div className="w-10 h-10 rounded-xl bg-white border border-blue-100 flex items-center justify-center font-black text-blue-600 shrink-0">{e.wfh ? <Home size={16} /> : e.name.charAt(0)}</div>
                  <div className="min-w-0 flex-1">
                    <p className="font-black text-gray-900 text-sm leading-tight truncate">{e.name}</p>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide truncate">{e.jobTitle} · {e.company}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[11px] font-black text-blue-700">in {e.mins}m</p>
                    <p className="text-[9px] font-bold text-gray-400">starts {e.startAt}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Just ended */}
        <div className="bg-white p-6 md:p-8 rounded-[32px] border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-gray-100 text-gray-600 rounded-2xl"><LogOut size={20} /></div>
              <div>
                <h2 className="text-base font-black text-gray-900">Just Ended</h2>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">In the last hour</p>
              </div>
            </div>
            <span className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-xl text-[10px] font-black uppercase tracking-widest">{liveNow.justEnded.length}</span>
          </div>
          {liveNow.justEnded.length === 0 ? (
            <p className="text-gray-300 font-bold text-sm py-4">No shifts ended in the last hour.</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto hide-scrollbar pr-1">
              {liveNow.justEnded.map(e => (
                <div key={e.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-2xl border border-gray-100">
                  <div className="w-10 h-10 rounded-xl bg-white border border-gray-100 flex items-center justify-center font-black text-gray-500 shrink-0">{e.wfh ? <Home size={16} /> : e.name.charAt(0)}</div>
                  <div className="min-w-0 flex-1">
                    <p className="font-black text-gray-900 text-sm leading-tight truncate">{e.name}</p>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide truncate">{e.jobTitle} · {e.company}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[11px] font-black text-gray-600">{e.mins}m ago</p>
                    <p className="text-[9px] font-bold text-gray-400">ended {e.endAt}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Hourly coverage */}
      <div className="bg-white p-6 md:p-8 rounded-[32px] border border-gray-100 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 text-blue-600 rounded-2xl"><BarChart3 size={20} /></div>
            <div>
              <h2 className="text-lg font-black text-gray-900">{isRange ? 'Avg Hourly Coverage' : 'Hourly Coverage'} — {periodLabel}</h2>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{isRange ? 'Average staff per hour across the period · net of breaks' : 'Net = on shift minus those on break that hour'}</p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-[10px] font-black uppercase tracking-widest">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-blue-500"></span>Net</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-400"></span>On Break</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-rose-500"></span>Below Min</span>
          </div>
        </div>
        <div className="overflow-x-auto hide-scrollbar">
          <div className="flex items-end gap-1.5 min-w-[820px] h-60">
            {A.grossAvg.map((g, h) => {
              const net = A.netAvg[h], brk = A.breakAvg[h];
              const under = g > 0 && net < threshold;
              const totalH = (g / maxGross) * 100;
              const brkH = g > 0 ? (brk / g) * 100 : 0;
              return (
                <div key={h} className="flex-1 flex flex-col items-center justify-end h-full gap-1.5">
                  <span className={`text-[10px] font-black ${g === 0 ? 'text-gray-300' : under ? 'text-rose-600' : 'text-gray-700'}`}>{fmt(g)}</span>
                  <div className="w-full flex-1 flex items-end">
                    <div className="w-full rounded-t-lg overflow-hidden flex flex-col justify-end" style={{ height: `${Math.max(totalH, g === 0 ? 2 : 6)}%` }}>
                      <div className="w-full bg-orange-400" style={{ height: `${brkH}%` }} />
                      <div className={`w-full ${under ? 'bg-rose-500' : 'bg-blue-500'}`} style={{ height: `${100 - brkH}%` }} />
                    </div>
                  </div>
                  <span className="text-[9px] font-bold text-gray-400">{String(h).padStart(2, '0')}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Status breakdown + trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 md:p-8 rounded-[32px] border border-gray-100 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2.5 bg-purple-50 text-purple-600 rounded-2xl"><Activity size={20} /></div>
            <div>
              <h2 className="text-lg font-black text-gray-900">Status Breakdown</h2>
              {isRange && <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Totals over {days} days (employee-days)</p>}
            </div>
          </div>
          <div className="space-y-3">
            {STATUS_META.filter(s => A.statusCounts[s.key] > 0).map(s => {
              const v = A.statusCounts[s.key];
              const denom = A.total * days;
              const pct = denom ? Math.round((v / denom) * 100) : 0;
              return (
                <div key={s.key}>
                  <div className="flex justify-between items-center mb-1">
                    <span className={`text-xs font-black uppercase tracking-wide ${s.text}`}>{s.label}</span>
                    <span className="text-xs font-black text-gray-700">{v} <span className="text-gray-300">· {pct}%</span></span>
                  </div>
                  <div className="h-2.5 bg-gray-50 rounded-full overflow-hidden">
                    <div className={`h-full ${s.bar} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white p-6 md:p-8 rounded-[32px] border border-gray-100 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-2xl"><CalendarDays size={20} /></div>
            <h2 className="text-lg font-black text-gray-900">{isRange ? 'Staff Scheduled per Day' : 'This Week — Staff Scheduled'}</h2>
          </div>
          <div className="flex items-end justify-between gap-1.5 h-48 overflow-x-auto hide-scrollbar">
            {A.trend.map(d => (
              <button key={d.ds} onClick={() => { setMode('day'); setDate(d.ds); }} className="flex-1 min-w-[28px] flex flex-col items-center justify-end h-full gap-2 group">
                <span className="text-[11px] font-black text-gray-700">{d.count}</span>
                <div className="w-full flex-1 flex items-end">
                  <div className={`w-full rounded-t-xl transition-all ${d.isSel ? 'bg-blue-600' : 'bg-blue-200 group-hover:bg-blue-300'}`} style={{ height: `${Math.max((d.count / maxTrend) * 100, 4)}%` }} />
                </div>
                <div className="text-center">
                  <p className={`text-[9px] font-black uppercase ${d.isSel ? 'text-blue-600' : 'text-gray-400'}`}>{d.label}</p>
                  <p className="text-[9px] font-bold text-gray-300">{d.dayNum}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Per-company table */}
      <div className="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 p-6 md:p-8 pb-4">
          <div className="p-2.5 bg-blue-50 text-blue-600 rounded-2xl"><Building2 size={20} /></div>
          <div>
            <h2 className="text-lg font-black text-gray-900">{branchViewer ? 'By Branch' : 'By Company / Team'}</h2>
            {isRange && <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Average per day</p>}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="bg-gray-50/50 text-[10px] font-black uppercase tracking-widest text-gray-400 border-y border-gray-100">
                <th className="px-6 py-3">Company</th>
                <th className="px-6 py-3 text-center">Staff</th>
                <th className="px-6 py-3 text-center">On Shift</th>
                <th className="px-6 py-3 text-center">Day Off</th>
                <th className="px-6 py-3 text-center">Leave</th>
                <th className="px-6 py-3 text-center">Absent</th>
                <th className="px-6 py-3 text-center">Coverage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 text-sm">
              {Object.entries(A.byCompany).sort((a, b) => b[1].total - a[1].total).map(([co, s]) => {
                const onShift = s.onShiftDays / days;
                const cov = s.total ? Math.round((onShift / s.total) * 100) : 0;
                return (
                  <tr key={co} className="hover:bg-gray-50/40 transition-colors">
                    <td className="px-6 py-4 font-black text-gray-900">{co}</td>
                    <td className="px-6 py-4 text-center font-bold text-gray-700">{s.total}</td>
                    <td className="px-6 py-4 text-center font-black text-blue-600">{fmt(onShift)}</td>
                    <td className="px-6 py-4 text-center font-bold text-gray-400">{fmt(s.offDays / days)}</td>
                    <td className="px-6 py-4 text-center font-bold text-emerald-600">{fmt(s.leaveDays / days)}</td>
                    <td className="px-6 py-4 text-center font-bold text-rose-600">{fmt(s.absentDays / days)}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 justify-center">
                        <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${cov < 40 ? 'bg-rose-500' : cov < 70 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${cov}%` }} />
                        </div>
                        <span className="text-[11px] font-black text-gray-600 w-9">{cov}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Start-time distribution + who's off */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 md:p-8 rounded-[32px] border border-gray-100 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2.5 bg-amber-50 text-amber-600 rounded-2xl"><Clock size={20} /></div>
            <h2 className="text-lg font-black text-gray-900">Shift Start Times {isRange && <span className="text-gray-300 text-sm">(total)</span>}</h2>
          </div>
          {A.startDist.every(c => c === 0) ? (
            <p className="text-gray-300 font-bold text-sm">No shifts scheduled in this period.</p>
          ) : (
            <div className="space-y-2">
              {A.startDist.map((c, h) => c > 0 ? (
                <div key={h} className="flex items-center gap-3">
                  <span className="text-[11px] font-black text-gray-500 w-12">{String(h).padStart(2, '0')}:00</span>
                  <div className="flex-1 h-3 bg-gray-50 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-400 rounded-full" style={{ width: `${(c / maxStart) * 100}%` }} />
                  </div>
                  <span className="text-[11px] font-black text-gray-700 w-8 text-right">{c}</span>
                </div>
              ) : null)}
            </div>
          )}
        </div>

        <div className="bg-white p-6 md:p-8 rounded-[32px] border border-gray-100 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2.5 bg-rose-50 text-rose-600 rounded-2xl"><Home size={20} /></div>
            <h2 className="text-lg font-black text-gray-900">{isRange ? 'Leave / Absence' : 'Off / On Leave Today'} <span className="text-gray-300">({A.offList.length})</span></h2>
          </div>
          {A.offList.length === 0 ? (
            <p className="text-gray-300 font-bold text-sm">No leave or absence in this period.</p>
          ) : (
            <div className="flex flex-wrap gap-2 max-h-64 overflow-y-auto hide-scrollbar">
              {A.offList.map((o, i) => {
                const meta = STATUS_META.find(s => s.key === o.type);
                return (
                  <div key={i} className="flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-xl px-3 py-1.5">
                    <span className="text-[11px] font-black text-gray-800">{o.name}</span>
                    <span className={`text-[8px] font-black uppercase tracking-wide ${meta?.text || 'text-gray-400'}`}>{meta?.label || o.type}</span>
                    {o.count > 1 && <span className="text-[9px] font-black text-gray-400">×{o.count}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Understaffed alert */}
      {A.understaffed.length > 0 && (
        <div className="bg-rose-50 border border-rose-100 rounded-[24px] p-6">
          <div className="flex items-center gap-2 text-rose-700 mb-3">
            <AlertTriangle size={18} />
            <h3 className="text-xs font-black uppercase tracking-widest">Understaffed hours — {isRange ? 'avg ' : ''}net staff below {threshold}</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {A.understaffed.map(({ n, h, gross }) => (
              <span key={h} className="px-3 py-1.5 bg-white border border-rose-100 rounded-xl text-[11px] font-black text-rose-700">
                {String(h).padStart(2, '0')}:00 — {fmt(n)} net{Math.round(gross) !== Math.round(n) ? ` (${fmt(gross)} on shift)` : ''}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
