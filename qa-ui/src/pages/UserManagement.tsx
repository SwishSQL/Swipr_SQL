import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Search, Edit2, UserMinus, X } from 'lucide-react';
import MultiSelectField from '../components/MultiSelectField';

// Quality access. People and passwords live in Swipr; this page only decides who can use Quality and in which role.
type Person = {
  id: string; name: string; username: string; company: string | null; job_title: string | null;
  qa_role: string | null; qa_status: string | null; qa_department: string | null;
  tl_user_id: string | null; cc_supervisor_user_id: string | null;
  allowed_departments: string[]; allowed_brands: string[];
};
type Form = { role: string; status: string; department: string; tl_id: string; cc_supervisor_id: string; allowed_departments: string[]; allowed_brands: string[] };

const ROLES = ['supervisor', 'cc_supervisor', 'qa', 'tl', 'agent', 'compliance'];
const DEPARTMENTS = ['Swish', 'Mishmash', 'FM', 'Complain', 'TEC'];
const input = 'w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-4 py-3 text-xs font-bold outline-none focus:border-indigo-600';
const label = 'block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-2';

export default function UserManagement() {
  const [people, setPeople] = useState<Person[]>([]);
  const [brands, setBrands] = useState<{ value: string; label: string }[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'with' | 'without'>('with');
  const [editing, setEditing] = useState<Person | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<Person | null>(null);

  const load = async () => {
    const r = await fetch('/api/access');
    if (r.ok) setPeople(await r.json());
  };
  useEffect(() => {
    load();
    fetch('/api/settings/form').then(r => r.json()).then((s: any[]) =>
      setBrands(s.filter(x => x.field_type === 'brand' && x.is_active).map(x => ({ value: x.value, label: x.label_en || x.value })))).catch(() => {});
  }, []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people.filter(p =>
      (filter === 'all' || (filter === 'with') === !!p.qa_role) &&
      (!q || (p.name || '').toLowerCase().includes(q) || (p.username || '').toLowerCase().includes(q)));
  }, [people, search, filter]);

  const nameOf = (id: string | null) => people.find(p => p.id === id)?.name || '';
  const tls = people.filter(p => p.qa_role === 'tl');
  const ccs = people.filter(p => p.qa_role === 'cc_supervisor');

  const open = (p: Person) => {
    setEditing(p); setError('');
    setForm({ role: p.qa_role || 'agent', status: p.qa_status || 'active', department: p.qa_department || 'Swish', tl_id: p.tl_user_id || '', cc_supervisor_id: p.cc_supervisor_user_id || '', allowed_departments: p.allowed_departments, allowed_brands: p.allowed_brands });
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || !form) return;
    const r = await fetch(`/api/access/${editing.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    if (r.ok) { setEditing(null); setForm(null); load(); } else setError((await r.json().catch(() => ({}))).error || 'Could not save');
  };
  const remove = async (p: Person) => {
    const r = await fetch(`/api/access/${p.id}`, { method: 'DELETE' });
    setConfirmRemove(null);
    if (r.ok) load(); else alert((await r.json().catch(() => ({}))).error || 'Could not remove');
  };

  return (
    <div className="space-y-8 pb-20">
      <div>
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-black text-zinc-900 dark:text-white tracking-tighter uppercase italic">Quality Access</h2>
        <p className="text-zinc-400 text-[10px] font-black uppercase tracking-[0.3em] mt-2">
          Accounts and passwords are managed in Swipr. Here you choose who can use Quality, and as what.
        </p>
      </div>

      <div className="glass-card !p-0 overflow-hidden">
        <div className="p-4 sm:p-6 flex flex-col md:flex-row gap-4 items-center justify-between border-b border-zinc-100 dark:border-zinc-800/50">
          <div className="relative w-full md:w-[420px]">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
            <input className={input + ' pl-11'} placeholder="Search by name or username…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="flex gap-2">
            {([['with', 'Has access'], ['without', 'No access'], ['all', 'Everyone']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)}
                className={`px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border ${filter === k ? 'bg-indigo-600 text-white border-indigo-600' : 'border-zinc-200 dark:border-zinc-800 text-zinc-500'}`}>{l}</button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[860px]">
            <thead>
              <tr className="text-zinc-400 text-[10px] uppercase font-black tracking-[0.2em] border-b border-zinc-100 dark:border-zinc-800">
                <th className="px-6 py-4">Person</th><th className="px-6 py-4">Swipr department</th><th className="px-6 py-4">Quality role</th><th className="px-6 py-4">Team leader</th><th className="px-6 py-4">Scope</th><th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/30">
              {shown.map(p => (
                <tr key={p.id} className="hover:bg-zinc-50/50 dark:hover:bg-indigo-600/5">
                  <td className="px-6 py-4">
                    <p className="text-sm font-black text-zinc-900 dark:text-white uppercase italic">{p.name}</p>
                    <p className="text-[10px] font-mono text-zinc-400">{p.username}</p>
                  </td>
                  <td className="px-6 py-4 text-[11px] font-bold text-zinc-500">{p.company || '—'}{p.job_title ? ` · ${p.job_title}` : ''}</td>
                  <td className="px-6 py-4">
                    {p.qa_role
                      ? <span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border ${p.qa_status === 'active' ? 'text-indigo-600 border-indigo-500/20 bg-indigo-500/5' : 'text-zinc-400 border-zinc-300 line-through'}`}>{p.qa_role}{p.qa_status !== 'active' ? ' (off)' : ''}</span>
                      : <span className="text-[10px] font-black uppercase tracking-widest text-zinc-300">No access</span>}
                  </td>
                  <td className="px-6 py-4 text-[11px] font-bold text-zinc-500">{nameOf(p.tl_user_id) || '—'}</td>
                  <td className="px-6 py-4 max-w-[260px]">
                    <div className="flex flex-wrap gap-1">
                      {(p.qa_role === 'qa' || p.qa_role === 'tl') && p.allowed_brands.length === 0 && <span className="text-[9px] font-black uppercase tracking-widest text-rose-500">No brands</span>}
                      {p.allowed_brands.slice(0, 6).map(b => <span key={b} className="px-1.5 py-0.5 text-[9px] font-black uppercase rounded bg-indigo-500/10 text-indigo-700 dark:text-indigo-400">{b}</span>)}
                      {p.allowed_brands.length > 6 && <span className="text-[9px] font-black text-zinc-400">+{p.allowed_brands.length - 6}</span>}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => open(p)} title={p.qa_role ? 'Edit access' : 'Grant access'} className="p-2.5 border border-zinc-200 dark:border-zinc-800 rounded-xl text-zinc-400 hover:text-indigo-600"><Edit2 size={15} /></button>
                      {p.qa_role && <button onClick={() => setConfirmRemove(p)} title="Remove access" className="p-2.5 border border-zinc-200 dark:border-zinc-800 rounded-xl text-zinc-400 hover:text-rose-600"><UserMinus size={15} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <p className="py-16 text-center text-[10px] font-black text-zinc-400 uppercase tracking-[0.4em]">No people found</p>}
        </div>
      </div>

      {confirmRemove && createPortal(
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70">
          <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-8 max-w-md w-full">
            <h3 className="text-xl font-black uppercase tracking-tighter mb-2 text-zinc-900 dark:text-white">Remove Quality access?</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6">{confirmRemove.name} will no longer be able to open Quality. Their Swipr account and all past evaluations stay as they are.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmRemove(null)} className="flex-1 py-3 rounded-xl bg-zinc-100 dark:bg-zinc-900 text-[10px] font-black uppercase tracking-widest text-zinc-700 dark:text-zinc-300">Cancel</button>
              <button onClick={() => remove(confirmRemove)} className="flex-1 py-3 rounded-xl bg-rose-600 text-white text-[10px] font-black uppercase tracking-widest">Remove</button>
            </div>
          </div>
        </div>, document.body)}

      {editing && form && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto">
          <div className="absolute inset-0 bg-black/80" onClick={() => setEditing(null)} />
          <form onSubmit={save} className="relative bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-8 w-full max-w-xl space-y-5 my-8">
            <div className="flex items-start justify-between">
              <div><h3 className="text-xl font-black uppercase tracking-tighter text-zinc-900 dark:text-white">{editing.qa_role ? 'Edit' : 'Grant'} Quality access</h3>
                <p className="text-xs text-zinc-500 mt-1">{editing.name} · <span className="font-mono">{editing.username}</span></p></div>
              <button type="button" onClick={() => setEditing(null)} className="text-zinc-400"><X size={20} /></button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><span className={label}>Role</span>
                <select className={input} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>{ROLES.map(r => <option key={r} value={r}>{r}</option>)}</select></div>
              <div><span className={label}>Status</span>
                <select className={input} value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}><option value="active">active</option><option value="inactive">inactive</option></select></div>
              <div><span className={label}>Department</span>
                <select className={input} value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}>{DEPARTMENTS.map(d => <option key={d}>{d}</option>)}</select></div>
              {form.role === 'agent' && (
                <div><span className={label}>Team leader</span>
                  <select className={input} value={form.tl_id} onChange={e => setForm({ ...form, tl_id: e.target.value })}><option value="">— none —</option>{tls.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
              )}
              {form.role === 'tl' && (
                <div><span className={label}>CC supervisor</span>
                  <select className={input} value={form.cc_supervisor_id} onChange={e => setForm({ ...form, cc_supervisor_id: e.target.value })}><option value="">— none —</option>{ccs.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
              )}
            </div>
            {form.role === 'qa' && <MultiSelectField label="Allowed departments" options={DEPARTMENTS.map(d => ({ value: d, label: d }))} value={form.allowed_departments} onChange={v => setForm({ ...form, allowed_departments: v })} />}
            {(form.role === 'qa' || form.role === 'tl') && <MultiSelectField label="Allowed brands" options={brands} value={form.allowed_brands} onChange={v => setForm({ ...form, allowed_brands: v })} />}
            {error && <p className="text-sm font-bold text-rose-600">{error}</p>}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setEditing(null)} className="flex-1 py-3 rounded-xl bg-zinc-100 dark:bg-zinc-900 text-[10px] font-black uppercase tracking-widest text-zinc-700 dark:text-zinc-300">Cancel</button>
              <button type="submit" className="flex-1 py-3 rounded-xl bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest">Save</button>
            </div>
          </form>
        </div>, document.body)}
    </div>
  );
}
