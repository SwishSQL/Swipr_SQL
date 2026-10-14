
import React, { useState, useEffect, useMemo } from 'react';
import { store } from '../store';
import { User, UserRole, Evaluation, EVAL_CRITERIA, unitOf } from '../types';
import { format } from 'date-fns';
import { useAuth } from '../App';
import { useLanguage } from '../i18n';
import Avatar from '../Avatar';
import { Award, Search, X, Save, Star, Clock, User as UserIcon } from 'lucide-react';

const BRANCH_MGR_ROLES = [UserRole.BRANCH_MANAGER, UserRole.AREA_MANAGER, UserRole.OPERATION_MANAGER];

const SCORE_LABELS: Record<number, string> = { 1: 'Low', 2: 'Average', 3: 'High', 4: 'Excellent' };

const scoreColor = (pct: number) =>
  pct >= 87.5 ? 'text-emerald-600' : pct >= 62.5 ? 'text-blue-600' : pct >= 37.5 ? 'text-amber-600' : 'text-rose-600';
const scoreBar = (pct: number) =>
  pct >= 87.5 ? 'bg-emerald-500' : pct >= 62.5 ? 'bg-blue-500' : pct >= 37.5 ? 'bg-amber-500' : 'bg-rose-500';

export default function Evaluations() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isManager = !!user && BRANCH_MGR_ROLES.includes(user.role);
  const isAdmin = user?.role === UserRole.ADMIN;
  const canEvaluate = isManager || isAdmin;

  const [employees, setEmployees] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [historyFor, setHistoryFor] = useState<User | null>(null);
  const [history, setHistory] = useState<Evaluation[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [formFor, setFormFor] = useState<User | null>(null);

  // Manager/admin view: fetch branch employees they can evaluate.
  useEffect(() => {
    if (!canEvaluate) return;
    const unsub = store.subscribeToUsers((all) => {
      setEmployees(all.filter(u => u.role === UserRole.BRANCH_EMPLOYEE));
    });
    return () => unsub();
  }, [canEvaluate]);

  // Branch employee view: fetch their own evaluation history once.
  const [ownHistory, setOwnHistory] = useState<Evaluation[] | null>(null);
  useEffect(() => {
    if (canEvaluate || !user) return;
    store.getEvaluations(user.id).then(setOwnHistory).catch(() => setOwnHistory([]));
  }, [canEvaluate, user?.id]);

  const filteredEmployees = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return employees.filter(e =>
      e.name.toLowerCase().includes(q) ||
      e.employeeId?.toLowerCase().includes(q) ||
      e.jobTitle?.toLowerCase().includes(q)
    ).sort((a, b) => a.name.localeCompare(b.name));
  }, [employees, searchQuery]);

  const openHistory = async (emp: User) => {
    setHistoryFor(emp);
    setLoadingHistory(true);
    try {
      setHistory(await store.getEvaluations(emp.id));
    } finally {
      setLoadingHistory(false);
    }
  };

  const refreshHistoryIfOpen = async (empId: string) => {
    if (historyFor?.id === empId) setHistory(await store.getEvaluations(empId));
  };

  if (!user) return null;

  if (!canEvaluate) {
    // Branch employee — read-only history of their own evaluations.
    return (
      <div className="max-w-4xl mx-auto space-y-8 pb-20 animate-in fade-in duration-500">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight flex items-center gap-3">
            <Award className="text-amber-500" size={30} /> {t('evaluations.myTitle')}
          </h1>
          <p className="text-gray-400 font-medium mt-1">{t('evaluations.myHistory')}</p>
        </div>

        {ownHistory === null ? (
          <p className="text-gray-400 font-bold text-sm">Loading…</p>
        ) : ownHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 bg-white rounded-[40px] border-2 border-dashed border-gray-100">
            <Award className="text-gray-200 mb-4" size={48} />
            <p className="text-gray-400 font-black text-lg uppercase tracking-widest">{t('evaluations.noneYet')}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {ownHistory.map(ev => (
              <EvaluationCard key={ev.id} ev={ev} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Manager / admin — roster + evaluate + history.
  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-black text-gray-900 tracking-tight flex items-center gap-3">
          <Award className="text-amber-500" size={30} /> {t('evaluations.title')}
        </h1>
        <p className="text-gray-400 font-medium mt-1">{t('evaluations.subtitle')}</p>
      </div>

      <div className="relative group max-w-lg">
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-300 group-focus-within:text-blue-500 transition-colors" size={20} />
        <input
          type="text"
          placeholder={t('evaluations.search')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-14 pr-6 py-4 bg-white border border-gray-100 rounded-[24px] text-sm font-bold outline-none focus:ring-4 focus:ring-blue-500/10 shadow-sm"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredEmployees.map(emp => (
          <div key={emp.id} className="bg-white rounded-[32px] border border-gray-100 shadow-sm p-6 space-y-4">
            <div className="flex items-center gap-4">
              <Avatar
                name={emp.name}
                photoUrl={emp.photoUrl}
                className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center text-white font-black text-xl shrink-0 overflow-hidden"
              />
              <div className="min-w-0">
                <p className="font-black text-gray-900 leading-tight truncate">{emp.name}</p>
                <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest truncate">{emp.jobTitle || 'STAFF'}</p>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest truncate">{unitOf(emp)}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setFormFor(emp)}
                className="flex-1 flex items-center justify-center gap-1.5 py-3 bg-amber-500 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-600 transition-all active:scale-95"
              >
                <Star size={14} /> {t('evaluations.evaluate')}
              </button>
              <button
                onClick={() => openHistory(emp)}
                className="flex-1 flex items-center justify-center gap-1.5 py-3 bg-gray-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all active:scale-95"
              >
                <Clock size={14} /> {t('evaluations.history')}
              </button>
            </div>
          </div>
        ))}
      </div>

      {filteredEmployees.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 bg-white rounded-[40px] border-2 border-dashed border-gray-100">
          <UserIcon className="text-gray-200 mb-4" size={48} />
          <p className="text-gray-400 font-black text-lg uppercase tracking-widest">{t('evaluations.noneFound')}</p>
        </div>
      )}

      {historyFor && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-md">
          <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            <div className="px-8 py-6 border-b border-gray-50 flex justify-between items-center shrink-0">
              <div>
                <h2 className="text-lg font-black text-gray-900">{historyFor.name}</h2>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Evaluation History</p>
              </div>
              <button onClick={() => setHistoryFor(null)} className="p-2 hover:bg-gray-50 rounded-xl text-gray-400"><X size={22} /></button>
            </div>
            <div className="p-8 space-y-5 overflow-y-auto">
              {loadingHistory ? (
                <p className="text-gray-400 font-bold text-sm">Loading…</p>
              ) : history.length === 0 ? (
                <p className="text-gray-400 font-bold text-sm text-center py-10">No evaluations recorded yet.</p>
              ) : (
                history.map(ev => (
                  <EvaluationCard
                    key={ev.id}
                    ev={ev}
                    onDelete={async () => {
                      if (!confirm('Delete this evaluation? This cannot be undone.')) return;
                      await store.deleteEvaluation(ev.id);
                      setHistory(h => h.filter(x => x.id !== ev.id));
                    }}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {formFor && (
        <EvaluationForm
          employee={formFor}
          evaluatorName={user.name}
          onClose={() => setFormFor(null)}
          onSaved={async () => {
            const empId = formFor.id;
            setFormFor(null);
            await refreshHistoryIfOpen(empId);
          }}
        />
      )}
    </div>
  );
}

function EvaluationCard({ ev, onDelete }: { ev: Evaluation; onDelete?: () => void }) {
  const pct = Math.round((ev.total / ev.maxTotal) * 100);
  return (
    <div className="bg-white rounded-[28px] border border-gray-100 shadow-sm p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{format(new Date(ev.date), 'MMM d, yyyy · p')}</p>
          <p className="text-sm font-bold text-gray-600">Evaluated by <span className="text-gray-900 font-black">{ev.evaluatorName}</span></p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className={`text-3xl font-black ${scoreColor(pct)}`}>{ev.total}<span className="text-gray-300 text-lg">/{ev.maxTotal}</span></p>
            <p className={`text-[10px] font-black uppercase tracking-widest ${scoreColor(pct)}`}>{pct}%</p>
          </div>
          {onDelete && (
            <button
              onClick={onDelete}
              title="Delete this evaluation"
              className="p-2 text-gray-300 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>
      <div className="h-2 bg-gray-50 rounded-full overflow-hidden">
        <div className={`h-full ${scoreBar(pct)} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <div className="space-y-2.5">
        {EVAL_CRITERIA.map(c => {
          const v = ev.scores?.[c.key] ?? 0;
          return (
            <div key={c.key} className="flex items-center justify-between gap-3 text-xs">
              <span className="font-bold text-gray-600">{c.label}</span>
              <span className="flex items-center gap-1 shrink-0">
                {[1, 2, 3, 4].map(n => (
                  <span key={n} className={`w-2 h-2 rounded-full ${n <= v ? 'bg-amber-500' : 'bg-gray-100'}`} />
                ))}
                <span className="ml-1.5 font-black text-gray-500 w-16 text-right">{v} · {SCORE_LABELS[v] || ''}</span>
              </span>
            </div>
          );
        })}
      </div>
      {ev.approvedByName && (
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest pt-2 border-t border-gray-50">
          Approved by: <span className="text-gray-700">{ev.approvedByName}</span>
        </p>
      )}
    </div>
  );
}

function EvaluationForm({ employee, evaluatorName, onClose, onSaved }: {
  employee: User; evaluatorName: string; onClose: () => void; onSaved: () => void;
}) {
  const [scores, setScores] = useState<Record<string, number>>({});
  const [approvedByName, setApprovedByName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const total = EVAL_CRITERIA.reduce((sum, c) => sum + (scores[c.key] || 0), 0);
  const complete = EVAL_CRITERIA.every(c => scores[c.key]);

  const submit = async () => {
    if (!complete) { setError('Score every criterion before saving.'); return; }
    setSaving(true);
    setError('');
    try {
      await store.createEvaluation({ employeeId: employee.id, scores, approvedByName: approvedByName.trim() });
      onSaved();
    } catch {
      setError('Could not save the evaluation. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-md">
      <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        <div className="px-8 py-6 bg-amber-500 text-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <Award size={24} />
            <div>
              <h2 className="font-black text-lg tracking-tight uppercase">Employee of the Month</h2>
              <p className="text-[10px] font-bold text-amber-50 uppercase tracking-widest">Scoring Form</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-amber-600 rounded-full"><X size={22} /></button>
        </div>

        <div className="p-8 space-y-6 overflow-y-auto">
          <div className="grid grid-cols-2 gap-4 bg-gray-50 p-5 rounded-[24px] border border-gray-100 text-xs">
            <div><p className="font-black text-gray-400 uppercase tracking-widest text-[9px] mb-0.5">Name</p><p className="font-bold text-gray-900">{employee.name}</p></div>
            <div><p className="font-black text-gray-400 uppercase tracking-widest text-[9px] mb-0.5">Employee ID</p><p className="font-bold text-gray-900">{employee.employeeId || '—'}</p></div>
            <div><p className="font-black text-gray-400 uppercase tracking-widest text-[9px] mb-0.5">Position</p><p className="font-bold text-gray-900">{employee.jobTitle || '—'}</p></div>
            <div><p className="font-black text-gray-400 uppercase tracking-widest text-[9px] mb-0.5">Location</p><p className="font-bold text-gray-900">{unitOf(employee)}</p></div>
            <div className="col-span-2"><p className="font-black text-gray-400 uppercase tracking-widest text-[9px] mb-0.5">Evaluated By</p><p className="font-bold text-gray-900">{evaluatorName}</p></div>
          </div>

          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Rate each criterion: 1-Low · 2-Average · 3-High · 4-Excellent</p>

          <div className="space-y-5">
            {EVAL_CRITERIA.map(c => (
              <div key={c.key} className="p-5 bg-white border border-gray-100 rounded-[24px] shadow-sm space-y-3">
                <div>
                  <p className="font-black text-gray-900 text-sm">{c.label}</p>
                  <p className="text-[11px] text-gray-400 font-medium mt-0.5">{c.description}</p>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[1, 2, 3, 4].map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setScores({ ...scores, [c.key]: n })}
                      className={`py-3 rounded-2xl text-xs font-black uppercase tracking-widest border-2 transition-all ${
                        scores[c.key] === n
                          ? 'border-amber-500 bg-amber-500 text-white shadow-lg shadow-amber-100'
                          : 'border-transparent bg-gray-50 text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      {n} · {SCORE_LABELS[n]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Approved By (Department Head, optional)</label>
            <input
              type="text" placeholder="Name of the Department Head"
              value={approvedByName} onChange={e => setApprovedByName(e.target.value)}
              className="w-full px-5 py-3.5 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold outline-none focus:ring-4 focus:ring-amber-500/10"
            />
          </div>

          {error && <div className="p-3 bg-rose-50 text-rose-600 rounded-xl text-xs font-black uppercase tracking-wide border border-rose-100">{error}</div>}
        </div>

        <div className="px-8 py-6 border-t border-gray-50 flex items-center justify-between shrink-0 bg-white">
          <div>
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Total Score</p>
            <p className="text-2xl font-black text-gray-900">{total}<span className="text-gray-300 text-sm">/{EVAL_CRITERIA.length * 4}</span></p>
          </div>
          <button
            onClick={submit}
            disabled={saving}
            className="flex items-center gap-2 px-8 py-4 bg-amber-500 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-amber-100 hover:bg-amber-600 transition-all active:scale-95 disabled:opacity-50"
          >
            <Save size={16} /> {saving ? 'Saving…' : 'Save Evaluation'}
          </button>
        </div>
      </div>
    </div>
  );
}
