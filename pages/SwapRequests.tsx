
import React, { useState, useEffect, useMemo, useRef, ReactElement } from 'react';
import { useAuth } from '../App';
import { useLanguage } from '../i18n';
import { store } from '../store';
import { SwapStatus, UserRole, User, SwapRequest } from '../types';
import { ArrowLeftRight, Check, X, Clock, MoveRight, Inbox, ShieldCheck } from 'lucide-react';
import { format, isValid } from 'date-fns';

const manualParseISO = (dateStr: string | undefined | null): Date => {
  if (!dateStr || typeof dateStr !== 'string') return new Date();
  const parts = dateStr.split('-');
  if (parts.length < 3) return new Date();
  try {
    const [y, m, d] = parts.map(Number);
    const date = new Date(y, m - 1, d);
    return isValid(date) ? date : new Date();
  } catch {
    return new Date();
  }
};

interface MappedSwapRequest extends SwapRequest {
  requester?: User;
  target?: User;
}

const SwapRequests = (): ReactElement => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [rawSwaps, setRawSwaps] = useState<SwapRequest[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [visibleCount, setVisibleCount] = useState(20);
  const swapSig = useRef('');
  const userSig = useRef('');

  useEffect(() => {
    if (!user) return;
    // Only update state when the polled data actually changed — otherwise the
    // 5s polling would re-render every card needlessly.
    const unsubscribeUsers = store.subscribeToUsers((users) => {
      const sig = users.map(u => `${u.id}:${u.name || ''}:${u.companyName || ''}`).join('|');
      if (sig === userSig.current) return;
      userSig.current = sig;
      setAllUsers(users);
    });
    const unsubscribeSwaps = store.subscribeToSwaps((swaps) => {
      setLoading(false);
      const sig = swaps.map(s => `${s.id}:${s.status}`).join('|');
      if (sig === swapSig.current) return;
      swapSig.current = sig;
      setRawSwaps(swaps);
    });
    return () => {
      unsubscribeUsers();
      unsubscribeSwaps();
    };
  }, [user]);

  // Map + filter from the latest users and swaps; avoids the race where swaps
  // arrive before the user list is populated.
  const requests = useMemo<MappedSwapRequest[]>(() => {
    if (!user) return [];
    const usersById = new Map(allUsers.map(u => [u.id, u]));
    const mapped: MappedSwapRequest[] = rawSwaps.map(r => ({
      ...r,
      requester: usersById.get(r.requesterId),
      target: usersById.get(r.targetId)
    }));

    let filtered: MappedSwapRequest[] = [];
    if (user.role === UserRole.SUPERVISOR || user.role === UserRole.ADMIN) {
      filtered = mapped;
    } else if (user.role === UserRole.MANAGER) {
      const company = user.companyName?.toLowerCase() || '';
      filtered = mapped.filter(r =>
        (r.requester?.companyName?.toLowerCase() === company ||
         r.target?.companyName?.toLowerCase() === company) &&
        r.status !== SwapStatus.REJECTED
      );
    } else {
      filtered = mapped.filter(r => (r.requesterId === user.id || r.targetId === user.id));
    }

    // Pending requests first (those needing action), then approved, then
    // rejected. Within each group keep newest-first (reverse of arrival).
    const rank = (s: SwapStatus) => {
      switch (s) {
        case SwapStatus.PENDING_MANAGER: return 0;
        case SwapStatus.PENDING_TARGET: return 1;
        case SwapStatus.APPROVED: return 2;
        case SwapStatus.REJECTED: return 3;
        default: return 4;
      }
    };
    return [...filtered].reverse().sort((a, b) => rank(a.status) - rank(b.status));
  }, [user, allUsers, rawSwaps]);

  const handleAction = async (id: string, nextStatus: SwapStatus) => {
    try {
      await store.updateSwapRequest(id, nextStatus);
    } catch (err) {
      console.error("Failed to update swap:", err);
      alert("Something went wrong.");
    }
  };

  const getStatusLabel = (status: SwapStatus) => {
    switch(status) {
      case SwapStatus.PENDING_TARGET: return { label: 'Colleague Approval', color: 'bg-yellow-50 text-yellow-700 border-yellow-100' };
      case SwapStatus.PENDING_MANAGER: return { label: 'Manager Approval', color: 'bg-blue-50 text-blue-700 border-blue-100' };
      case SwapStatus.APPROVED: return { label: 'Approved & Swapped', color: 'bg-green-50 text-green-700 border-green-100' };
      case SwapStatus.REJECTED: return { label: 'Rejected', color: 'bg-red-50 text-red-700 border-red-100' };
      default: return { label: 'Processing', color: 'bg-gray-50 text-gray-500 border-gray-100' };
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 space-y-4">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-100 border-b-blue-600"></div>
        <p className="text-gray-400 font-black text-xs uppercase tracking-[0.2em]">Syncing Swaps...</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white p-8 rounded-[32px] border border-gray-100 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-black text-gray-900 tracking-tight">{t('swaps.title')}</h1>
            <div className="flex items-center gap-2 px-3 py-1 bg-green-50 text-green-600 rounded-full border border-green-100">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-[10px] font-black uppercase tracking-widest">Live Updates</span>
            </div>
          </div>
          <p className="text-gray-400 font-medium text-sm mt-1">
            {user?.role === UserRole.SUPERVISOR ? 'Monitoring all global shift exchanges.' : 'Track and manage your team\'s shift proposals.'}
          </p>
        </div>
        
        {user?.role === UserRole.SUPERVISOR && (
          <div className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white rounded-2xl shadow-xl shadow-gray-200">
            <ShieldCheck size={18} className="text-blue-400" />
            <span className="text-xs font-black uppercase tracking-widest">Global Supervisor</span>
          </div>
        )}
      </div>

      <div className="grid gap-6">
        {requests.length === 0 ? (
          <div className="bg-white p-24 rounded-[48px] border-2 border-dashed border-gray-100 text-center">
            <div className="bg-gray-50 w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-8">
              <Inbox className="text-gray-200" size={48} />
            </div>
            <h3 className="text-xl font-black text-gray-400 uppercase tracking-widest">No Swap Requests</h3>
            <p className="text-gray-300 text-sm mt-2 font-medium">Any incoming or outgoing shift exchanges will appear here.</p>
          </div>
        ) : (
          requests.slice(0, visibleCount).map(req => {
            const statusInfo = getStatusLabel(req.status);
            const isTarget = req.targetId === user?.id;
            const isManager = user?.role === UserRole.MANAGER;
            const isSupervisor = user?.role === UserRole.SUPERVISOR || user?.role === UserRole.ADMIN;

            return (
              <div key={req.id} className="bg-white p-8 md:p-10 rounded-[48px] border border-gray-100 shadow-2xl shadow-blue-100/10 flex flex-col lg:flex-row lg:items-center justify-between gap-10 hover:border-blue-200 transition-all duration-500 group relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1.5 h-full bg-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                
                <div className="flex flex-col md:flex-row items-center gap-10">
                  <div className="flex -space-x-6 relative">
                    <div className="w-20 h-20 rounded-[28px] border-[6px] border-white bg-blue-600 flex items-center justify-center font-black text-white text-2xl shadow-2xl shadow-blue-200 transition-transform group-hover:-translate-x-2">
                      {req.requester?.name?.charAt(0) || '?'}
                    </div>
                    <div className="w-20 h-20 rounded-[28px] border-[6px] border-white bg-gray-900 flex items-center justify-center font-black text-white text-2xl shadow-2xl shadow-gray-200 transition-transform group-hover:translate-x-2">
                      {req.target?.name?.charAt(0) || '?'}
                    </div>
                  </div>

                  <div className="space-y-6 flex-1 text-center md:text-left">
                    <div className="flex flex-wrap items-center justify-center md:justify-start gap-4">
                      <div className="space-y-1">
                         <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] block">Requester</span>
                         <span className="font-black text-gray-900 text-lg">{req.requester?.name || 'Unknown'}</span>
                      </div>
                      <div className="p-3 bg-gray-50 rounded-2xl text-gray-300 mx-2">
                        <ArrowLeftRight size={20} />
                      </div>
                      <div className="space-y-1">
                         <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] block">Receiver</span>
                         <span className="font-black text-gray-900 text-lg">{req.target?.name || 'Unknown'}</span>
                      </div>
                    </div>

                    <div className="flex flex-col md:flex-row gap-4">
                      <div className="flex items-center gap-4 bg-blue-50/50 px-6 py-4 rounded-[24px] border border-blue-50 transition-all group-hover:bg-white group-hover:shadow-lg">
                        <div className="p-2 bg-white rounded-xl shadow-sm"><Clock size={16} className="text-blue-500" /></div>
                        <div>
                            <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest block">Giving away</span>
                            <span className="text-sm font-black text-gray-900 block">{format(manualParseISO(req.requesterDate), 'EEEE, MMM d')}</span>
                            <span className="text-[11px] font-bold text-blue-600">{req.originalShift ? `${req.originalShift.startTime} - ${req.originalShift.endTime}` : 'No Shift Set'}</span>
                        </div>
                      </div>
                      <div className="hidden md:flex items-center text-gray-100">
                        <MoveRight size={24} />
                      </div>
                      <div className="flex items-center gap-4 bg-gray-50 px-6 py-4 rounded-[24px] border border-gray-100 transition-all group-hover:bg-white group-hover:shadow-lg">
                        <div className="p-2 bg-white rounded-xl shadow-sm"><Clock size={16} className="text-gray-400" /></div>
                        <div>
                            <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest block">Receiving</span>
                            <span className="text-sm font-black text-gray-900 block">{format(manualParseISO(req.targetDate), 'EEEE, MMM d')}</span>
                            <span className="text-[11px] font-bold text-gray-500">{req.targetShift ? `${req.targetShift.startTime} - ${req.targetShift.endTime}` : 'No Shift Set'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-5 bg-gray-50/50 p-6 rounded-[32px] border border-gray-50">
                  <div className="flex flex-col items-center sm:items-end">
                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2">Request Status</span>
                    <span className={`px-6 py-2.5 rounded-full text-[10px] font-black uppercase tracking-[0.15em] border-2 shadow-sm ${statusInfo.color}`}>
                        {statusInfo.label}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    {isTarget && req.status === SwapStatus.PENDING_TARGET && (
                      <div className="flex gap-2">
                        <button 
                          onClick={() => handleAction(req.id, SwapStatus.REJECTED)}
                          className="w-14 h-14 bg-white border border-red-100 text-red-500 hover:bg-red-500 hover:text-white rounded-2xl flex items-center justify-center transition-all shadow-sm active:scale-90"
                          title="Decline Swap"
                        >
                          <X size={24} />
                        </button>
                        <button 
                          onClick={() => handleAction(req.id, SwapStatus.PENDING_MANAGER)}
                          className="bg-blue-600 text-white px-8 h-14 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-blue-200 hover:bg-blue-700 transition-all active:scale-95 flex items-center gap-3"
                        >
                          <Check size={20} />
                          <span>Accept</span>
                        </button>
                      </div>
                    )}

                    {(isManager || isSupervisor) && req.status === SwapStatus.PENDING_MANAGER && (
                      <div className="flex gap-2">
                        <button 
                          onClick={() => handleAction(req.id, SwapStatus.REJECTED)}
                          className="w-14 h-14 bg-white border border-red-100 text-red-500 hover:bg-red-500 hover:text-white rounded-2xl flex items-center justify-center transition-all shadow-sm active:scale-90"
                          title="Reject as Manager"
                        >
                          <X size={24} />
                        </button>
                        <button 
                          onClick={() => handleAction(req.id, SwapStatus.APPROVED)}
                          className="bg-emerald-600 text-white px-8 h-14 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-emerald-200 hover:bg-emerald-700 transition-all active:scale-95 flex items-center gap-3"
                        >
                          <Check size={20} />
                          <span>Approve Swap</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {requests.length > visibleCount && (
        <div className="flex flex-col items-center gap-3 pt-2">
          <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest">
            Showing {Math.min(visibleCount, requests.length)} of {requests.length}
          </p>
          <button
            onClick={() => setVisibleCount(c => c + 20)}
            className="px-8 py-3.5 bg-gray-900 text-white rounded-2xl font-black text-[11px] uppercase tracking-widest hover:bg-black transition-all active:scale-95 shadow-lg shadow-gray-200"
          >
            Show more
          </button>
        </div>
      )}
    </div>
  );
};

export default SwapRequests;
