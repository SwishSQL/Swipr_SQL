
import React, { useState, useEffect, useMemo } from 'react';
import { store } from '../store';
import { User, UserRole, ScheduleDay, DayType, roleLabel, unitOf } from '../types';
import { BRAND_NAMES, BRANDS } from '../brands';
import { format, addDays } from 'date-fns';
import Avatar from '../Avatar';
import { useAuth } from '../App';
import { useLanguage } from '../i18n';
import { Search, ChevronLeft, ChevronRight, Moon, Home, Building2, Phone, Filter, PhoneCall } from 'lucide-react';
import { useCall } from '../calling';

const manualStartOfWeek = (date: Date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day;
  const start = new Date(d.setDate(diff));
  start.setHours(0, 0, 0, 0);
  return start;
};

const ELEVATED_ROLES = [UserRole.BRANCH_MANAGER, UserRole.AREA_MANAGER, UserRole.OPERATION_MANAGER];

// Internal PBX outside-line prefix, dialed before the employee's number.
// Brands not listed here (CHILI, FM) have no prefix yet — dial the number as-is.
const BRAND_DIAL_PREFIX: Record<string, string> = {
  SHAKIR: '8',
  YELO: '7',
  BBT: '4',
  SLICE: '9',
  PATTIE: '6',
  'JUST C': '2',
  MISHMASH: '11',
  TABLE: '12',
};

// Builds a tel: link that dials the brand's line prefix immediately before
// the employee's number (digits only — tel: links can't insert a pause).
const telHref = (phone: string, brand?: string) => {
  const prefix = brand ? BRAND_DIAL_PREFIX[brand.toUpperCase()] || '' : '';
  const digits = phone.replace(/[^\d+]/g, '');
  return `tel:${prefix}${digits}`;
};

// Company-wide, read-only directory of every branch employee/manager across
// every brand and branch, with their shifts and phone numbers — visible to
// every account.
export default function BranchSchedule() {
  const { user } = useAuth();
  const call = useCall();
  const { t } = useLanguage();
  const [employees, setEmployees] = useState<User[]>([]);
  const [schedules, setSchedules] = useState<Record<string, Record<string, ScheduleDay>>>({});
  const [currentWeekStart, setCurrentWeekStart] = useState(manualStartOfWeek(new Date()));
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('All');
  const [selectedBranch, setSelectedBranch] = useState('All');

  useEffect(() => {
    const unsubscribeUsers = store.subscribeToBranchDirectory((all) => {
      const sorted = [...all].sort((a, b) => {
        if (a.id === user?.id) return -1;
        if (b.id === user?.id) return 1;
        const u = unitOf(a).localeCompare(unitOf(b));
        return u !== 0 ? u : a.name.localeCompare(b.name);
      });
      setEmployees(sorted);
    });
    const unsubscribeSchedules = store.subscribeToBranchSchedules(setSchedules);
    return () => {
      unsubscribeUsers();
      unsubscribeSchedules();
    };
  }, [user?.id]);

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));

  const filteredEmployees = employees.filter(e => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = e.name.toLowerCase().includes(q) ||
      e.jobTitle?.toLowerCase().includes(q) ||
      e.phone?.toLowerCase().includes(q) ||
      e.employeeId?.toLowerCase().includes(q);
    const matchesBrand = selectedBrand === 'All' || (e.brand || '').trim().toLowerCase() === selectedBrand.toLowerCase();
    const matchesBranch = selectedBranch === 'All' || (e.branch || '').trim().toLowerCase() === selectedBranch.toLowerCase();
    return matchesSearch && matchesBrand && matchesBranch;
  });

  return (
    <div className="space-y-10 animate-in fade-in duration-700 pb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black text-[#111827] tracking-tight">{t('branchSchedule.title')}</h1>
          <p className="text-[#6B7280] font-medium text-base mt-1">
            Company-wide roster across <span className="text-blue-600 font-bold">every brand and branch</span>
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

      <div className="flex flex-col md:flex-row gap-4 max-w-6xl">
        <div className="relative group flex-1">
          <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-[#D1D5DB] group-focus-within:text-blue-500 transition-colors" size={22} />
          <input
            type="text"
            placeholder={t('branchSchedule.search')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-16 pr-6 py-6 bg-white border border-[#F3F4F6] rounded-[28px] text-base font-bold outline-none focus:ring-4 focus:ring-blue-500/5 shadow-sm transition-all placeholder:text-[#9CA3AF]"
          />
        </div>
        <div className="relative">
          <Building2 className="absolute left-6 top-1/2 -translate-y-1/2 text-purple-500 pointer-events-none" size={20} />
          <select
            value={selectedBrand}
            onChange={(e) => { setSelectedBrand(e.target.value); setSelectedBranch('All'); }}
            className="h-full min-h-[72px] pl-14 pr-10 py-6 bg-white border border-[#F3F4F6] rounded-[28px] text-sm font-black uppercase tracking-widest outline-none focus:ring-4 focus:ring-purple-500/5 shadow-sm appearance-none cursor-pointer min-w-[200px]"
          >
            <option value="All">All Brands</option>
            {BRAND_NAMES.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        {selectedBrand !== 'All' && (
          <div className="relative">
            <Filter className="absolute left-6 top-1/2 -translate-y-1/2 text-purple-500 pointer-events-none" size={18} />
            <select
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className="h-full min-h-[72px] pl-14 pr-10 py-6 bg-white border border-[#F3F4F6] rounded-[28px] text-sm font-black uppercase tracking-widest outline-none focus:ring-4 focus:ring-purple-500/5 shadow-sm appearance-none cursor-pointer min-w-[200px]"
            >
              <option value="All">All Branches</option>
              {(BRANDS[selectedBrand] || []).map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="bg-white rounded-[48px] border border-[#F3F4F6] shadow-2xl shadow-blue-100/20 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1400px] border-collapse">
            <thead>
              <tr className="bg-white">
                <th className="px-10 py-10 text-left text-[11px] font-black text-[#D1D5DB] uppercase tracking-[0.25em] w-[340px]">Employee</th>
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
                        className="w-16 h-16 rounded-[24px] bg-[#F9FAFB] border border-[#F3F4F6] flex items-center justify-center font-black text-blue-600 text-2xl shadow-sm group-hover:bg-white group-hover:shadow-md transition-all shrink-0 overflow-hidden"
                      />
                      <div className="min-w-0">
                        <h3 className="font-black text-[#111827] text-lg leading-tight mb-1 flex items-center gap-2">
                          {emp.name}
                          {ELEVATED_ROLES.includes(emp.role) && (
                            <span className="bg-purple-100 text-purple-700 text-[8px] px-2 py-0.5 rounded-md font-black uppercase tracking-wider shrink-0">{roleLabel(emp.role)}</span>
                          )}
                        </h3>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-black text-[#9CA3AF] uppercase tracking-widest">{emp.jobTitle || 'STAFF'}</span>
                          {unitOf(emp) && (
                            <span className="text-[10px] font-bold text-blue-500 uppercase tracking-widest border-l border-gray-200 pl-2">{unitOf(emp)}</span>
                          )}
                          {emp.id === user?.id && (
                            <span className="bg-blue-50 text-blue-600 text-[8px] font-black px-2 py-0.5 rounded-md uppercase tracking-tighter">YOU</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1.5">
                          {emp.phone && (
                            <a
                              href={telHref(emp.phone, emp.brand)}
                              onClick={(e) => e.stopPropagation()}
                              title={BRAND_DIAL_PREFIX[(emp.brand || '').toUpperCase()] ? `Dials line ${BRAND_DIAL_PREFIX[(emp.brand || '').toUpperCase()]} then the number` : 'Call'}
                              className="flex items-center gap-1.5 text-[11px] font-bold text-gray-500 hover:text-emerald-600 transition-colors w-fit"
                            >
                              <Phone size={11} className="text-emerald-500 shrink-0" />
                              {emp.phone}
                            </a>
                          )}
                          {emp.id !== user?.id && (
                            <button
                              onClick={(e) => { e.stopPropagation(); call.startCall(emp.id, emp.name); }}
                              disabled={call.status !== 'idle'}
                              title={t('call.button')}
                              className="flex items-center gap-1.5 text-[11px] font-bold text-gray-500 hover:text-blue-600 transition-colors w-fit disabled:opacity-40"
                            >
                              <PhoneCall size={11} className="text-blue-500 shrink-0" />
                              {t('call.button')}
                            </button>
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
          <p className="text-gray-400 font-black text-xl uppercase tracking-widest">No branch employees found</p>
        </div>
      )}
    </div>
  );
}
