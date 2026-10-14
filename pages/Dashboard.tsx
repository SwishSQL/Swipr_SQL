
import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Users as UsersIcon, Clock, Coffee, AlertCircle, TrendingUp, Calendar, UserCheck, Timer, ChevronRight, ChevronLeft, Building2, Filter, Home, Moon, Download } from 'lucide-react';
import { store } from '../store';
import { DayType, UserRole, User, Shift, isBranchRole, unitOf } from '../types';
import { BRAND_NAMES, BRANDS } from '../brands';
import { format, subDays, addMonths } from 'date-fns';
import { useAuth } from '../App';
import { useLanguage } from '../i18n';
import { formatElapsed } from '../BreakCard';
import SickDocsCard from '../SickDocsCard';

const StatCard = ({ icon: Icon, label, value, color, description }: any) => (
  <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-xl shadow-blue-50/20 flex flex-col justify-between hover:scale-[1.02] transition-transform duration-300">
    <div className="flex justify-between items-start mb-4">
      <div className={`p-4 rounded-2xl ${color} shadow-lg shadow-opacity-20`}>
        <Icon size={24} className="text-white" />
      </div>
      <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{label}</div>
    </div>
    <div>
      <div className="text-4xl font-black text-gray-900 tracking-tight">{value}</div>
      <p className="text-xs font-bold text-gray-400 mt-1 uppercase tracking-tighter">{description}</p>
    </div>
  </div>
);

// Today's total overtime plus a per-employee breakdown (click to expand),
// and a monthly report the manager can export to Excel for payroll.
const OvertimeSection: React.FC<{ total: number; breakdown: { id: string; name: string; unit: string; hours: number }[] }> = ({ total, breakdown }) => {
  const [expanded, setExpanded] = useState(false);
  const [monthOffset, setMonthOffset] = useState(0);
  const [report, setReport] = useState<{ month: string; rows: { id: string; name: string; employeeCode: string; brand: string; branch: string; totalHours: number; days: { date: string; hours: number }[] }[] } | null>(null);
  const [loading, setLoading] = useState(true);

  const monthKey = format(addMonths(new Date(), monthOffset), 'yyyy-MM');
  useEffect(() => {
    setLoading(true);
    store.getOvertimeReport(monthKey)
      .then(setReport)
      .catch(() => setReport({ month: monthKey, rows: [] }))
      .finally(() => setLoading(false));
  }, [monthKey]);

  const exportExcel = () => {
    if (!report || report.rows.length === 0) return;
    const rows = report.rows.map(r => ({
      Employee: r.name,
      'Employee ID': r.employeeCode,
      Brand: r.brand,
      Branch: r.branch,
      'Total Overtime (Hours)': r.totalHours,
      Days: r.days.map(d => `${d.date}: ${d.hours}h`).join(', '),
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Overtime');
    XLSX.writeFile(workbook, `Overtime_Report_${monthKey}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <div
        onClick={() => breakdown.length > 0 && setExpanded(!expanded)}
        className={`bg-white p-6 rounded-3xl border border-gray-100 shadow-xl shadow-blue-50/20 flex items-center justify-between transition-all ${breakdown.length > 0 ? 'cursor-pointer hover:scale-[1.01]' : ''}`}
      >
        <div className="flex items-center gap-4">
          <div className="p-4 rounded-2xl bg-violet-600 shadow-lg">
            <Timer size={24} className="text-white" />
          </div>
          <div>
            <div className="text-4xl font-black text-gray-900 tracking-tight">{total}h</div>
            <p className="text-xs font-bold text-gray-400 mt-1 uppercase tracking-tighter">Overtime today{breakdown.length > 0 ? ` · ${breakdown.length} employee${breakdown.length > 1 ? 's' : ''}` : ''}</p>
          </div>
        </div>
        {breakdown.length > 0 && (
          <ChevronRight size={22} className={`text-gray-300 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        )}
      </div>

      {expanded && breakdown.length > 0 && (
        <div className="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="divide-y divide-gray-50">
            {breakdown.map(r => (
              <div key={r.id} className="px-6 py-4 flex items-center justify-between">
                <div>
                  <p className="font-bold text-gray-900 text-sm">{r.name}</p>
                  <p className="text-[11px] font-bold text-gray-400">{r.unit}</p>
                </div>
                <span className="font-black text-violet-700 text-sm">{r.hours}h</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-xl shadow-blue-50/20">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-violet-50 text-violet-600 rounded-2xl">
              <Calendar size={20} />
            </div>
            <div>
              <h2 className="text-xl font-black text-gray-900 tracking-tight">Monthly Overtime Report</h2>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">For payroll</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center bg-[#F8FAFC] border border-gray-100 rounded-xl p-1">
              <button onClick={() => setMonthOffset(o => o - 1)} className="p-2 hover:bg-white rounded-lg text-gray-400"><ChevronLeft size={16} /></button>
              <div className="px-3 font-black text-gray-900 text-xs uppercase tracking-widest text-center min-w-[100px]">{format(addMonths(new Date(), monthOffset), 'MMMM yyyy')}</div>
              <button onClick={() => setMonthOffset(o => Math.min(0, o + 1))} disabled={monthOffset >= 0} className="p-2 hover:bg-white rounded-lg text-gray-400 disabled:opacity-30"><ChevronRight size={16} /></button>
            </div>
            <button
              onClick={exportExcel}
              disabled={!report || report.rows.length === 0}
              className="flex items-center gap-2 px-5 py-3 bg-violet-600 hover:bg-violet-700 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all active:scale-95 disabled:opacity-40"
            >
              <Download size={14} /> Excel
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-center py-12 text-gray-300 font-bold text-sm">Loading report...</p>
        ) : !report || report.rows.length === 0 ? (
          <p className="text-center py-12 text-gray-300 font-bold text-sm">No overtime recorded this month.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-50 text-left">
                  <th className="py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Employee</th>
                  <th className="py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Unit</th>
                  <th className="py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Days</th>
                  <th className="py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Total Hours</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {report.rows.map(r => (
                  <tr key={r.id}>
                    <td className="py-3 font-bold text-gray-900">{r.name}</td>
                    <td className="py-3 text-gray-500 font-bold text-xs">{[r.brand, r.branch].filter(Boolean).join(' · ')}</td>
                    <td className="py-3 text-gray-500 font-bold tabular-nums">{r.days.length}</td>
                    <td className="py-3 font-black text-violet-700 tabular-nums">{r.totalHours}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// All shift math uses minutes-since-midnight so overnight shifts
// (e.g. 22:00-06:00) resolve correctly across the midnight boundary.
const toMinutes = (t?: string): number | null => {
  if (!t || typeof t !== 'string') return null;
  const parts = t.split(':');
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  return isNaN(h) || isNaN(m) ? null : h * 60 + m;
};

const fmtLeft = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

interface WorkingEmp extends User {
  isWFH?: boolean;
  shiftStart: string;
  shiftEnd: string;
  progress: number;     // 0..100 of the shift elapsed
  minutesLeft: number;
}

// Someone actually on a break right now (the Start Break button, or a break
// status mirrored from XonTel) — not a break window written on the roster.
interface UserWithBreak extends User {
  breakStartedAt: number;
  breakSource: 'swipr' | 'xontel';
  xontelStatus: string | null;
  isWFH?: boolean;
}

export default function Dashboard() {
  const { user } = useAuth();
  const { t } = useLanguage();
  // Field-operations managers get the dashboard scoped to their branches.
  const branchViewer = isBranchRole(user?.role);
  const [selectedCompany, setSelectedCompany] = useState<string>('All');
  const [unitOptions, setUnitOptions] = useState<string[]>(['All']);
  // Admin-only cascading Brand → Branch filter over the field-operations hierarchy.
  const [selectedBrand, setSelectedBrand] = useState<string>('All');
  const [selectedBranch, setSelectedBranch] = useState<string>('All');
  const [stats, setStats] = useState({
    totalEmployees: 0,
    workingNow: 0,
    onBreakNow: 0,
    pendingSwaps: 0,
    scheduledToday: 0,
    dayOff: 0,
    onLeave: 0,
    absent: 0,
    pendingRequests: 0,
    overtimeToday: 0
  });

  const [liveStatus, setLiveStatus] = useState<{ working: WorkingEmp[], onBreak: UserWithBreak[] }>({
    working: [],
    onBreak: []
  });

  const [overtimeBreakdown, setOvertimeBreakdown] = useState<{ id: string; name: string; unit: string; hours: number }[]>([]);

  const [currentTime, setCurrentTime] = useState(new Date());
  const [clock, setClock] = useState(new Date());

  const companies = ['All', 'Call Center', 'Technical', 'Complain', 'Quality'];

  // Human label for whichever scope (department, or brand/branch) is active.
  const activeScopeLabel = selectedCompany !== 'All'
    ? selectedCompany
    : selectedBrand !== 'All'
    ? (selectedBranch !== 'All' ? `${selectedBrand} · ${selectedBranch}` : selectedBrand)
    : 'All';

  // Stats refresh every 30s; the header clock ticks every second.
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 30000);
    const ticker = setInterval(() => setClock(new Date()), 1000);
    return () => { clearInterval(timer); clearInterval(ticker); };
  }, []);

  // Recompute live stats when the filter, user, or clock tick changes.
  useEffect(() => {
    calculateStats();
  }, [currentTime, user, selectedCompany, selectedBrand, selectedBranch]);

  const calculateStats = async () => {
    // Breaks come from what people actually did (Start Break, or a break
    // status on XonTel), not the break windows on the roster — the roster
    // said "Everyone is currently on duty" while a colleague was out. A
    // failed fetch leaves the rest of the dashboard working.
    const [data, activeBreaks] = await Promise.all([
      store.getCurrentAppData(),
      store.getActiveBreaks().catch(() => []),
    ]);
    const breakOf = new Map(activeBreaks.map(b => [b.userId, b]));
    const now = new Date();
    const today = format(now, 'yyyy-MM-dd');
    const yesterday = format(subDays(now, 1), 'yyyy-MM-dd');
    const nowMin = now.getHours() * 60 + now.getMinutes();

    // Branch viewers count everyone the server scoped to them (their
    // branches' employees and managers, minus themselves); the admin's
    // global workforce spans both hierarchies (department + branch
    // employees); other department viewers keep the EMPLOYEE-only stats.
    let employees = branchViewer
      ? data.users.filter(u => isBranchRole(u.role) && u.id !== user?.id)
      : user?.role === UserRole.ADMIN
      ? data.users.filter(u => u.role === UserRole.EMPLOYEE || u.role === UserRole.BRANCH_EMPLOYEE)
      : data.users.filter(u => u.role === UserRole.EMPLOYEE);
    let swapRequests = data.swapRequests;

    if (branchViewer) {
      setUnitOptions(['All', ...Array.from(new Set(employees.map(e => unitOf(e)).filter(Boolean))).sort()]);
    }

    if (user?.role === UserRole.MANAGER) {
      employees = employees.filter(e => e.companyName === user.companyName);
      swapRequests = swapRequests.filter(r => {
        const reqUser = data.users.find(u => u.id === r.requesterId);
        return reqUser?.companyName === user.companyName;
      });
    }

    if (selectedCompany !== 'All') {
      employees = employees.filter(e => unitOf(e).trim().toLowerCase() === selectedCompany.toLowerCase());
      swapRequests = swapRequests.filter(r => {
        const reqUser = data.users.find(u => u.id === r.requesterId);
        return unitOf(reqUser).trim().toLowerCase() === selectedCompany.toLowerCase();
      });
    } else if (selectedBrand !== 'All') {
      // Admin-only: narrow to one brand, optionally one branch within it.
      const brandMatch = (u?: User) => !!u && (u.brand || '').trim().toLowerCase() === selectedBrand.toLowerCase() &&
        (selectedBranch === 'All' || (u.branch || '').trim().toLowerCase() === selectedBranch.toLowerCase());
      employees = employees.filter(brandMatch);
      swapRequests = swapRequests.filter(r => brandMatch(data.users.find(u => u.id === r.requesterId)));
    }

    const working: WorkingEmp[] = [];
    const onBreak: UserWithBreak[] = [];
    let scheduledToday = 0, dayOff = 0, onLeave = 0, absent = 0, overtimeToday = 0;
    const overtimeRows: { id: string; name: string; unit: string; hours: number }[] = [];

    const SHIFT_TYPES = [DayType.NORMAL_SHIFT, DayType.WORK_FROM_HOME, DayType.TASK, DayType.TARDY, DayType.EARLY_LEAVE, DayType.CANCEL_OFF];

    employees.forEach(emp => {
      const schedule = data.schedules[emp.id]?.[today];
      const isShiftType = schedule && SHIFT_TYPES.includes(schedule.type);

      const otHours = Number(schedule?.overtimeHours) || 0;
      if (otHours > 0) {
        overtimeToday += otHours;
        overtimeRows.push({ id: emp.id, name: emp.name, unit: unitOf(emp), hours: otHours });
      }

      // Today's status breakdown
      if (isShiftType) scheduledToday++;
      else if (schedule && schedule.type === DayType.ABSENT) absent++;
      else if (schedule && [DayType.ANNUAL_LEAVE, DayType.PUBLIC_HOLIDAY, DayType.SICK, DayType.TRAINING].includes(schedule.type)) onLeave++;
      else dayOff++;

      // Find the shift covering this exact moment: today's shift, or the
      // after-midnight tail of yesterday's overnight shift.
      let live: { shift: Shift; type: DayType; elapsed: number; total: number } | null = null;

      if (isShiftType && schedule.shift) {
        const s = toMinutes(schedule.shift.startTime);
        const e = toMinutes(schedule.shift.endTime);
        if (s !== null && e !== null && s !== e) {
          const overnight = e < s;
          // An overnight shift on today's row starts tonight, so only its
          // pre-midnight segment counts as "now"; the tail belongs to tomorrow.
          const active = overnight ? nowMin >= s : nowMin >= s && nowMin < e;
          if (active) {
            live = {
              shift: schedule.shift,
              type: schedule.type,
              elapsed: nowMin - s,
              total: overnight ? 1440 - s + e : e - s,
            };
          }
        }
      }

      if (!live) {
        const ySched = data.schedules[emp.id]?.[yesterday];
        if (ySched && SHIFT_TYPES.includes(ySched.type) && ySched.shift) {
          const s = toMinutes(ySched.shift.startTime);
          const e = toMinutes(ySched.shift.endTime);
          if (s !== null && e !== null && e < s && nowMin < e) {
            live = {
              shift: ySched.shift,
              type: ySched.type,
              elapsed: 1440 - s + nowMin,
              total: 1440 - s + e,
            };
          }
        }
      }

      // On a break right now counts whether or not the roster has them on
      // shift this minute — they are out either way.
      const liveBreak = breakOf.get(emp.id);
      if (liveBreak) {
        onBreak.push({
          ...emp,
          breakStartedAt: liveBreak.startedAt,
          breakSource: liveBreak.source,
          xontelStatus: liveBreak.xontelStatus,
          isWFH: live?.type === DayType.WORK_FROM_HOME,
        });
      } else if (live) {
        working.push({
          ...emp,
          isWFH: live.type === DayType.WORK_FROM_HOME,
          shiftStart: live.shift.startTime,
          shiftEnd: live.shift.endTime,
          progress: Math.min(100, Math.max(0, Math.round((live.elapsed / live.total) * 100))),
          minutesLeft: Math.max(0, live.total - live.elapsed),
        });
      }
    });

    // Soonest-to-finish first; longest-out break first.
    working.sort((a, b) => a.minutesLeft - b.minutesLeft);
    onBreak.sort((a, b) => a.breakStartedAt - b.breakStartedAt);

    const empIds = new Set(employees.map(e => e.id));
    const pendingRequests = data.leaveRequests.filter(l => l.status === 'PENDING' && empIds.has(l.userId)).length;

    setStats({
      totalEmployees: employees.length,
      workingNow: working.length,
      onBreakNow: onBreak.length,
      pendingSwaps: swapRequests.filter(r => r.status === 'PENDING_MANAGER').length,
      scheduledToday,
      dayOff,
      onLeave,
      absent,
      pendingRequests,
      overtimeToday
    });
    setLiveStatus({ working, onBreak });
    setOvertimeBreakdown(overtimeRows.sort((a, b) => b.hours - a.hours));
  };

  return (
    <div className="space-y-10 animate-in fade-in duration-700">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black text-gray-900 tracking-tight">
            {user?.role === UserRole.ADMIN ? t('dashboard.globalHub') : t('dashboard.operationDashboard')}
          </h1>
          <p className="text-gray-400 font-medium mt-1 flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse inline-block"></span>
            {t('dashboard.live')} — {format(clock, 'pp')}
          </p>
        </div>

        <div className="flex items-center gap-4">
          {(user?.role === UserRole.ADMIN || branchViewer) && (
            <div className="relative group">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500 pointer-events-none">
                <Building2 size={18} />
              </div>
              <select
                value={selectedCompany}
                onChange={(e) => {
                  setSelectedCompany(e.target.value);
                  if (e.target.value !== 'All') { setSelectedBrand('All'); setSelectedBranch('All'); }
                }}
                className="pl-12 pr-10 py-3.5 bg-white border border-gray-100 rounded-[22px] shadow-sm font-black text-xs uppercase tracking-widest outline-none focus:ring-4 focus:ring-blue-500/10 appearance-none min-w-[180px] cursor-pointer"
              >
                {(branchViewer ? unitOptions : companies).map(c => (
                  <option key={c} value={c}>{c === 'All' ? (branchViewer ? t('dashboard.allBranches') : t('dashboard.allCompanies')) : c}</option>
                ))}
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none">
                <Filter size={14} />
              </div>
            </div>
          )}

          {user?.role === UserRole.ADMIN && (
            <>
              <div className="relative group">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-purple-500 pointer-events-none">
                  <Building2 size={18} />
                </div>
                <select
                  value={selectedBrand}
                  onChange={(e) => {
                    setSelectedBrand(e.target.value);
                    setSelectedBranch('All');
                    if (e.target.value !== 'All') setSelectedCompany('All');
                  }}
                  className="pl-12 pr-10 py-3.5 bg-white border border-gray-100 rounded-[22px] shadow-sm font-black text-xs uppercase tracking-widest outline-none focus:ring-4 focus:ring-purple-500/10 appearance-none min-w-[160px] cursor-pointer"
                >
                  <option value="All">{t('dashboard.allBrands')}</option>
                  {BRAND_NAMES.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none">
                  <Filter size={14} />
                </div>
              </div>
              {selectedBrand !== 'All' && (
                <div className="relative group">
                  <select
                    value={selectedBranch}
                    onChange={(e) => setSelectedBranch(e.target.value)}
                    className="pl-5 pr-10 py-3.5 bg-white border border-gray-100 rounded-[22px] shadow-sm font-black text-xs uppercase tracking-widest outline-none focus:ring-4 focus:ring-purple-500/10 appearance-none min-w-[160px] cursor-pointer"
                  >
                    <option value="All">{t('dashboard.allBranches')}</option>
                    {(BRANDS[selectedBrand] || []).map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
              )}
            </>
          )}

          <div className="flex items-center space-x-3 bg-white border border-gray-100 px-5 py-3.5 rounded-[22px] shadow-sm">
            <div className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse shadow-[0_0_15px_rgba(34,197,94,0.5)]"></div>
            <span className="text-[10px] font-black text-gray-700 uppercase tracking-widest">{t('dashboard.systemsActive')}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
        <StatCard
          icon={UsersIcon}
          label={t('dashboard.stat.employees')}
          value={stats.totalEmployees}
          color="bg-blue-600"
          description={`${t('common.total')} ${activeScopeLabel !== 'All' ? activeScopeLabel : t('common.workforce')}`}
        />
        <StatCard
          icon={Clock}
          label={t('dashboard.stat.activeShifts')}
          value={stats.workingNow}
          color="bg-emerald-600"
          description={t('dashboard.stat.activeShifts.desc')}
        />
        <StatCard
          icon={Coffee}
          label={t('dashboard.stat.onBreak')}
          value={stats.onBreakNow}
          color="bg-orange-500"
          description={t('dashboard.stat.onBreak.desc')}
        />
        <StatCard
          icon={Moon}
          label={t('dashboard.stat.offToday')}
          value={stats.dayOff}
          color="bg-slate-500"
          description={t('dashboard.stat.offToday.desc')}
        />
        <StatCard
          icon={AlertCircle}
          label={t('dashboard.stat.swapAlerts')}
          value={stats.pendingSwaps}
          color="bg-rose-600"
          description={t('dashboard.stat.swapAlerts.desc')}
        />
      </div>

      {/* An employee's own medical report for a sick day — seen by them and
          Admin only (the server enforces it). */}
      {(user?.role === UserRole.EMPLOYEE || user?.role === UserRole.BRANCH_EMPLOYEE) && <SickDocsCard />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-xl shadow-blue-50/20">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center space-x-4">
                <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl">
                  <UserCheck size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-gray-900 tracking-tight">{t('dashboard.onDutyRoster')}</h2>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{t('common.workingIn')} {activeScopeLabel === 'All' ? t('common.allCompaniesLower') : activeScopeLabel}</p>
                </div>
              </div>
              <span className="bg-emerald-50 text-emerald-700 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest">{t('dashboard.liveNow')}</span>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {liveStatus.working.length === 0 ? (
                <div className="col-span-2 py-10 text-center border-2 border-dashed border-gray-50 rounded-[32px]">
                  <Clock className="mx-auto text-gray-200 mb-2" size={32} />
                  <p className="text-gray-400 font-bold text-sm">{t('dashboard.noActiveShifts')}</p>
                </div>
              ) : (
                liveStatus.working.map(emp => (
                  <div key={emp.id} className="p-4 bg-gray-50 rounded-3xl border border-gray-100 group hover:bg-white hover:shadow-lg transition-all duration-300">
                    <div className="flex items-center">
                      <div className="w-12 h-12 rounded-2xl bg-white border border-gray-100 flex items-center justify-center font-black text-blue-600 text-lg mr-4 shadow-sm group-hover:bg-blue-600 group-hover:text-white transition-all shrink-0">
                        {emp.isWFH ? <Home size={20} /> : emp.name.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-black text-gray-900 text-sm leading-tight flex items-center gap-2">
                          {emp.name}
                          {emp.isWFH && <span className="bg-indigo-100 text-indigo-600 text-[8px] px-1.5 py-0.5 rounded-md font-black uppercase">WFH</span>}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[9px] font-black text-blue-600 uppercase tracking-widest">{emp.jobTitle}</span>
                          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest border-l pl-2">{unitOf(emp)}</span>
                        </div>
                      </div>
                      <div className="ml-auto text-right shrink-0 pl-3">
                        <p className="text-[10px] font-black text-gray-700 tracking-tight">{emp.shiftStart}–{emp.shiftEnd}</p>
                        <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mt-0.5">{fmtLeft(emp.minutesLeft)} left</p>
                      </div>
                    </div>
                    <div className="mt-3 h-1.5 bg-gray-200/70 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full transition-all duration-1000"
                        style={{ width: `${emp.progress}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-xl shadow-blue-50/20">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center space-x-4">
                <div className="p-3 bg-orange-50 text-orange-600 rounded-2xl">
                  <Timer size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-gray-900 tracking-tight">Current Breaks</h2>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Employees resting</p>
                </div>
              </div>
              <span className="bg-orange-50 text-orange-700 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest">{stats.onBreakNow} Total</span>
            </div>
            <div className="space-y-4">
              {liveStatus.onBreak.length === 0 ? (
                <div className="py-10 text-center border-2 border-dashed border-gray-50 rounded-[32px]">
                  <Coffee className="mx-auto text-gray-200 mb-2" size={32} />
                  <p className="text-gray-400 font-bold text-sm">Everyone is currently on duty.</p>
                </div>
              ) : (
                liveStatus.onBreak.map(emp => (
                  <div key={emp.id} className="flex items-center justify-between p-5 bg-orange-50/20 rounded-[28px] border border-orange-100/50 hover:bg-white hover:shadow-lg transition-all duration-300 group">
                    <div className="flex items-center">
                       <div className="w-14 h-14 rounded-2xl bg-white flex items-center justify-center font-black text-orange-600 text-xl mr-5 shadow-sm group-hover:bg-orange-500 group-hover:text-white transition-all">
                         {emp.isWFH ? <Home size={24} /> : emp.name.charAt(0)}
                       </div>
                       <div>
                         <p className="font-black text-gray-900 text-lg leading-tight flex items-center gap-2">
                            {emp.name}
                            {emp.isWFH && <span className="bg-indigo-100 text-indigo-600 text-[10px] px-2 py-0.5 rounded-md font-black uppercase">WFH</span>}
                         </p>
                         <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-1">{emp.jobTitle} • {unitOf(emp)}</p>
                       </div>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-black text-orange-700 bg-white px-3 py-1.5 rounded-xl border border-orange-100 shadow-sm tabular-nums">
                        {formatElapsed(clock.getTime() - emp.breakStartedAt)}
                      </span>
                      <p className="text-[9px] font-bold text-orange-400 mt-1.5 uppercase tracking-widest">
                        Since {format(new Date(emp.breakStartedAt), 'p')}{emp.breakSource === 'xontel' ? ` · XonTel${emp.xontelStatus ? ' · ' + emp.xontelStatus : ''}` : ''}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="space-y-8">
          <div className="bg-gray-900 p-10 rounded-[48px] shadow-2xl shadow-blue-200/50 text-white relative overflow-hidden group">
            <div className="relative z-10">
              <h2 className="text-3xl font-black mb-6 tracking-tight leading-none">Swipr <br/>Intelligence<span className="text-blue-500">.</span></h2>
              <p className="text-gray-400 font-medium text-sm mb-10 leading-relaxed">
                {activeScopeLabel !== 'All' ? `${activeScopeLabel} capacity` : 'Global operational capacity'} is currently at <span className="text-blue-400 font-black">{stats.totalEmployees > 0 ? Math.round((stats.workingNow / stats.totalEmployees) * 100) : 0}%</span>.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                  <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest">{t('dashboard.scheduledToday')}</p>
                  <p className="text-3xl font-black text-white mt-1">{stats.scheduledToday}</p>
                </div>
                <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                  <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest">{t('dashboard.pendingApprovals')}</p>
                  <p className="text-3xl font-black text-white mt-1">{stats.pendingRequests + stats.pendingSwaps}</p>
                </div>
              </div>
            </div>
            <Calendar size={180} className="absolute -bottom-16 -right-16 text-gray-800 opacity-30 group-hover:rotate-12 transition-transform duration-700" />
          </div>

          <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-xl shadow-blue-50/20">
             <div className="flex items-center space-x-3 mb-6">
                <TrendingUp size={20} className="text-blue-600" />
                <h3 className="font-black text-gray-900 uppercase tracking-widest text-xs">{t('dashboard.todaysBreakdown')}</h3>
             </div>
             <div className="space-y-3">
                {[
                  { label: t('dashboard.breakdown.onShift'), value: stats.scheduledToday, color: 'text-blue-600' },
                  { label: t('dashboard.breakdown.dayOff'), value: stats.dayOff, color: 'text-gray-500' },
                  { label: t('dashboard.breakdown.onLeave'), value: stats.onLeave, color: 'text-emerald-600' },
                  { label: t('dashboard.breakdown.absent'), value: stats.absent, color: 'text-rose-600' },
                  { label: t('dashboard.breakdown.pending'), value: stats.pendingRequests, color: 'text-amber-600' },
                ].map(r => (
                  <div key={r.label} className="flex justify-between items-center text-sm font-bold">
                    <span className="text-gray-500">{r.label}</span>
                    <span className={`${r.color} font-black`}>{r.value}</span>
                  </div>
                ))}
             </div>
          </div>
        </div>
      </div>

      {(branchViewer || user?.role === UserRole.ADMIN) && <OvertimeSection total={stats.overtimeToday} breakdown={overtimeBreakdown} />}
    </div>
  );
}
