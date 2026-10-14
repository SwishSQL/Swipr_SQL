
import React, { useState, useEffect, useMemo } from 'react';
import { store } from '../store';
import { User, UserRole, ScheduleDay, DayType, isBranchRole, roleLabel, unitOf } from '../types';
import { BRAND_NAMES, BRANDS } from '../brands';
import Avatar from '../Avatar';
import { format, addDays } from 'date-fns';
import { useAuth } from '../App';
import { useLanguage } from '../i18n';
import { Search, ChevronLeft, ChevronRight, Moon, Home, Building2 } from 'lucide-react';

const manualStartOfWeek = (date: Date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day;
  const start = new Date(d.setDate(diff));
  start.setHours(0, 0, 0, 0);
  return start;
};

export default function AllEmployees() {
  const { user } = useAuth();
  const { t } = useLanguage();
  // Supervisors and admins get a read-only view of every department.
  const globalView = user?.role === UserRole.SUPERVISOR || user?.role === UserRole.ADMIN;
  // Field-operations users see whatever the server scoped them to
  // (their branch / branches / brands).
  const branchViewer = isBranchRole(user?.role);
  const [employees, setEmployees] = useState<User[]>([]);
  const [currentWeekStart, setCurrentWeekStart] = useState(manualStartOfWeek(new Date()));
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<string>('All');
  const [schedules, setSchedules] = useState<Record<string, Record<string, ScheduleDay>>>({});
  // Admin-only cascading Brand → Branch filter over the field-operations hierarchy.
  const [selectedBrand, setSelectedBrand] = useState<string>('All');
  const [selectedBranch, setSelectedBranch] = useState<string>('All');
  const isAdminViewer = user?.role === UserRole.ADMIN;

  useEffect(() => {
    const unsubscribeUsers = store.subscribeToUsers((allUsers) => {
      if (user) {
        const filtered = allUsers.filter(u => {
          if (u.role === UserRole.SUPERVISOR || u.role === UserRole.ADMIN) return false;
          if (globalView) return true;
          if (branchViewer) return true; // server already scoped the list
          return u.companyName?.trim().toLowerCase() === user.companyName?.trim().toLowerCase();
        });

        const sorted = [...filtered].sort((a, b) => {
          if (a.id === user.id) return -1;
          if (b.id === user.id) return 1;
          if (globalView || branchViewer) {
            const co = unitOf(a).localeCompare(unitOf(b));
            if (co !== 0) return co;
          }
          return a.name.localeCompare(b.name);
        });

        setEmployees(sorted);
      }
    }, { all: globalView });

    const unsubscribeSchedules = store.subscribeToSchedules((data) => {
      setSchedules(data);
    }, { all: globalView });

    return () => {
      unsubscribeUsers();
      unsubscribeSchedules();
    };
  }, [user, globalView]);

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));

  // Unit options span both hierarchies: plain department names, and
  // "BRAND · Branch" for field-operations staff (via unitOf).
  const companyOptions = useMemo(() => {
    const set = new Set<string>();
    employees.forEach(e => { const u = unitOf(e); if (u) set.add(u); });
    return ['All', ...Array.from(set).sort()];
  }, [employees]);

  const filteredEmployees = employees.filter(e => {
    const matchesSearch = e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.jobTitle?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCompany = selectedCompany === 'All' ||
      unitOf(e).trim().toLowerCase() === selectedCompany.toLowerCase();
    const matchesBrand = selectedCompany !== 'All' || selectedBrand === 'All' ||
      ((e.brand || '').trim().toLowerCase() === selectedBrand.toLowerCase() &&
       (selectedBranch === 'All' || (e.branch || '').trim().toLowerCase() === selectedBranch.toLowerCase()));
    return matchesSearch && matchesCompany && matchesBrand;
  });

  return (
    <div className="space-y-10 animate-in fade-in duration-700 pb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black text-[#111827] tracking-tight">{t('allEmployees.title')}</h1>
          <p className="text-[#6B7280] font-medium text-base mt-1">
            {globalView
              ? <>Read-only view of schedules across <span className="text-blue-600 font-bold">all departments</span></>
              : <>View schedules for your colleagues at <span className="text-blue-600 font-bold">{unitOf(user || undefined) || user?.companyName}</span></>}
          </p>
        </div>
        
        <div className="flex items-center bg-white border border-[#E5E7EB] rounded-2xl p-1 shadow-sm">
          <button 
            onClick={() => setCurrentWeekStart(addDays(currentWeekStart, -7))}
            className="p-3 hover:bg-gray-50 rounded-xl text-[#9CA3AF] transition-colors"
          >
            <ChevronLeft size={22} />
          </button>
          <div className="px-8 font-black text-[#374151] text-sm uppercase tracking-widest text-center min-w-[240px]">
            {format(currentWeekStart, 'MMM d')} - {format(addDays(currentWeekStart, 6), 'MMM d, yyyy')}
          </div>
          <button 
            onClick={() => setCurrentWeekStart(addDays(currentWeekStart, 7))}
            className="p-3 hover:bg-gray-50 rounded-xl text-[#9CA3AF] transition-colors"
          >
            <ChevronRight size={22} />
          </button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 max-w-5xl">
        <div className="relative group flex-1">
          <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-[#D1D5DB] group-focus-within:text-blue-500 transition-colors" size={22} />
          <input
            type="text"
            placeholder={t('allEmployees.search')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-16 pr-6 py-6 bg-white border border-[#F3F4F6] rounded-[28px] text-base font-bold outline-none focus:ring-4 focus:ring-blue-500/5 shadow-sm transition-all placeholder:text-[#9CA3AF]"
          />
        </div>
        {globalView && (
          <div className="relative">
            <Building2 className="absolute left-6 top-1/2 -translate-y-1/2 text-blue-500 pointer-events-none" size={20} />
            <select
              value={selectedCompany}
              onChange={(e) => {
                setSelectedCompany(e.target.value);
                if (e.target.value !== 'All') { setSelectedBrand('All'); setSelectedBranch('All'); }
              }}
              className="h-full min-h-[72px] pl-14 pr-10 py-6 bg-white border border-[#F3F4F6] rounded-[28px] text-sm font-black uppercase tracking-widest outline-none focus:ring-4 focus:ring-blue-500/5 shadow-sm appearance-none cursor-pointer min-w-[220px]"
            >
              {companyOptions.map(c => (
                <option key={c} value={c}>{c === 'All' ? 'All Departments' : c}</option>
              ))}
            </select>
          </div>
        )}
        {isAdminViewer && (
          <>
            <div className="relative">
              <Building2 className="absolute left-6 top-1/2 -translate-y-1/2 text-purple-500 pointer-events-none" size={20} />
              <select
                value={selectedBrand}
                onChange={(e) => {
                  setSelectedBrand(e.target.value);
                  setSelectedBranch('All');
                  if (e.target.value !== 'All') setSelectedCompany('All');
                }}
                className="h-full min-h-[72px] pl-14 pr-10 py-6 bg-white border border-[#F3F4F6] rounded-[28px] text-sm font-black uppercase tracking-widest outline-none focus:ring-4 focus:ring-purple-500/5 shadow-sm appearance-none cursor-pointer min-w-[200px]"
              >
                <option value="All">All Brands</option>
                {BRAND_NAMES.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            {selectedBrand !== 'All' && (
              <div className="relative">
                <select
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                  className="h-full min-h-[72px] pl-6 pr-10 py-6 bg-white border border-[#F3F4F6] rounded-[28px] text-sm font-black uppercase tracking-widest outline-none focus:ring-4 focus:ring-purple-500/5 shadow-sm appearance-none cursor-pointer min-w-[200px]"
                >
                  <option value="All">All Branches</option>
                  {(BRANDS[selectedBrand] || []).map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
            )}
          </>
        )}
      </div>

      <div className="bg-white rounded-[48px] border border-[#F3F4F6] shadow-2xl shadow-blue-100/20 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1300px] border-collapse">
            <thead>
              <tr className="bg-white">
                <th className="px-10 py-10 text-left text-[11px] font-black text-[#D1D5DB] uppercase tracking-[0.25em] w-[320px]">Employee</th>
                {weekDays.map(day => (
                  <th key={day.toString()} className="px-4 py-10 text-center min-w-[140px]">
                    <p className="text-[11px] font-black text-[#9CA3AF] uppercase tracking-widest">{format(day, 'EEE')}</p>
                    <p className="text-3xl font-black text-[#111827] mt-1.5">{format(day, 'd')}</p>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredEmployees.map(emp => (
                <tr key={emp.id} className="hover:bg-blue-50/10 transition-colors group">
                  <td className="px-10 py-12">
                    <div className="flex items-center gap-5">
                      <Avatar
                        name={emp.name}
                        photoUrl={emp.photoUrl}
                        className="w-16 h-16 rounded-[24px] bg-[#F9FAFB] border border-[#F3F4F6] flex items-center justify-center font-black text-blue-600 text-2xl shadow-sm group-hover:bg-white group-hover:shadow-md transition-all overflow-hidden"
                      />
                      <div>
                        <h3 className="font-black text-[#111827] text-lg leading-tight mb-1 flex items-center gap-2">
                          {emp.name}
                          {[UserRole.MANAGER, UserRole.BRANCH_MANAGER, UserRole.AREA_MANAGER].includes(emp.role) && (
                            <span className="bg-purple-100 text-purple-700 text-[8px] px-2 py-0.5 rounded-md font-black uppercase tracking-wider shrink-0">{roleLabel(emp.role)}</span>
                          )}
                        </h3>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black text-[#9CA3AF] uppercase tracking-widest">{emp.jobTitle || 'STAFF'}</span>
                            {(globalView || branchViewer) && unitOf(emp) && (
                                <span className="text-[10px] font-bold text-blue-500 uppercase tracking-widest border-l border-gray-200 pl-2">{unitOf(emp)}</span>
                            )}
                            {emp.id === user?.id && (
                                <span className="bg-blue-50 text-blue-600 text-[8px] font-black px-2 py-0.5 rounded-md uppercase tracking-tighter">YOU</span>
                            )}
                        </div>
                      </div>
                    </div>
                  </td>

                  {weekDays.map(day => {
                    const dateStr = format(day, 'yyyy-MM-dd');
                    const dayData = (schedules[emp.id] || {})[dateStr];
                    const isNormal = dayData?.type === DayType.NORMAL_SHIFT;
                    const isWFH = dayData?.type === DayType.WORK_FROM_HOME;
                    const isTask = dayData?.type === DayType.TASK;
                    const isSpecial = dayData?.type && ![DayType.NORMAL_SHIFT, DayType.WORK_FROM_HOME, DayType.DAY_OFF, DayType.TASK].includes(dayData.type);

                    return (
                      <td key={dateStr} className="p-3">
                        <div className={`h-[120px] w-full rounded-[30px] flex flex-col items-center justify-center p-5 transition-all duration-300 border-2 ${
                          (isNormal || isWFH || isTask || isSpecial)
                            ? 'bg-white border-[#F3F4F6] shadow-sm hover:shadow-md hover:-translate-y-1' 
                            : 'bg-transparent border-transparent'
                        }`}>
                          {(isNormal || isWFH || isTask || isSpecial) && dayData.shift ? (
                            <div className="text-center space-y-2">
                                <div className="flex items-center justify-center gap-1.5">
                                  {isWFH && <Home size={12} className="text-indigo-500" />}
                                  <p className={`text-[12px] font-black tracking-tight ${isWFH ? 'text-indigo-600' : isTask ? 'text-purple-600' : isSpecial ? 'text-orange-600' : 'text-[#111827]'}`}>
                                      {dayData.shift.startTime} - {dayData.shift.endTime}
                                  </p>
                                </div>
                                <div className={`w-10 h-1.5 rounded-full mx-auto opacity-30 ${isWFH ? 'bg-indigo-500' : isTask ? 'bg-purple-500' : isSpecial ? 'bg-orange-500' : 'bg-blue-500'}`}></div>
                            </div>
                          ) : (
                            <div className="opacity-[0.05] group-hover:opacity-[0.15] transition-opacity">
                                <Moon size={24} className="text-[#9CA3AF]" />
                            </div>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
      {filteredEmployees.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 bg-white rounded-[48px] border-2 border-dashed border-gray-100">
            <div className="bg-gray-50 p-6 rounded-full mb-6">
                <Search className="text-gray-300" size={48} />
            </div>
            <p className="text-gray-400 font-black text-xl uppercase tracking-widest">No colleagues found</p>
        </div>
      )}
    </div>
  );
}
