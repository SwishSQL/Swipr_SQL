
import React, { useState, useEffect } from 'react';
import { useAuth } from '../App';
import { useLanguage } from '../i18n';
import { store } from '../store';
import { DayType, LeaveRequest, LeaveStatus, User, UserRole, dayTypeLabel } from '../types';
import { format } from 'date-fns';
import { 
  Send, 
  History, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Calendar as CalendarIcon, 
  User as UserIcon,
  ShieldCheck,
  Check,
  X,
  FileText
} from 'lucide-react';

export default function Requests() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [leaveType, setLeaveType] = useState<DayType>(DayType.ANNUAL_LEAVE);
  const [date, setDate] = useState('');
  const [earlyLeaveTime, setEarlyLeaveTime] = useState('');
  const [managerId, setManagerId] = useState('');
  const [history, setHistory] = useState<LeaveRequest[]>([]);
  const [managers, setManagers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;

    const userCompany = (user.companyName || '').trim().toLowerCase();

    const unsubscribeLeaves = store.subscribeToLeaveRequests((leaves) => {
      let filtered = leaves;
      if (user.role === UserRole.EMPLOYEE) {
        filtered = leaves.filter(l => l.userId === user.id);
      } else if (user.role === UserRole.MANAGER) {
        filtered = leaves.filter(l => 
          (l.companyName || '').trim().toLowerCase() === userCompany && 
          (l.managerId === user.id || l.status === LeaveStatus.PENDING)
        );
      } else if (user.role === UserRole.SUPERVISOR) {
        filtered = leaves.filter(l => (l.companyName || '').trim().toLowerCase() === userCompany);
      } else if (user.role === UserRole.ADMIN) {
        filtered = leaves; // admin sees everything
      }
      setHistory(filtered);
    });

    const unsubscribeUsers = store.subscribeToUsers((users) => {
      // Approvers = managers AND supervisors in the same company (some teams
      // have only a supervisor and no manager).
      const companyManagers = users.filter(u =>
        (u.companyName || '').trim().toLowerCase() === userCompany &&
        (u.role === UserRole.MANAGER || u.role === UserRole.SUPERVISOR) &&
        u.id !== user.id
      );
      setManagers(companyManagers);
    });

    return () => {
      unsubscribeLeaves();
      unsubscribeUsers();
    };
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !date || (leaveType === DayType.EARLY_LEAVE && !earlyLeaveTime)) return;

    setIsLoading(true);
    try {
      const newRequestId = Math.random().toString(36).substr(2, 12);
      const newRequest: LeaveRequest = {
        id: newRequestId,
        userId: user.id,
        userName: user.name,
        type: leaveType,
        date,
        // CRITICAL FIX: Replace undefined with null or omit. Firestore rejects undefined.
        earlyLeaveTime: leaveType === DayType.EARLY_LEAVE ? earlyLeaveTime : null as any,
        status: LeaveStatus.PENDING,
        companyName: user.companyName || 'Corporate',
        managerId: managerId,
        createdAt: Date.now()
      };
      await store.addLeaveRequest(newRequest);
      setDate('');
      setEarlyLeaveTime('');
      setManagerId('');
      alert('Request sent successfully!');
    } catch (err) {
      console.error("Submit error:", err);
      alert('Failed to send request.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAction = async (id: string, status: LeaveStatus) => {
    if (processingId) return;
    
    setProcessingId(id);
    try {
      const success = await store.updateLeaveRequestStatus(id, status);
      if (!success) {
        alert('Action could not be completed.');
      }
    } catch (err) {
      console.error("Action error:", err);
      alert('Action failed.');
    } finally {
      setProcessingId(null);
    }
  };

  const isManagement = user?.role === UserRole.MANAGER || user?.role === UserRole.SUPERVISOR || user?.role === UserRole.ADMIN;

  return (
    <div className="max-w-7xl mx-auto space-y-12 pb-24 animate-in fade-in duration-700">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black text-[#0F172A] tracking-tight">{t('requests.title')}</h1>
          <p className="text-gray-400 font-medium text-lg mt-1">Manage your leave and holiday requests</p>
        </div>
      </div>

      {user?.role === UserRole.EMPLOYEE && (
        <div className="bg-white p-10 rounded-[48px] border border-gray-100 shadow-2xl shadow-blue-50/20 space-y-10">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl shadow-sm">
              <FileText size={24} />
            </div>
            <h2 className="text-2xl font-black text-[#0F172A] tracking-tight">New Request</h2>
          </div>

          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-10 items-end">
            <div className="space-y-3">
              <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest ml-1">Date</label>
              <div className="relative">
                <CalendarIcon className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-300" size={18} />
                <input 
                  type="date" 
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="w-full pl-14 pr-6 py-4 bg-[#F9FAFB] border border-gray-100 rounded-[20px] font-bold text-gray-900 outline-none focus:ring-4 focus:ring-blue-500/5 focus:bg-white transition-all"
                  required
                />
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest ml-1">Type</label>
              <select 
                value={leaveType}
                onChange={e => setLeaveType(e.target.value as DayType)}
                className="w-full px-6 py-4 bg-[#F9FAFB] border border-gray-100 rounded-[20px] font-bold text-gray-900 outline-none focus:ring-4 focus:ring-blue-500/5 focus:bg-white transition-all appearance-none cursor-pointer"
              >
                <option value={DayType.ANNUAL_LEAVE}>Annual Leave</option>
                <option value={DayType.PUBLIC_HOLIDAY}>Public Holiday</option>
                <option value={DayType.EARLY_LEAVE}>Leave with Permission</option>
              </select>
            </div>

            <div className="space-y-3">
              <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest ml-1">Manager</label>
              <div className="relative">
                <UserIcon className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-300" size={18} />
                <select 
                  value={managerId}
                  onChange={e => setManagerId(e.target.value)}
                  className="w-full pl-14 pr-10 py-4 bg-[#F9FAFB] border border-gray-100 rounded-[20px] font-bold text-gray-900 outline-none focus:ring-4 focus:ring-blue-500/5 focus:bg-white transition-all appearance-none cursor-pointer"
                  required
                >
                  <option value="">{managers.length === 0 ? 'No approver in your team' : 'Select manager'}</option>
                  {managers.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.role === UserRole.SUPERVISOR ? 'Supervisor' : 'Manager'})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {leaveType === DayType.EARLY_LEAVE && (
              <div className="space-y-3 md:col-span-1 animate-in slide-in-from-top-4 duration-300">
                <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest ml-1">Leave Time</label>
                <div className="relative">
                  <Clock className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-300" size={18} />
                  <input 
                    type="time" 
                    value={earlyLeaveTime}
                    onChange={e => setEarlyLeaveTime(e.target.value)}
                    className="w-full pl-14 pr-6 py-4 bg-[#F9FAFB] border border-gray-100 rounded-[20px] font-bold text-gray-900 outline-none focus:ring-4 focus:ring-blue-500/5 focus:bg-white transition-all"
                    required
                  />
                </div>
              </div>
            )}

            <div className="md:col-span-1">
              <button 
                type="submit" 
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-3 px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-[20px] font-black text-xs uppercase tracking-widest shadow-xl shadow-blue-100 transition-all active:scale-[0.98] disabled:opacity-50"
              >
                <Send size={18} />
                {isLoading ? 'Sending...' : 'Send Request'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-gray-900 text-white rounded-2xl shadow-xl">
              <History size={24} />
            </div>
            <h2 className="text-2xl font-black text-[#0F172A] tracking-tight">Request History</h2>
          </div>
          {isManagement && (
             <div className="flex items-center gap-2 px-5 py-2.5 bg-purple-50 text-purple-700 rounded-full border border-purple-100 shadow-sm">
               <ShieldCheck size={18} />
               <span className="text-[10px] font-black uppercase tracking-widest">Company Review Mode</span>
             </div>
          )}
        </div>

        <div className="grid gap-6">
          {history.length === 0 ? (
            <div className="bg-white p-24 rounded-[48px] border border-gray-50 text-center shadow-sm">
               <div className="bg-gray-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
                  <History size={40} className="text-gray-200" />
               </div>
               <p className="text-gray-300 font-black text-sm uppercase tracking-widest">No request history found.</p>
            </div>
          ) : (
            history.map(req => (
              <div key={req.id} className="bg-white p-6 md:p-8 rounded-[44px] border border-blue-100/50 shadow-xl shadow-blue-50/10 flex flex-col md:flex-row items-center justify-between gap-10 group transition-all duration-300 hover:border-blue-400/30">
                <div className="flex items-center gap-8 flex-1">
                  <div className={`w-20 h-20 rounded-[30px] flex items-center justify-center font-black text-white text-3xl shadow-2xl transition-all ${
                    req.status === LeaveStatus.APPROVED ? 'bg-emerald-500 shadow-emerald-100' :
                    req.status === LeaveStatus.REJECTED ? 'bg-rose-500 shadow-rose-100' :
                    'bg-blue-600 shadow-blue-200'
                  }`}>
                    {req.userName.charAt(0)}
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center gap-4 flex-wrap">
                      <h3 className="font-black text-2xl text-[#0F172A] tracking-tight">{req.userName}</h3>
                      <span className={`px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border-2 ${
                        req.status === LeaveStatus.APPROVED ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                        req.status === LeaveStatus.REJECTED ? 'bg-rose-50 text-rose-600 border-rose-100' :
                        'bg-blue-50 text-blue-600 border-blue-100'
                      }`}>
                        {req.status}
                      </span>
                    </div>
                    <div className="flex flex-col md:flex-row md:items-center gap-5 text-gray-400 font-bold text-[11px] uppercase tracking-widest">
                       <span className="flex items-center gap-2"><CalendarIcon size={16} className="text-gray-300" /> {format(new Date(req.date.replace(/-/g, '/')), 'EEE, MMM d, yyyy').toUpperCase()}</span>
                       <span className="flex items-center gap-2"><Clock size={16} className="text-gray-300" /> {dayTypeLabel(req.type)} {req.earlyLeaveTime && `AT ${req.earlyLeaveTime}`}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-5 shrink-0">
                  {isManagement && req.status === LeaveStatus.PENDING ? (
                    <div className="flex items-center gap-4">
                      <button 
                        onClick={() => handleAction(req.id, LeaveStatus.REJECTED)}
                        disabled={!!processingId}
                        className="w-14 h-14 rounded-2xl bg-white border border-gray-100 text-rose-500 hover:bg-rose-500 hover:border-rose-100 transition-all flex items-center justify-center shadow-sm active:scale-90"
                      >
                        <X size={24} />
                      </button>
                      <button 
                        onClick={() => handleAction(req.id, LeaveStatus.APPROVED)}
                        disabled={!!processingId}
                        className="px-14 py-4 rounded-[22px] bg-[#004128] text-white font-black text-[13px] uppercase tracking-[0.2em] shadow-2xl shadow-emerald-900/10 hover:bg-[#00301d] transition-all flex items-center justify-center gap-3 active:scale-[0.97]"
                      >
                        {processingId === req.id ? (
                           <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        ) : (
                          <Check size={22} className="text-emerald-300" />
                        )}
                        APPROVE
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 px-6 py-3 bg-gray-50 rounded-2xl border border-gray-100 shadow-inner">
                       {req.status === LeaveStatus.APPROVED ? <CheckCircle2 className="text-emerald-500" size={22} /> : 
                        req.status === LeaveStatus.REJECTED ? <XCircle className="text-rose-500" size={22} /> : 
                        <Clock className="text-blue-500" size={22} />}
                       <span className="text-[11px] font-black text-gray-500 uppercase tracking-widest">
                         {req.status === LeaveStatus.PENDING ? 'PENDING' : `PROCESSED`}
                       </span>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
