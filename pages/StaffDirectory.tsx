import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../App';
import { useLanguage } from '../i18n';
import { store } from '../store';
import { DirectoryContact, roleLabel } from '../types';
import { useCall } from '../calling';
import { Search, PhoneCall, Users, Headphones, Loader2 } from 'lucide-react';

// Colour per department so a long list stays scannable.
const DEPT_STYLE: Record<string, string> = {
  'call center': 'bg-blue-100 text-blue-700 border-blue-200',
  technical: 'bg-purple-100 text-purple-700 border-purple-200',
  complain: 'bg-amber-100 text-amber-700 border-amber-200',
  quality: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};
const deptStyle = (d: string) =>
  DEPT_STYLE[d.trim().toLowerCase()] || 'bg-gray-100 text-gray-600 border-gray-200';

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

export default function StaffDirectory() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const call = useCall();
  const [contacts, setContacts] = useState<DirectoryContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('All');

  useEffect(() => {
    let alive = true;
    store.getStaffDirectory()
      .then((data) => { if (alive) { setContacts(data); setLoading(false); } })
      .catch(() => { if (alive) { setFailed(true); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  const departments = useMemo(() => {
    const set = new Set(contacts.map((c) => c.department).filter(Boolean));
    return ['All', ...Array.from(set).sort()];
  }, [contacts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts
      .filter((c) => c.id !== user?.id)
      .filter((c) => dept === 'All' || c.department === dept)
      .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.jobTitle || '').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [contacts, search, dept, user?.id]);

  return (
    <div className="max-w-[1200px] mx-auto space-y-8 pb-24 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">{t('directory.title')}</h1>
          <p className="text-gray-400 font-medium text-sm mt-1">{t('directory.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-100 rounded-2xl shadow-sm">
          <Headphones size={16} className="text-blue-500" />
          <span className="text-[10px] font-black text-gray-600 uppercase tracking-widest">
            {filtered.length} {t('directory.people')}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative group flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
          <input
            type="text"
            placeholder={t('directory.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-12 pr-4 py-3 rounded-2xl bg-gray-50 border border-gray-100 text-gray-900 focus:ring-4 focus:ring-blue-500/10 focus:bg-white outline-none text-sm font-medium placeholder:text-gray-400 transition-all"
          />
        </div>
        {departments.length > 2 && (
          <div className="flex items-center gap-1.5 p-1 bg-gray-50 border border-gray-100 rounded-2xl overflow-x-auto hide-scrollbar">
            {departments.map((d) => (
              <button
                key={d}
                onClick={() => setDept(d)}
                className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all ${
                  dept === d ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-400 hover:bg-white'
                }`}
              >
                {d === 'All' ? t('directory.all') : d}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="py-32 text-center text-gray-300 font-black uppercase tracking-widest text-sm">
          {t('directory.loading')}
        </div>
      ) : failed ? (
        <div className="py-32 text-center">
          <Users className="mx-auto text-gray-200 mb-4" size={48} />
          <p className="text-gray-400 font-bold text-sm">{t('directory.failed')}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-32 text-center">
          <Users className="mx-auto text-gray-200 mb-4" size={48} />
          <p className="text-gray-300 font-black uppercase tracking-widest text-sm">{t('directory.empty')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((c) => {
            const busy = call.status !== 'idle';
            return (
              <div
                key={c.id}
                className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:border-gray-200 transition-colors flex items-center gap-3"
              >
                <div className="w-11 h-11 rounded-xl bg-gray-900 text-white flex items-center justify-center font-black text-xs shrink-0">
                  {initials(c.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-black text-gray-900 text-sm truncate">{c.name}</p>
                  <div className="flex items-center gap-1.5 flex-wrap mt-1">
                    {c.department && (
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border ${deptStyle(c.department)}`}>
                        {c.department}
                      </span>
                    )}
                    <span className="text-[10px] font-bold text-gray-400 truncate">
                      {c.jobTitle || roleLabel(c.role)}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => call.startCall(c.id, c.name)}
                  disabled={busy}
                  title={t('call.button')}
                  className="w-11 h-11 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white flex items-center justify-center shrink-0 transition-all active:scale-95 disabled:opacity-40 disabled:hover:bg-blue-50 disabled:hover:text-blue-600"
                >
                  {busy && call.status === 'calling' ? <Loader2 size={17} className="animate-spin" /> : <PhoneCall size={17} />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
