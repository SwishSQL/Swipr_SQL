import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../App';
import { useLanguage } from '../i18n';
import { store } from '../store';
import { AuditEntry, UserRole } from '../types';
import { format, formatDistanceToNow } from 'date-fns';
import {
  History, Search, ShieldCheck, Calendar, Users as UsersIcon, ArrowLeftRight,
  Palmtree, Star, LayoutGrid, Activity, Lock
} from 'lucide-react';

interface Category {
  label: string;
  match: (action: string) => boolean;
  badge: string;
  icon: any;
}

const CATEGORIES: Record<string, Category> = {
  schedule: { label: 'Schedule', match: a => a.startsWith('schedule.'), badge: 'bg-blue-100 text-blue-700 border-blue-200', icon: Calendar },
  user: { label: 'User', match: a => a.startsWith('user.'), badge: 'bg-purple-100 text-purple-700 border-purple-200', icon: UsersIcon },
  swap: { label: 'Swap', match: a => a.startsWith('swap.'), badge: 'bg-amber-100 text-amber-700 border-amber-200', icon: ArrowLeftRight },
  leave: { label: 'Leave', match: a => a.startsWith('leave.'), badge: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: Palmtree },
  holiday: { label: 'Holiday', match: a => a.startsWith('holiday.'), badge: 'bg-orange-100 text-orange-700 border-orange-200', icon: Star },
  template: { label: 'Template', match: a => a.startsWith('template.'), badge: 'bg-indigo-100 text-indigo-700 border-indigo-200', icon: LayoutGrid },
};

const categoryOf = (action: string): Category =>
  Object.values(CATEGORIES).find(c => c.match(action)) || {
    label: 'Other', match: () => true, badge: 'bg-gray-100 text-gray-600 border-gray-200', icon: Activity,
  };

const FILTERS = ['All', 'Schedule', 'User', 'Swap', 'Leave', 'Holiday', 'Template'];

export default function AuditLog() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  // Local date strings (YYYY-MM-DD), compared against each entry's local day
  // — not UTC — so "today" picks up everything logged today regardless of
  // the viewer's timezone offset from UTC.
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const isSupervisor = user?.role === UserRole.ADMIN;

  useEffect(() => {
    if (!isSupervisor) return;
    // Pull the max the server allows (2000) rather than the default 500, so
    // a date-range filter can actually reach further back than "recently".
    const unsub = store.subscribeToAuditLog((data) => {
      setEntries(data);
      setLoading(false);
    }, 2000);
    return () => unsub();
  }, [isSupervisor]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Compared as local 'YYYY-MM-DD' strings so the boundary matches what
    // the date picker shows, not a UTC day boundary.
    const toLocalDay = (ts: number) => {
      const d = new Date(ts);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    return entries.filter(e => {
      if (filter !== 'All' && categoryOf(e.action).label !== filter) return false;
      const day = toLocalDay(e.ts);
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
      if (!q) return true;
      return (
        (e.summary || '').toLowerCase().includes(q) ||
        (e.actorName || '').toLowerCase().includes(q) ||
        (e.action || '').toLowerCase().includes(q)
      );
    });
  }, [entries, search, filter, dateFrom, dateTo]);

  const clearDateRange = () => { setDateFrom(''); setDateTo(''); };

  if (!isSupervisor) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <div className="bg-rose-50 w-20 h-20 rounded-full flex items-center justify-center mb-6">
          <Lock className="text-rose-400" size={36} />
        </div>
        <h2 className="text-xl font-black text-gray-400 uppercase tracking-widest">{t('audit.supervisorOnly')}</h2>
        <p className="text-gray-300 text-sm mt-2 font-medium">The activity log is restricted to supervisors.</p>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto space-y-8 pb-24 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-black text-gray-900 tracking-tight">{t('audit.title')}</h1>
            <span className="flex items-center gap-1.5 px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-[10px] font-black uppercase tracking-widest border border-purple-200">
              <ShieldCheck size={12} /> Supervisor Access
            </span>
          </div>
          <p className="text-gray-400 font-medium text-sm mt-1">Every change made on the system — who did it and when.</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-100 rounded-2xl shadow-sm">
          <History size={16} className="text-blue-500" />
          <span className="text-[10px] font-black text-gray-600 uppercase tracking-widest">{entries.length} events</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative group flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
          <input
            type="text"
            placeholder={t('audit.search')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-12 pr-4 py-3 rounded-2xl bg-gray-50 border border-gray-100 text-gray-900 focus:ring-4 focus:ring-blue-500/10 focus:bg-white outline-none text-sm font-medium placeholder:text-gray-400 transition-all"
          />
        </div>
        <div className="flex items-center gap-1.5 p-1 bg-gray-50 border border-gray-100 rounded-2xl overflow-x-auto hide-scrollbar">
          {FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all ${
                filter === f ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-400 hover:bg-white'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Date range */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-2xl">
          <Calendar size={15} className="text-gray-400 shrink-0" />
          <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest shrink-0">{t('audit.from')}</span>
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={e => setDateFrom(e.target.value)}
            className="bg-transparent text-xs font-black text-gray-900 outline-none"
          />
        </div>
        <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-2xl">
          <Calendar size={15} className="text-gray-400 shrink-0" />
          <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest shrink-0">{t('audit.to')}</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={e => setDateTo(e.target.value)}
            className="bg-transparent text-xs font-black text-gray-900 outline-none"
          />
        </div>
        {(dateFrom || dateTo) && (
          <button
            onClick={clearDateRange}
            className="text-[10px] font-black uppercase tracking-widest text-blue-500 hover:text-blue-700 transition-colors"
          >
            {t('audit.clearDates')}
          </button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 space-y-4">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-blue-100 border-b-blue-600"></div>
          <p className="text-gray-400 font-black text-xs uppercase tracking-[0.2em]">Loading activity...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white p-20 rounded-[40px] border-2 border-dashed border-gray-100 text-center">
          <div className="bg-gray-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
            <History className="text-gray-200" size={40} />
          </div>
          <p className="text-gray-300 font-black text-sm uppercase tracking-widest">No activity found</p>
        </div>
      ) : (
        <div className="bg-white rounded-[32px] border border-gray-100 shadow-sm divide-y divide-gray-50 overflow-hidden">
          {filtered.map(e => {
            const cat = categoryOf(e.action);
            const Icon = cat.icon;
            const when = new Date(e.ts);
            return (
              <div key={e.id} className="flex items-start gap-4 p-5 hover:bg-gray-50/50 transition-colors">
                <div className={`shrink-0 w-11 h-11 rounded-2xl border flex items-center justify-center ${cat.badge}`}>
                  <Icon size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={`px-2.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest border ${cat.badge}`}>
                      {cat.label}
                    </span>
                    <span className="font-bold text-gray-900 text-sm leading-tight break-words">{e.summary || e.action}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1.5 text-[11px] font-bold">
                    <span className="text-blue-600 uppercase tracking-wide">{e.actorName || 'System'}</span>
                    <span className="text-gray-300">•</span>
                    <span className="text-gray-400" title={format(when, 'PPpp')}>{format(when, 'MMM d, HH:mm')}</span>
                    <span className="text-gray-300">•</span>
                    <span className="text-gray-300">{formatDistanceToNow(when, { addSuffix: true })}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
