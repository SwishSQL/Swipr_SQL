import React, { useEffect, useMemo, useState } from 'react';
import { Thermometer, Search, Eye, Trash2, CheckCircle2, AlertCircle, Lock, Calendar as CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { store } from '../store';
import { SickDocsAdminView, SickDocument } from '../types';

const ymd = (d: Date) => format(d, 'yyyy-MM-dd');
const nice = (d: string) => format(new Date(d + 'T00:00:00'), 'EEE, MMM d, yyyy');
const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

// Admin only. One row per (employee, day): every SICK day on the roster —
// with its report or flagged as missing — plus any report uploaded for a
// day the roster does not show as sick.
export default function SickDocuments() {
  const today = ymd(new Date());
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return ymd(d); });
  const [to, setTo] = useState(today);
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<'all' | 'missing' | 'uploaded'>('all');
  const [data, setData] = useState<SickDocsAdminView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try { setData(await store.getSickDocsAdmin(from, to)); }
    catch (e: any) { setError(e?.message || 'Could not load.'); }
    setLoading(false);
  };
  useEffect(() => { load(); }, [from, to]);

  const rows = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, { userId: string; date: string; onRoster: boolean; docs: SickDocument[] }>();
    const key = (u: string, d: string) => `${u}|${d}`;
    for (const s of data.sickDays) map.set(key(s.userId, s.date), { userId: s.userId, date: s.date, onRoster: true, docs: [] });
    for (const d of data.docs) {
      const k = key(d.userId, d.date);
      if (!map.has(k)) map.set(k, { userId: d.userId, date: d.date, onRoster: false, docs: [] });
      map.get(k)!.docs.push(d);
    }
    const q = query.trim().toLowerCase();
    return [...map.values()]
      .filter((r) => {
        const p = data.people[r.userId];
        if (q && !((p?.name || '').toLowerCase().includes(q) || (p?.employeeCode || '').toLowerCase().includes(q) || (p?.unit || '').toLowerCase().includes(q))) return false;
        if (show === 'missing') return r.docs.length === 0;
        if (show === 'uploaded') return r.docs.length > 0;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date) || (data.people[a.userId]?.name || '').localeCompare(data.people[b.userId]?.name || ''));
  }, [data, query, show]);

  const missingCount = rows.filter((r) => r.docs.length === 0).length;

  const open = async (d: SickDocument) => {
    try { await store.openSickDoc(d.id); } catch (e: any) { alert(e?.message || 'Could not open it.'); }
  };
  const remove = async (d: SickDocument) => {
    if (!confirm(`Delete this medical report? The employee will have to upload it again.`)) return;
    try { await store.deleteSickDoc(d.id); await load(); } catch { alert('Could not delete it.'); }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-black text-gray-900 tracking-tight">Sick Documents</h1>
        <p className="text-sm font-bold text-gray-400 mt-1 flex items-center gap-1.5">
          <Lock size={13} /> Medical reports are visible to Admin and to the employee who uploaded them — no one else.
        </p>
      </div>

      <div className="bg-white border border-gray-100 rounded-[28px] shadow-sm p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <CalendarIcon size={14} className="text-gray-300" />
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">From</label>
            <input type="date" value={from} max={today} onChange={(e) => { const v = e.target.value; if (v) { setFrom(v); if (v > to) setTo(v); } }}
              className="px-3 py-2 rounded-xl bg-gray-50 border border-gray-100 font-black text-sm text-gray-900 outline-none" />
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">To</label>
            <input type="date" value={to} max={today} onChange={(e) => { const v = e.target.value; if (v) { setTo(v); if (v < from) setFrom(v); } }}
              className="px-3 py-2 rounded-xl bg-gray-50 border border-gray-100 font-black text-sm text-gray-900 outline-none" />
          </div>
          <div className="flex items-center gap-2 lg:ml-auto">
            {([['all', 'All'], ['missing', 'Missing report'], ['uploaded', 'Uploaded']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setShow(k)}
                className={`px-3.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${show === k ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="relative">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, employee ID or department..."
            className="w-full pl-11 pr-5 py-3 rounded-2xl bg-gray-50 border border-gray-100 text-sm font-medium text-gray-900 outline-none placeholder:text-gray-400" />
        </div>
        {data && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="bg-gray-50 text-gray-600 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border border-gray-100">{rows.length} sick day{rows.length !== 1 ? 's' : ''}</span>
            <span className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border ${missingCount ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}`}>
              {missingCount} missing a report
            </span>
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-center py-20 text-gray-300 font-bold">Loading...</p>
      ) : error ? (
        <div className="bg-rose-50 border border-rose-100 rounded-2xl px-5 py-4 text-sm font-bold text-rose-600">{error}</div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-[32px] p-16 text-center border border-gray-100">
          <Thermometer size={48} className="mx-auto text-gray-200 mb-4" />
          <p className="text-gray-400 font-bold">No sick days in this range{query || show !== 'all' ? ' match these filters' : ''}.</p>
        </div>
      ) : (
        <div className="bg-white rounded-[28px] border border-gray-100 shadow-sm divide-y divide-gray-50">
          {rows.map((r) => {
            const p = data!.people[r.userId];
            return (
              <div key={`${r.userId}|${r.date}`} className="px-6 py-4 flex flex-col md:flex-row md:items-center gap-3">
                <div className="md:w-56 shrink-0">
                  <p className="text-sm font-black text-gray-900">{nice(r.date)}</p>
                  <p className="text-[10px] font-black uppercase tracking-widest mt-0.5 text-gray-400">
                    {r.onRoster ? 'Sick on the roster' : 'Not marked sick on the roster'}
                  </p>
                </div>
                <div className="min-w-0 md:w-64 shrink-0">
                  <p className="text-sm font-black text-gray-900 truncate">{p?.name || 'Unknown employee'}</p>
                  <p className="text-[11px] font-bold text-gray-400 truncate">{[p?.employeeCode, p?.unit].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="flex-1 min-w-0 space-y-1.5">
                  {r.docs.length === 0 ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-black text-amber-700 bg-amber-50 border border-amber-100 px-3 py-1.5 rounded-xl">
                      <AlertCircle size={13} /> No report uploaded
                    </span>
                  ) : r.docs.map((d) => (
                    <div key={d.id} className="flex items-center gap-2">
                      <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                      <button onClick={() => open(d)} className="text-xs font-black text-blue-600 hover:underline truncate text-left">{d.filename || 'document'}</button>
                      <span className="text-[10px] font-bold text-gray-400 shrink-0">{kb(d.bytes)} · {format(new Date(d.createdAt), 'MMM d, p')}</span>
                      {d.note && <span className="text-[10px] font-bold text-gray-500 truncate">· {d.note}</span>}
                      <button onClick={() => open(d)} title="Open" className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-50 shrink-0"><Eye size={14} /></button>
                      <button onClick={() => remove(d)} title="Delete" className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 shrink-0"><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
