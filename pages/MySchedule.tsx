
import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../App';
import { useLanguage } from '../i18n';
import { store } from '../store';
import { DayType, SwapStatus, Shift, User, UserRole, ScheduleDay, dayTypeLabel, isBranchRole } from '../types';
import BreakCard from '../BreakCard';
import { addDays, format, differenceInMinutes, isWithinInterval, isBefore, startOfDay } from 'date-fns';
import { Clock, Coffee, ArrowLeftRight, ChevronLeft, ChevronRight, Moon, CheckCircle2, AlertCircle, LogOut, ClipboardList, X, Calendar as CalendarIcon, Home, Thermometer, Palmtree, Star, Timer } from 'lucide-react';

const manualParseISO = (dateStr: string | null | undefined) => {
  if (!dateStr || typeof dateStr !== 'string') return new Date();
  const parts = dateStr.split('-');
  if (parts.length < 3) return new Date();
  const [y, m, d] = parts.map(Number);
  return new Date(y, m - 1, d);
};

const manualStartOfWeek = (date: Date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day;
  const start = new Date(d.setDate(diff));
  start.setHours(0, 0, 0, 0);
  return start;
};

const parseTimeToDate = (timeStr: string | undefined, baseDate: Date) => {
  if (!timeStr || typeof timeStr !== 'string') return new Date(NaN);
  const parts = timeStr.split(':');
  if (parts.length < 2) return new Date(NaN);
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const d = new Date(baseDate);
  d.setHours(hours, minutes, 0, 0);
  return d;
};

const StatusBadge = ({ status, type, minutes }: { status: 'COMPLETED' | 'WORKING' | 'UPCOMING' | 'OFF', type: DayType, minutes?: number }) => {
  if (status === 'OFF') return null;
  
  const isTardy = type === DayType.TARDY;
  const isEarly = type === DayType.EARLY_LEAVE;
  const isTask = type === DayType.TASK;
  const isWFH = type === DayType.WORK_FROM_HOME;

  if (isTardy) return <span className="bg-[#FF4D4D] text-white text-[10px] font-black px-3 py-1 rounded-lg tracking-wider uppercase">LATE ({minutes}M)</span>;
  if (isEarly) return <span className="bg-orange-500 text-white text-[10px] font-black px-3 py-1 rounded-lg tracking-wider uppercase">LEAVE PERM. ({minutes}M)</span>;
  if (isWFH) return <span className="bg-indigo-600 text-white text-[10px] font-black px-3 py-1 rounded-lg tracking-wider uppercase">WORK FROM HOME</span>;

  const styles = {
    COMPLETED: 'bg-[#64748B] text-white',
    WORKING: isTask ? 'bg-purple-600 text-white' : 'bg-[#22C55E] text-white',
    UPCOMING: isTask ? 'bg-purple-400 text-white' : 'bg-[#3B82F6] text-white',
    OFF: 'bg-transparent'
  };

  return (
    <span className={`text-[10px] font-black px-2 py-0.5 rounded-md tracking-wider ${styles[status]}`}>
      {status}
    </span>
  );
};

const OFF_DAY_THEMES: Record<string, { border: string, icon: any, badge: string, bg: string }> = {
  [DayType.DAY_OFF]: { 
    border: 'border-t-blue-500', 
    icon: Moon, 
    badge: 'bg-blue-100 text-blue-700 border-blue-200',
    bg: 'bg-blue-50/10'
  },
  [DayType.ABSENT]: { 
    border: 'border-t-gray-900', 
    icon: Moon, 
    badge: 'bg-gray-900 text-white border-gray-900',
    bg: 'bg-gray-50'
  },
  [DayType.PUBLIC_HOLIDAY]: { 
    border: 'border-t-green-500', 
    icon: Moon, 
    badge: 'bg-green-100 text-green-700 border-green-200',
    bg: 'bg-green-50/10'
  },
  [DayType.ANNUAL_LEAVE]: { 
    border: 'border-t-yellow-500', 
    icon: Moon, 
    badge: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    bg: 'bg-yellow-50/10'
  },
  [DayType.TASK]: {
    border: 'border-t-purple-600',
    icon: ClipboardList,
    badge: 'bg-purple-100 text-purple-700 border-purple-200',
    bg: 'bg-purple-50/20'
  },
  [DayType.SICK]: {
    border: 'border-t-rose-500',
    icon: Thermometer,
    badge: 'bg-rose-100 text-rose-700 border-rose-200',
    bg: 'bg-rose-50/10'
  }
};

export default function MySchedule() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [currentWeekStart, setCurrentWeekStart] = useState(manualStartOfWeek(new Date()));
  const [showSwapModal, setShowSwapModal] = useState<string | null>(null);
  const [targetEmployeeId, setTargetEmployeeId] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [now, setNow] = useState(new Date());
  const [colleagues, setColleagues] = useState<User[]>([]);
  const [mySchedule, setMySchedule] = useState<Record<string, ScheduleDay>>({});

  // Calculate taken days for the current user
  const takenDays = useMemo(() => {
    let annual = 0;
    let publicH = 0;
    Object.values(mySchedule).forEach(day => {
      if (day.type === DayType.ANNUAL_LEAVE) annual++;
      if (day.type === DayType.PUBLIC_HOLIDAY) publicH++;
    });
    return { annual, public: publicH };
  }, [mySchedule]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    const loadData = async () => {
      const allUsers = await store.getUsers();
      setColleagues(allUsers.filter(u => u.id !== user?.id && u.role === UserRole.EMPLOYEE));
      
      if (user) {
        const schedule = await store.getSchedule(user.id);
        setMySchedule(schedule);
      }
    };
    loadData();
    return () => clearInterval(timer);
  }, [user]);

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));
  const todayStart = startOfDay(now);

  const handleSwapRequest = async (myDate: string) => {
    const myDateObj = manualParseISO(myDate);
    const targetDateObj = manualParseISO(targetDate);

    if (isBefore(myDateObj, todayStart) || isBefore(targetDateObj, todayStart)) {
      alert('Swap requests can only be made for current or future shifts.');
      return;
    }

    if (!targetEmployeeId || !targetDate) {
      alert('Please select both a colleague and their shift date.');
      return;
    }

    // Get shifts to include in the request for easy display
    const myShiftData = mySchedule[myDate];
    const targetSchedule = await store.getSchedule(targetEmployeeId);
    const targetShiftData = targetSchedule[targetDate];

    await store.addSwapRequest({
      id: Math.random().toString(),
      requesterId: user!.id,
      targetId: targetEmployeeId,
      requesterDate: myDate,
      targetDate: targetDate,
      status: SwapStatus.PENDING_TARGET,
      originalShift: myShiftData?.shift,
      targetShift: targetShiftData?.shift
    });
    setShowSwapModal(null);
    setTargetEmployeeId('');
    setTargetDate('');
  };

  const getShiftInfo = (shift: Shift, date: Date) => {
    const start = parseTimeToDate(shift.startTime, date);
    const end = parseTimeToDate(shift.endTime, date);
    
    let status: 'COMPLETED' | 'WORKING' | 'UPCOMING' = 'UPCOMING';
    let progress = 0;

    const startValid = !isNaN(start.getTime());
    const endValid = !isNaN(end.getTime());

    if (startValid && endValid) {
      if (now > end) {
        status = 'COMPLETED';
        progress = 100;
      } else if (now > start) {
        status = 'WORKING';
        const total = differenceInMinutes(end, start);
        const elapsed = differenceInMinutes(now, start);
        progress = Math.min(Math.max(Math.round((elapsed / total) * 100), 0), 100);
      }
    }

    return { status, progress };
  };

  return (
    <div className="space-y-8 max-w-[1400px] mx-auto animate-in fade-in duration-500 pb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-900">{t('mySchedule.title')}</h1>
          <p className="text-gray-400 font-medium text-sm mt-1">{t('mySchedule.subtitle')}</p>
        </div>
        <div className="flex items-center bg-white border border-[#E2E8F0] rounded-xl p-1 shadow-sm">
          <button onClick={() => setCurrentWeekStart(addDays(currentWeekStart, -7))} className="p-2 hover:bg-gray-50 rounded-lg text-gray-400">
            <ChevronLeft size={20} />
          </button>
          <div className="px-6 font-black text-[#1E293B] text-xs uppercase tracking-widest text-center min-w-[180px]">
            {format(currentWeekStart, 'MMMM d')} - {format(addDays(currentWeekStart, 6), 'd, yyyy')}
          </div>
          <button onClick={() => setCurrentWeekStart(addDays(currentWeekStart, 7))} className="p-2 hover:bg-gray-50 rounded-lg text-gray-400">
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      {/* Live break clock — the roles that take breaks: branch employees and
          call-centre agents. Leaders watch instead, on the Live Breaks page. */}
      {(user?.role === UserRole.BRANCH_EMPLOYEE || user?.role === UserRole.EMPLOYEE) && <BreakCard role={user.role} />}

      {/* Leave Balance Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-emerald-50 border-2 border-emerald-100 rounded-[32px] p-8 flex flex-col sm:flex-row items-center gap-8 shadow-sm">
          <div className="w-16 h-16 rounded-2xl bg-emerald-600 flex items-center justify-center text-white shadow-lg shrink-0">
            <Palmtree size={32} />
          </div>
          <div className="flex-1 grid grid-cols-3 gap-4 w-full">
            <div className="text-center sm:text-left">
              <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1">{t('mySchedule.totalAnnual')}</p>
              <p className="text-xl font-black text-gray-900">{user?.annualBalance || 0} <span className="text-[10px] text-gray-400">{t('mySchedule.days')}</span></p>
            </div>
            <div className="text-center sm:text-left border-x border-emerald-100 px-4">
              <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1">{t('mySchedule.taken')}</p>
              <p className="text-xl font-black text-gray-900">{takenDays.annual} <span className="text-[10px] text-gray-400">{t('mySchedule.days')}</span></p>
            </div>
            <div className="text-center sm:text-left">
              <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1">{t('mySchedule.remaining')}</p>
              <p className="text-xl font-black text-emerald-900">{(user?.annualBalance || 0) - takenDays.annual} <span className="text-[10px] text-gray-400">{t('mySchedule.days')}</span></p>
            </div>
          </div>
        </div>

        <div className="bg-orange-50 border-2 border-orange-100 rounded-[32px] p-8 flex flex-col sm:flex-row items-center gap-8 shadow-sm">
          <div className="w-16 h-16 rounded-2xl bg-orange-600 flex items-center justify-center text-white shadow-lg shrink-0">
            <Star size={32} />
          </div>
          <div className="flex-1 grid grid-cols-3 gap-4 w-full">
            <div className="text-center sm:text-left">
              <p className="text-[10px] font-black text-orange-600 uppercase tracking-widest mb-1">{t('mySchedule.totalPublic')}</p>
              <p className="text-xl font-black text-gray-900">{user?.publicBalance || 0} <span className="text-[10px] text-gray-400">{t('mySchedule.days')}</span></p>
            </div>
            <div className="text-center sm:text-left border-x border-orange-100 px-4">
              <p className="text-[10px] font-black text-orange-600 uppercase tracking-widest mb-1">{t('mySchedule.taken')}</p>
              <p className="text-xl font-black text-gray-900">{takenDays.public} <span className="text-[10px] text-gray-400">{t('mySchedule.days')}</span></p>
            </div>
            <div className="text-center sm:text-left">
              <p className="text-[10px] font-black text-orange-600 uppercase tracking-widest mb-1">{t('mySchedule.remaining')}</p>
              <p className="text-xl font-black text-gray-900">{(user?.publicBalance || 0) - takenDays.public} <span className="text-[10px] text-gray-400">{t('mySchedule.days')}</span></p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {weekDays.map(day => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const data = mySchedule[dateStr];
          const isShiftLike = data?.type === DayType.NORMAL_SHIFT || data?.type === DayType.WORK_FROM_HOME || data?.type === DayType.TASK || data?.type === DayType.TARDY || data?.type === DayType.EARLY_LEAVE || data?.type === DayType.CANCEL_OFF;
          const isTardy = data?.type === DayType.TARDY;
          const isTask = data?.type === DayType.TASK;
          const isWFH = data?.type === DayType.WORK_FROM_HOME;
          const isPast = isBefore(day, todayStart);
          
          let shiftInfo = data?.shift ? getShiftInfo(data.shift, day) : { status: 'OFF' as const, progress: 0 };
          const theme = data ? OFF_DAY_THEMES[data.type] : OFF_DAY_THEMES[DayType.DAY_OFF];
          const Icon = theme?.icon || Moon;

          if (!isShiftLike) {
            return (
              <div key={dateStr} className={`bg-white rounded-[32px] shadow-sm p-8 flex flex-col h-full relative transition-all hover:shadow-md border-t-4 ${theme?.border || 'border-t-gray-100'} ${theme?.bg || ''}`}>
                <div className="flex justify-between items-start mb-10">
                  <div>
                    <h3 className="font-black text-gray-900 text-xl leading-tight">{format(day, 'EEEE')}</h3>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-0.5">{format(day, 'MMM d')}</p>
                  </div>
                </div>
                <div className="flex-1 flex flex-col items-center justify-center space-y-6">
                  <div className="w-20 h-20 rounded-full bg-gray-50 flex items-center justify-center text-gray-300">
                    <Icon size={40} />
                  </div>
                  <span className={`text-[10px] font-black uppercase tracking-[0.2em] px-4 py-1.5 rounded-full border ${theme?.badge || 'bg-gray-50 text-gray-400 border-gray-100'}`}>
                    {data?.type ? dayTypeLabel(data.type) : 'DAY OFF'}
                  </span>
                </div>
                {!isPast && !isBranchRole(user?.role) && (
                  <button
                    onClick={() => setShowSwapModal(dateStr)}
                    className="mt-10 flex items-center justify-center space-x-2 w-full py-4 text-gray-400 hover:text-blue-500 transition-colors text-[10px] font-black uppercase tracking-widest"
                  >
                    <ArrowLeftRight size={14} />
                    <span>{t('mySchedule.requestSwap')}</span>
                  </button>
                )}
              </div>
            );
          }

          return (
            <div key={dateStr} className={`bg-white rounded-[32px] shadow-sm p-6 flex flex-col h-full relative transition-all hover:shadow-md border border-gray-100 ${isWFH ? 'border-t-4 border-t-indigo-500' : ''}`}>
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="font-black text-gray-900 text-2xl leading-tight">{format(day, 'EEEE')}</h3>
                  <p className="text-sm font-bold text-gray-400 tracking-tight">{format(day, 'MMM d')}</p>
                </div>
                <StatusBadge status={shiftInfo.status === 'OFF' ? 'UPCOMING' : shiftInfo.status} type={data.type} minutes={data.minutes} />
              </div>

              <div className="flex-1 space-y-4">
                <div className={`p-5 rounded-[24px] border ${isTardy ? 'border-[#FFDADA]' : isWFH ? 'border-indigo-100' : isTask ? 'border-purple-100' : 'border-blue-50'} bg-white shadow-sm relative overflow-hidden`}>
                  <div className="flex items-center space-x-4 mb-6 relative z-10">
                    <div className={`w-12 h-12 rounded-full border flex items-center justify-center ${isTardy ? 'border-red-100 text-[#FF4D4D]' : isWFH ? 'border-indigo-100 text-indigo-500' : 'border-blue-100 text-blue-500'}`}>
                      {isWFH ? <Home size={24} /> : <Clock size={24} />}
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-0.5">{isWFH ? t('mySchedule.homeShift') : t('mySchedule.shiftTime')}</p>
                      <p className="text-xl font-black text-gray-900">{data?.shift?.startTime || '--:--'} - {data?.shift?.endTime || '--:--'}</p>
                    </div>
                  </div>
                  
                  <div className="space-y-2 relative z-10">
                    <div className="flex justify-between items-center text-[10px] font-black text-gray-400 uppercase tracking-widest">
                      <span>{t('mySchedule.progress')}</span>
                      <span>{shiftInfo.progress}%</span>
                    </div>
                    <div className="h-2 bg-gray-50 rounded-full overflow-hidden border border-gray-100">
                      <div 
                        className={`h-full transition-all duration-1000 ${isWFH ? 'bg-indigo-600' : isTask ? 'bg-purple-600' : (shiftInfo.status === 'WORKING' ? 'bg-[#22C55E]' : 'bg-[#3B82F6]')}`} 
                        style={{ width: `${shiftInfo.progress}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-[#F8FAFC] rounded-[28px] p-6 border border-gray-50">
                  <div className="flex items-center space-x-3 mb-4">
                    <Coffee size={18} className="text-orange-500" />
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.1em]">{t('mySchedule.breakSchedule')}</p>
                  </div>
                  <div className="space-y-3">
                    {(() => {
                      // A break the manager hasn't set yet has equal start/end
                      // (e.g. the 00:00/00:00 branch-employee placeholder) —
                      // never show that as if it were a real break.
                      const setBreaks = (data?.shift?.breaks || []).filter(br => br.start && br.end && br.start !== br.end);
                      return setBreaks.length > 0 ? setBreaks.map((br) => (
                        <div key={br.id} className="bg-white py-3.5 rounded-[18px] text-center shadow-sm border border-gray-100/50">
                          <span className="text-base font-black text-gray-800">{br.start} - {br.end}</span>
                        </div>
                      )) : (
                        <div className="text-center py-2 opacity-30 text-[10px] font-black uppercase">{t('mySchedule.noBreaks')}</div>
                      );
                    })()}
                  </div>
                </div>

                {!!data?.overtimeHours && (
                  <div className="bg-violet-50 rounded-[28px] p-6 border border-violet-100 flex items-center gap-3">
                    <Timer size={18} className="text-violet-600 shrink-0" />
                    <div>
                      <p className="text-[10px] font-black text-violet-500 uppercase tracking-[0.1em]">{t('mySchedule.overtime')}</p>
                      <p className="text-base font-black text-violet-900">{data.overtimeHours}{t('mySchedule.overtimeAdded')}</p>
                    </div>
                  </div>
                )}
              </div>

              {!isPast && !isBranchRole(user?.role) && (
                <button
                  onClick={() => setShowSwapModal(dateStr)}
                  className="mt-6 flex items-center justify-center space-x-2 w-full py-4 text-gray-400 hover:text-blue-500 transition-colors text-[11px] font-black uppercase tracking-[0.1em] group"
                >
                  <AlertCircle size={16} />
                  <span>{t('mySchedule.requestSwap')}</span>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {showSwapModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-md">
          <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in duration-200">
            <div className="px-8 py-6 bg-blue-600 text-white flex justify-between items-center">
              <h3 className="font-black text-xl tracking-tight">Cross-Day Swap Request</h3>
              <button onClick={() => setShowSwapModal(null)} className="p-2 hover:bg-blue-700 rounded-full"><X size={24} /></button>
            </div>
            <div className="p-10 space-y-8">
              <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100">
                <p className="text-xs font-black text-blue-400 uppercase tracking-widest mb-1">My Shift Date</p>
                <p className="text-sm font-bold text-blue-900">{format(manualParseISO(showSwapModal), 'EEEE, MMMM do, yyyy')}</p>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Select Colleague</label>
                  <select 
                    value={targetEmployeeId} 
                    onChange={e => setTargetEmployeeId(e.target.value)}
                    className="w-full p-4 rounded-2xl border border-gray-200 text-sm font-bold bg-gray-50 outline-none focus:ring-4 focus:ring-blue-500/10 transition-all appearance-none"
                  >
                    <option value="">Choose colleague...</option>
                    {colleagues.map(e => <option key={e.id} value={e.id}>{e.name} ({e.jobTitle})</option>)}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Their Shift Date (Target Date)</label>
                  <div className="relative">
                    <CalendarIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input 
                      type="date"
                      value={targetDate}
                      min={format(now, 'yyyy-MM-dd')}
                      onChange={e => setTargetDate(e.target.value)}
                      className="w-full pl-12 pr-4 py-4 rounded-2xl border border-gray-200 text-sm font-bold bg-gray-50 outline-none focus:ring-4 focus:ring-blue-500/10 transition-all"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-col space-y-3">
                <button 
                  onClick={() => handleSwapRequest(showSwapModal)}
                  disabled={!targetEmployeeId || !targetDate}
                  className="w-full bg-blue-600 text-white py-5 rounded-[24px] font-black text-sm uppercase tracking-widest shadow-xl shadow-blue-200 hover:bg-blue-700 disabled:opacity-50 transition-all active:scale-95 flex items-center justify-center space-x-2"
                >
                  <ArrowLeftRight size={18} />
                  <span>Send Proposal</span>
                </button>
                <button onClick={() => setShowSwapModal(null)} className="w-full py-2 text-xs font-black text-gray-400 hover:text-gray-600 uppercase tracking-widest">Discard</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
