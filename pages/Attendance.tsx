import React, { useState, useEffect } from 'react';
import { QrCode, Users, LogIn, LogOut, Maximize2, X, Loader2, FileSpreadsheet, CalendarDays, Pencil, Trash2, Timer, AlertTriangle, Lock, CheckCircle2, RefreshCw, Phone } from 'lucide-react';
import { format, isSameDay, parseISO } from 'date-fns';
import * as XLSX from 'xlsx';
import { store } from '../store';
import { TeamAttendanceRow, AttendanceRecord, UserRole, LatenessRow, LatenessReport, LatenessStatus, LatenessAction, XontelAgent, XontelMapRow, XontelDay, XontelCall } from '../types';
import Avatar from '../Avatar';
import { useAuth } from '../App';
import { useLanguage } from '../i18n';

// The QR the branch screen shows. It is re-fetched (and re-signed) every few
// seconds so a photo of it is worthless a moment later — that is what forces
// the employee to actually be standing at the branch to clock in.
const KioskDisplay: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useLanguage();
  const [qr, setQr] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let timer: any;
    const refresh = async () => {
      try {
        const res = await store.getKioskCode();
        if (!active) return;
        setQr(res.qrDataUri);
        setLabel(res.label);
        setError('');
        // Rotate the displayed code often, independently of how long a code
        // stays valid once scanned.
        timer = setTimeout(refresh, Math.max(5, res.refreshInSeconds ?? 20) * 1000);
      } catch {
        if (!active) return;
        setError('Could not load a code. Retrying...');
        timer = setTimeout(refresh, 5000);
      }
    };
    refresh();
    return () => { active = false; clearTimeout(timer); };
  }, []);

  return (
    <div className="fixed inset-0 z-[200] bg-white flex flex-col items-center justify-center p-8">
      <button onClick={onClose} className="absolute top-6 right-6 p-3 hover:bg-gray-50 rounded-2xl text-gray-400">
        <X size={28} />
      </button>
      <h1 className="text-4xl font-black text-gray-900 tracking-tight mb-2">{t('attendance.scanTitle')}</h1>
      <p className="text-sm font-black text-gray-400 uppercase tracking-widest mb-10">{label}</p>
      <div className="p-6 bg-white rounded-[40px] border-4 border-gray-900 shadow-2xl">
        {qr ? (
          <img src={qr} alt="Attendance QR code" className="w-[340px] h-[340px]" />
        ) : (
          <div className="w-[340px] h-[340px] flex items-center justify-center">
            <Loader2 size={48} className="text-gray-300 animate-spin" />
          </div>
        )}
      </div>
      {error ? (
        <p className="mt-8 text-sm font-bold text-rose-500">{error}</p>
      ) : (
        <p className="mt-8 text-sm font-bold text-gray-400">{t('attendance.pointCamera')}</p>
      )}
    </div>
  );
};

// What a branch employee sees: their own clock-in/out history. They can't
// start a scan from here — that only happens by scanning the branch screen.
function MyAttendance() {
  const { t } = useLanguage();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = store.subscribeToMyAttendance((rows) => {
      setRecords(rows);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const today = records.filter(r => isSameDay(new Date(r.ts), new Date()));
  const firstIn = [...today].reverse().find(r => r.kind === 'IN') || null;
  const lastOut = today.find(r => r.kind === 'OUT') || null;
  // The newest record decides whether they're currently checked in.
  const onSite = records[0]?.kind === 'IN';

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-black text-gray-900 tracking-tight">{t('attendance.myTitle')}</h1>
        <p className="text-sm font-bold text-gray-400 mt-1">{format(new Date(), 'EEEE, MMMM d')}</p>
      </div>

      <div className={`rounded-[32px] p-8 border-2 shadow-sm flex flex-col sm:flex-row items-center gap-8 ${onSite ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-gray-100'}`}>
        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-white shadow-lg shrink-0 ${onSite ? 'bg-emerald-600' : 'bg-gray-900'}`}>
          <QrCode size={32} />
        </div>
        <div className="flex-1 text-center sm:text-left">
          <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${onSite ? 'text-emerald-600' : 'text-gray-400'}`}>Status</p>
          <p className="text-xl font-black text-gray-900 leading-none">{onSite ? t('attendance.onSite') : t('attendance.notClockedIn')}</p>
          <p className="text-xs font-bold text-gray-400 mt-1.5">Scan the QR shown on your screen to clock in or out.</p>
        </div>
        <div className="flex items-center gap-6">
          <TimeCell icon={LogIn} label="In" ts={firstIn?.ts ?? null} tone="emerald" />
          <TimeCell icon={LogOut} label="Out" ts={lastOut?.ts ?? null} tone="gray" />
          <DurationCell firstIn={firstIn?.ts ?? null} lastOut={lastOut?.ts ?? null} onSite={onSite} />
        </div>
      </div>

      {loading ? (
        <p className="text-center py-20 text-gray-300 font-bold">Loading your records...</p>
      ) : records.length === 0 ? (
        <div className="bg-white rounded-[32px] p-16 text-center border border-gray-100">
          <QrCode size={48} className="mx-auto text-gray-200 mb-4" />
          <p className="text-gray-400 font-bold">{t('attendance.noneRecorded')}</p>
        </div>
      ) : (
        <div className="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden">
          <p className="px-6 pt-5 pb-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">{t('attendance.recentScans')}</p>
          <div className="divide-y divide-gray-50">
            {records.map(r => (
              <div key={r.id} className="px-6 py-4 flex items-center gap-4">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${r.kind === 'IN' ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-50 text-gray-400'}`}>
                  {r.kind === 'IN' ? <LogIn size={16} /> : <LogOut size={16} />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-black text-gray-900 text-sm">{r.kind === 'IN' ? t('attendance.clockedIn') : t('attendance.clockedOut')}</p>
                  <p className="text-[11px] font-bold text-gray-400 truncate">{r.unit}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-black text-gray-900 tabular-nums">{format(new Date(r.ts), 'p')}</p>
                  <p className="text-[10px] font-bold text-gray-400">{format(new Date(r.ts), 'MMM d')}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Roles that oversee someone else's attendance (and so get the board + QR)
// vs. roles that only ever see their own record. A Team Leader is in both
// camps — they get the board, but also clock in themselves.
const BOARD_ROLES = [UserRole.BRANCH_MANAGER, UserRole.MANAGER, UserRole.SUPERVISOR, UserRole.ADMIN];

export default function Attendance() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [tab, setTab] = useState<'board' | 'lateness'>('board');

  if (user && !BOARD_ROLES.includes(user.role)) {
    return <MyAttendance />;
  }
  // Lateness is built from the same records the board shows, so it inherits
  // the same restriction. A branch manager still lands on the board for the QR.
  if (user?.role !== UserRole.ADMIN) return <TeamAttendance />;

  return (
    <div className="space-y-6">
      <div className="inline-flex p-1.5 bg-gray-100 rounded-2xl">
        {([['board', 'late.tabBoard'], ['lateness', 'late.tabReview']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-5 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${
              tab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {t(label)}
          </button>
        ))}
      </div>
      {tab === 'board' ? <TeamAttendance /> : <LatenessReview />}
    </div>
  );
}

// Which statuses are worth a manager's attention. ON_TIME is the overwhelming
// majority (591 of 841 days in the first month) and burying six real findings
// under six hundred confirmations is how a review screen stops being read.
const FINDING_STATUSES: LatenessStatus[] = ['LATE', 'LEFT_EARLY', 'SHIFT_MISMATCH', 'ONLY_OUT', 'NO_PUNCH', 'LONE_PUNCH'];

const STATUS_TONE: Record<LatenessStatus, string> = {
  LATE: 'bg-rose-50 text-rose-600',
  LEFT_EARLY: 'bg-orange-50 text-orange-600',
  NO_PUNCH: 'bg-rose-50 text-rose-600',
  SHIFT_MISMATCH: 'bg-amber-50 text-amber-700',
  LONE_PUNCH: 'bg-amber-50 text-amber-700',
  ONLY_OUT: 'bg-amber-50 text-amber-700',
  ON_TIME: 'bg-emerald-50 text-emerald-600',
  EXCUSED: 'bg-blue-50 text-blue-600',
  NOT_SYNCED: 'bg-gray-100 text-gray-500',
  PENDING: 'bg-gray-100 text-gray-400',
};

const ymd = (d: Date) => format(d, 'yyyy-MM-dd');

function LatenessReview() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const today = new Date();
  const [from, setFrom] = useState(ymd(new Date(today.getTime() - 6 * 86400000)));
  const [to, setTo] = useState(ymd(today));
  const [report, setReport] = useState<LatenessReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setReport(await store.getLateness(from, to));
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Could not load lateness findings.');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  // Reviewing patches the one row in place rather than refetching the report.
  // Reloading replaced the whole list with a spinner, which threw the page
  // back to the top after every single decision — unusable for working down a
  // long list. The fields written here are exactly the ones the server sets,
  // and any later reload (date change, rebuild) resyncs from it anyway.
  const review = async (row: LatenessRow, action: LatenessAction) => {
    const key = `${row.userId}|${row.date}`;
    // Each decision carries its own measurement: lateness counts from the
    // start, an early leave counts back from the end, an absence has neither.
    const minutes = action === 'CONFIRM' ? (row.offsetMin ?? undefined)
      : action === 'EARLY_LEAVE' ? (row.earlyLeaveMin ?? undefined)
        : undefined;
    setBusy(key);
    try {
      await store.reviewLateness(row.userId, row.date, action, minutes);
      setReport(prev => prev && ({
        ...prev,
        rows: prev.rows.map(r => (r.userId === row.userId && r.date === row.date)
          ? {
            ...r,
            reviewAction: action,
            reviewedName: user?.name ?? null,
            reviewedAt: Date.now(),
            // CONFIRM writes the minutes onto the roster, so the row now has
            // a recorded value even if it had none a moment ago.
            recordedMinutes: action === 'DISMISS' || action === 'ABSENT'
              ? r.recordedMinutes : (minutes ?? r.recordedMinutes),
          }
          : r),
      }));
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Could not save that decision.');
    } finally {
      setBusy(null);
    }
  };

  const rebuild = async () => {
    setBusy('rebuild');
    try {
      await store.recomputeLateness(from, to);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Rebuild failed.');
    } finally {
      setBusy(null);
    }
  };

  const all = report?.rows || [];
  const grace = report?.graceMinutes ?? 10;
  const earlyMin = report?.earlyLeaveMinutes ?? 30;
  const earlyAmbiguous = report?.earlyLeaveAmbiguousMinutes ?? 180;
  const shown = showAll ? all : all.filter(r => FINDING_STATUSES.includes(r.status));
  const lateRows = all.filter(r => r.status === 'LATE');
  const totalLateMin = lateRows.reduce((s, r) => s + (r.offsetMin || 0), 0);
  const needsReview = all.filter(r => FINDING_STATUSES.includes(r.status) && !r.reviewAction).length;
  // A terminal that stopped reporting turns every scheduled shift into silence,
  // which reads as absence. Say so rather than showing a wall of empty days.
  const staleSync = report?.lastSyncAt != null && Date.now() - report.lastSyncAt > 30 * 60 * 1000;
  // XonTel is polled every five minutes; an hour of silence means the poll is
  // failing, and a missing login would then be a data gap, not a person.
  const xonStale = !!report?.xontel.configured
    && (report.xontel.lastSyncAt == null || Date.now() - report.xontel.lastSyncAt > 60 * 60 * 1000);

  const pullXontel = async () => {
    setBusy('xontel');
    try {
      await store.syncXontel(from, to);
      await load();
    } catch (e: any) {
      setError(e?.message || 'XonTel pull failed.');
    } finally {
      setBusy(null);
    }
  };

  const exportToExcel = () => {
    if (!all.length) return;
    const rows = all.map(r => ({
      'Date': r.date,
      'Employee': r.name,
      'Employee No.': r.employeeId || '',
      'Department': r.company || '',
      'Scheduled start': r.scheduledStart ? format(new Date(r.scheduledStart), 'hh:mm a') : '',
      'Arrived': r.arrivalTs ? format(new Date(r.arrivalTs), 'hh:mm a') : '',
      // Only a genuine late arrival carries a minute count into a spreadsheet
      // someone may total: a roster mismatch or a lone punch is not lateness.
      'Late (min)': r.status === 'LATE' ? r.offsetMin : '',
      'XonTel login': r.xontelLoginTs ? format(new Date(r.xontelLoginTs), 'hh:mm a') : '',
      'To first call (min)': r.xontelGapMin ?? '',
      'XonTel logout': r.xontelLogoutTs ? format(new Date(r.xontelLogoutTs), 'hh:mm a') : '',
      'Left': r.departureTs ? format(new Date(r.departureTs), 'hh:mm a') : '',
      'Early leave (min)': r.earlyLeaveMin ?? '',
      'Status': t(`late.st.${r.status}`),
      'On roster (min)': r.recordedMinutes ?? '',
      'Reviewed by': r.reviewedName || '',
      'Decision': r.reviewAction || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 11 }, { wch: 28 }, { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 20 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Lateness');
    XLSX.writeFile(wb, `Lateness_${from}_${to}.xlsx`);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">{t('late.title')}</h1>
          <p className="text-sm font-bold text-gray-400 mt-1">{t('late.subtitle')}</p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="flex items-center gap-2 px-4 bg-white border border-gray-100 rounded-2xl shadow-sm">
            <CalendarDays size={15} className="text-gray-300 shrink-0" />
            <input type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)}
              className="py-4 bg-transparent text-xs font-black text-gray-900 outline-none cursor-pointer" />
            <span className="text-gray-300 font-black">–</span>
            <input type="date" value={to} min={from} max={ymd(today)} onChange={e => e.target.value && setTo(e.target.value)}
              className="py-4 bg-transparent text-xs font-black text-gray-900 outline-none cursor-pointer" />
          </div>
          <button onClick={exportToExcel} disabled={!all.length}
            className="flex items-center justify-center gap-2 px-6 py-4 bg-white border border-emerald-100 text-emerald-600 hover:bg-emerald-50 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all active:scale-95 shadow-sm disabled:opacity-40">
            <FileSpreadsheet size={16} /> Export Excel
          </button>
          <button onClick={rebuild} disabled={busy === 'rebuild'} title={t('late.rebuildHint')}
            className="flex items-center justify-center gap-2 px-5 py-4 bg-white border border-gray-100 text-gray-500 hover:bg-gray-50 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all active:scale-95 shadow-sm disabled:opacity-40">
            {busy === 'rebuild' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} {t('late.rebuild')}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-100 rounded-2xl px-5 py-4 text-sm font-bold text-rose-600">{error}</div>
      )}

      {staleSync && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-2xl px-5 py-4">
          <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-black text-amber-800">{t('late.staleSync')}</p>
            <p className="text-xs font-bold text-amber-600 mt-1">
              {t('late.lastSync')}: {report?.lastSyncAt ? format(new Date(report.lastSyncAt), 'MMM d, hh:mm a') : '—'}
            </p>
          </div>
        </div>
      )}

      {/* The second clock. Shown only once the server has XonTel credentials;
          until then the column would be empty for everyone and mean nothing. */}
      {report?.xontel.configured && (
        <div className={`flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl px-5 py-3 border ${
          report.xontel.lastError || xonStale ? 'bg-amber-50 border-amber-100' : 'bg-white border-gray-100'
        }`}>
          <div className="flex-1 min-w-0">
            {report.xontel.lastError ? (
              <p className="text-xs font-bold text-amber-700 truncate">{t('xon.col')}: {report.xontel.lastError}</p>
            ) : (
              <p className={`text-xs font-bold ${xonStale ? 'text-amber-700' : 'text-gray-400'}`}>
                {xonStale ? t('xon.stale') + ' · ' : ''}
                {t('xon.lastSync')}: {report.xontel.lastSyncAt ? format(new Date(report.xontel.lastSyncAt), 'MMM d, hh:mm a') : '—'}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={pullXontel} disabled={busy === 'xontel'} title={t('xon.pullHint')}
              className="flex items-center gap-1.5 px-4 py-2 bg-white border border-gray-100 text-gray-600 hover:bg-gray-50 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all active:scale-95 disabled:opacity-40">
              {busy === 'xontel' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} {t('xon.pull')}
            </button>
            <button onClick={() => setLinking(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 hover:bg-black text-white rounded-xl font-black text-[9px] uppercase tracking-widest transition-all active:scale-95">
              <Users size={12} /> {t('xon.link')}
            </button>
          </div>
        </div>
      )}

      {linking && <XontelLinkPanel onClose={() => { setLinking(false); load(); }} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label={t('late.st.LATE')} value={lateRows.length} tone="rose" />
        <Stat label={t('late.totalMinutes')} value={totalLateMin} tone="amber" />
        <Stat label={t('late.needsReview')} value={needsReview} tone="amber" />
        <Stat label={t('late.st.ON_TIME')} value={all.filter(r => r.status === 'ON_TIME').length} tone="emerald" />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
          {t('late.grace')}: {report?.graceMinutes ?? '—'} min
        </p>
        <button onClick={() => setShowAll(v => !v)}
          className="text-[10px] font-black uppercase tracking-widest text-blue-500 hover:text-blue-700">
          {showAll ? t('late.onlyFindings') : t('late.showAll')}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-gray-300" size={32} /></div>
      ) : shown.length === 0 ? (
        <div className="bg-white rounded-[32px] p-14 text-center border border-gray-100">
          <CheckCircle2 size={44} className="mx-auto text-emerald-200 mb-4" />
          <p className="text-gray-500 font-black">{t('late.empty')}</p>
          <p className="text-gray-400 text-sm font-medium mt-2 max-w-md mx-auto">{t('late.emptyHint')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map(r => {
            const key = `${r.userId}|${r.date}`;
            const why = t(`late.why.${r.status}`);
            // Offer a decision only where the engine has a number behind it.
            const offers: { action: LatenessAction; label: string }[] = [];
            if (r.offsetMin !== null && r.offsetMin > grace) {
              offers.push({ action: 'CONFIRM', label: t('late.confirm') });
            }
            if (r.earlyLeaveMin !== null && r.earlyLeaveMin >= earlyMin && r.status !== 'SHIFT_MISMATCH') {
              offers.push({ action: 'EARLY_LEAVE', label: t('late.recordEarly') });
            }
            if (r.status === 'NO_PUNCH') {
              offers.push({ action: 'ABSENT', label: t('late.recordAbsent') });
            }
            return (
              <div key={key} className="bg-white rounded-3xl border border-gray-100 p-5 shadow-sm">
                <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Avatar
                      name={r.name}
                      className="w-10 h-10 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center font-black text-blue-600 shrink-0 overflow-hidden text-sm"
                    />
                    <div className="min-w-0">
                      <p className="font-black text-gray-900 truncate">{r.name}</p>
                      <p className="text-[11px] font-bold text-gray-400">
                        {format(parseISO(r.date), 'EEE, MMM d')}{r.company ? ` · ${r.company}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-5 shrink-0">
                    <div className="text-center">
                      <p className="text-[9px] font-black uppercase tracking-widest text-gray-300">{t('late.scheduled')}</p>
                      <p className="text-sm font-black text-gray-700 tabular-nums">
                        {r.scheduledStart ? format(new Date(r.scheduledStart), 'HH:mm') : '--:--'}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-[9px] font-black uppercase tracking-widest text-gray-300">{t('late.arrived')}</p>
                      <p className="text-sm font-black text-gray-900 tabular-nums">
                        {r.arrivalTs ? format(new Date(r.arrivalTs), 'HH:mm') : '--:--'}
                      </p>
                    </div>
                    {report?.xontel.configured && (
                      <div className="text-center min-w-[56px]" title={
                        !r.xontelMapped ? t('xon.notLinked') : r.xontelLoginTs === null ? t('xon.noLogin') : t('xon.colHint')
                      }>
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-300">{t('xon.col')}</p>
                        <p className={`text-sm font-black tabular-nums ${r.xontelLoginTs ? 'text-gray-900' : 'text-gray-300'}`}>
                          {r.xontelLoginTs ? format(new Date(r.xontelLoginTs), 'HH:mm') : (r.xontelMapped ? '--:--' : '—')}
                        </p>
                        {/* Minutes from reaching the building to taking the first call. */}
                        {r.xontelGapMin !== null && (
                          <p className={`text-[10px] font-black tabular-nums ${r.xontelGapMin > 15 ? 'text-orange-500' : 'text-gray-400'}`}>
                            {r.xontelGapMin > 0 ? `+${r.xontelGapMin}` : r.xontelGapMin}m
                          </p>
                        )}
                      </div>
                    )}
                    {r.offsetMin !== null && (
                      <div className="text-center min-w-[64px]">
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-300">Diff</p>
                        <p className={`text-sm font-black tabular-nums ${r.offsetMin > (report?.graceMinutes ?? 10) ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {r.offsetMin > 0 ? `+${r.offsetMin}` : r.offsetMin}m
                        </p>
                      </div>
                    )}
                    <span className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest whitespace-nowrap ${STATUS_TONE[r.status]}`}>
                      {t(`late.st.${r.status}`)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 lg:ml-auto">
                    {/* The decisions offered follow the measurements, not the
                        headline status: a day can be both a late arrival and
                        an early departure, and the manager should be able to
                        record whichever one they mean. */}
                    {r.reviewAction ? (
                      <span className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest ${
                        r.reviewAction === 'DISMISS' ? 'bg-gray-100 text-gray-400' : 'bg-gray-900 text-white'
                      }`}>
                        {r.reviewAction === 'DISMISS' ? t('late.dismissed') : t('late.confirmed')}
                      </span>
                    ) : offers.length ? (
                      <>
                        {offers.map(o => (
                          <button key={o.action} onClick={() => review(r, o.action)} disabled={busy === key}
                            className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-900 hover:bg-black text-white rounded-xl font-black text-[9px] uppercase tracking-widest transition-all active:scale-95 disabled:opacity-40">
                            {busy === key ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} {o.label}
                          </button>
                        ))}
                        <button onClick={() => review(r, 'DISMISS')} disabled={busy === key}
                          className="px-4 py-2.5 bg-gray-50 hover:bg-gray-100 text-gray-500 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all active:scale-95 disabled:opacity-40">
                          {t('late.dismiss')}
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>

                {/* Every new roster day is created with minutes: 0, so only a
                    positive value means a manager actually recorded something.
                    Once this row is confirmed the badge already says so, and
                    repeating it here would grow the row at the moment of the
                    click, pushing everything below it out from under the
                    cursor. */}
                {(() => {
                  const hasWhy = why !== `late.why.${r.status}`;
                  const onRoster = r.recordedMinutes != null && r.recordedMinutes > 0
                    && !(r.reviewAction && r.reviewAction !== 'DISMISS');
                  // A day can be late AND end early; the headline shows the
                  // arrival, so the departure is spelled out here.
                  const early = r.earlyLeaveMin != null && r.earlyLeaveMin >= earlyMin
                    && r.status !== 'LEFT_EARLY' && r.status !== 'SHIFT_MISMATCH'
                    ? t('late.leftEarlyBy').replace('{n}', String(r.earlyLeaveMin)) : '';
                  // Past a few hours, "left early" and "forgot to clock out"
                  // look the same from here, so the row says so rather than
                  // letting a manager record the wrong one.
                  const ambiguous = r.earlyLeaveMin != null && r.earlyLeaveMin > earlyAmbiguous
                    ? t('late.why.LEFT_EARLY_LONG') : '';
                  const parts = [hasWhy ? why : '', early, ambiguous].filter(Boolean);
                  if (!parts.length && !onRoster) return null;
                  return (
                    <p className="text-[11px] font-bold text-gray-400 mt-3 pl-1">
                      {parts.join(' · ')}
                      {onRoster && (
                        <span className="text-blue-500">
                          {parts.length ? ' · ' : ''}
                          {t('late.alreadyOnRoster').replace('{n}', String(r.recordedMinutes))}
                        </span>
                      )}
                    </p>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TeamAttendance() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const isAdmin = user?.role === UserRole.ADMIN;
  const [team, setTeam] = useState<TeamAttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [kiosk, setKiosk] = useState(false);
  // Admin punch correction. Holds the punch being edited; null = closed.
  const [editing, setEditing] = useState<{ rowId: string; name: string; kind: 'IN' | 'OUT'; ts: number } | null>(null);
  const [editTime, setEditTime] = useState('');
  // Which person's XonTel day is open, if any.
  const [xonDay, setXonDay] = useState<{ userId: string; name: string } | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');

  const openEdit = (rowId: string, name: string, kind: 'IN' | 'OUT', ts: number) => {
    setEditing({ rowId, name, kind, ts });
    // datetime-local wants local wall-clock with no zone; the picker shows
    // the punch in the viewer's own zone, which is what an admin expects.
    setEditTime(format(new Date(ts), "yyyy-MM-dd'T'HH:mm"));
    setEditError('');
  };

  const saveEdit = async () => {
    if (!editing) return;
    const ts = new Date(editTime).getTime();
    if (!Number.isFinite(ts)) { setEditError(t('attendance.edit.invalid')); return; }
    setEditBusy(true);
    try {
      await store.editAttendance(editing.rowId, ts, editing.kind);
      setEditing(null);
    } catch (e: any) {
      setEditError(e?.message || t('attendance.edit.failed'));
    } finally {
      setEditBusy(false);
    }
  };

  const removePunch = async () => {
    if (!editing) return;
    if (!window.confirm(t('attendance.edit.confirmDelete'))) return;
    setEditBusy(true);
    try {
      await store.deleteAttendance(editing.rowId);
      setEditing(null);
    } catch (e: any) {
      setEditError(e?.message || t('attendance.edit.failed'));
    } finally {
      setEditBusy(false);
    }
  };
  // Selected day, yyyy-MM-dd. Defaults to today; re-subscribes on change so
  // the board (and the live poll behind it) always follows the picked day.
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const [date, setDate] = useState(todayStr);
  const isToday = date === todayStr;

  useEffect(() => {
    setLoading(true);
    // Only an admin may read the board (the server enforces this too). Without
    // this guard a non-admin would sit here polling a 403 every few seconds.
    if (!isAdmin) { setLoading(false); return; }
    const unsub = store.subscribeToTeamAttendance((rows) => {
      setTeam(rows);
      setLoading(false);
    }, isToday ? undefined : date);
    return () => unsub();
  }, [date, isToday, isAdmin]);

  // Someone flagged as a missed punch is not actually on site — counting them
  // there is what made the headcount wrong.
  const missed = team.filter(r => isMissedPunch(r.firstIn, r.lastOut, r.onSite));
  const onSite = team.filter(r => r.onSite && !isMissedPunch(r.firstIn, r.lastOut, r.onSite));
  const clockedOut = team.filter(r => !r.onSite && r.firstIn && !isMissedPunch(r.firstIn, r.lastOut, r.onSite));
  const noShow = team.filter(r => !r.firstIn);

  const exportToExcel = () => {
    if (team.length === 0) return;
    const rows = [...team].sort((a, b) => a.name.localeCompare(b.name)).map(r => ({
      'Date': date,
      'Employee': r.name,
      'Employee Code': r.employeeCode || '',
      'Job Title': r.jobTitle || 'Branch Employee',
      'First In': r.firstIn ? format(new Date(r.firstIn), 'hh:mm a') : '',
      // A missed punch has no trustworthy out-time or duration, so those
      // cells stay empty rather than exporting a figure payroll would total.
      'Last Out': r.lastOut && !isMissedPunch(r.firstIn, r.lastOut, r.onSite) ? format(new Date(r.lastOut), 'hh:mm a') : '',
      // Both forms on purpose: the readable one to check at a glance, and a
      // decimal that payroll can total without parsing "8h 05m".
      'Worked': (() => { if (isMissedPunch(r.firstIn, r.lastOut, r.onSite)) return ''; const ms = workedMs(r.firstIn, r.lastOut, r.onSite); return ms === null ? '' : fmtWorked(ms); })(),
      'Worked (hours)': (() => { if (isMissedPunch(r.firstIn, r.lastOut, r.onSite)) return ''; const ms = workedMs(r.firstIn, r.lastOut, r.onSite); return ms === null ? '' : Number((ms / 3600000).toFixed(2)); })(),
      'Status': isMissedPunch(r.firstIn, r.lastOut, r.onSite) ? 'No clock-out' : r.onSite ? 'On site' : r.firstIn ? 'Left' : 'No scan',
      'Scans': r.scanCount,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 11 }, { wch: 32 }, { wch: 14 }, { wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 9 }, { wch: 7 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
    XLSX.writeFile(wb, `Attendance_${date}.xlsx`);
  };

  return (
    <div className="space-y-8">
      {kiosk && <KioskDisplay onClose={() => setKiosk(false)} />}

      {xonDay && (
        <XontelDayPanel userId={xonDay.userId} name={xonDay.name} date={date} onClose={() => setXonDay(null)} />
      )}

      {editing && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm" onClick={() => !editBusy && setEditing(null)}>
          <div className="bg-white rounded-[28px] shadow-2xl w-full max-w-sm p-7" onClick={(e) => e.stopPropagation()}>
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
              {editing.kind === 'IN' ? t('attendance.edit.in') : t('attendance.edit.out')}
            </p>
            <p className="text-lg font-black text-gray-900 mt-1">{editing.name}</p>
            <p className="text-xs font-bold text-gray-400 mt-0.5">
              {t('attendance.edit.current')}: {format(new Date(editing.ts), 'EEE d MMM · p')}
            </p>
            <label className="block mt-5">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">{t('attendance.edit.newTime')}</span>
              <input
                type="datetime-local"
                value={editTime}
                onChange={(e) => setEditTime(e.target.value)}
                className="mt-1.5 w-full px-4 py-3 rounded-2xl bg-gray-50 border border-gray-100 text-gray-900 text-sm font-bold outline-none focus:ring-4 focus:ring-blue-500/10 focus:bg-white"
              />
            </label>
            {editError && <p className="text-xs font-bold text-rose-500 mt-3">{editError}</p>}
            <div className="flex items-center gap-2 mt-6">
              <button
                onClick={saveEdit}
                disabled={editBusy}
                className="flex-1 px-4 py-3 rounded-2xl bg-gray-900 text-white text-[11px] font-black uppercase tracking-widest hover:bg-gray-800 disabled:opacity-50 transition-all active:scale-[0.98]"
              >
                {editBusy ? t('attendance.edit.saving') : t('attendance.edit.save')}
              </button>
              <button
                onClick={removePunch}
                disabled={editBusy}
                title={t('attendance.edit.delete')}
                className="w-12 h-12 rounded-2xl flex items-center justify-center bg-rose-50 text-rose-600 hover:bg-rose-100 disabled:opacity-50 transition-colors"
              >
                <Trash2 size={16} />
              </button>
              <button
                onClick={() => setEditing(null)}
                disabled={editBusy}
                className="w-12 h-12 rounded-2xl flex items-center justify-center bg-gray-50 text-gray-500 hover:bg-gray-100 disabled:opacity-50 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">{t('attendance.title')}</h1>
          <p className="text-sm font-bold text-gray-400 mt-1">
            {format(parseISO(date), 'EEEE, MMMM d')}{isToday ? ` · ${t('attendance.updatingLive')}` : ''}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* The date picker and the export only make sense with the board,
              which is admin-only. The QR below is not: a branch manager still
              has to display it for their staff to clock in. */}
          {isAdmin && (
            <div className="flex items-center gap-2 px-4 bg-white border border-gray-100 rounded-2xl shadow-sm">
              <CalendarDays size={15} className="text-gray-300 shrink-0" />
              <input
                type="date"
                value={date}
                max={todayStr}
                onChange={(e) => { if (e.target.value) setDate(e.target.value); }}
                className="py-4 bg-transparent text-xs font-black text-gray-900 outline-none cursor-pointer"
              />
              {!isToday && (
                <button
                  onClick={() => setDate(todayStr)}
                  className="text-[9px] font-black uppercase tracking-widest text-blue-500 hover:text-blue-700 shrink-0"
                >
                  Today
                </button>
              )}
            </div>
          )}
          {isAdmin && (
            <button
              onClick={exportToExcel}
              disabled={team.length === 0}
              className="flex items-center justify-center gap-2 px-6 py-4 bg-white border border-emerald-100 text-emerald-600 hover:bg-emerald-50 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all active:scale-95 shadow-sm disabled:opacity-40"
            >
              <FileSpreadsheet size={16} /> Export Excel
            </button>
          )}
          <button
            onClick={() => setKiosk(true)}
            className="flex items-center justify-center gap-2 px-6 py-4 bg-gray-900 hover:bg-black text-white rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all active:scale-95"
          >
            <QrCode size={16} /> {t('attendance.showQR')}
            <Maximize2 size={14} className="opacity-50" />
          </button>
        </div>
      </div>

      {!isAdmin && (
        <div className="bg-white rounded-[32px] p-14 text-center border border-gray-100">
          <Lock size={44} className="mx-auto text-gray-200 mb-4" />
          <p className="text-gray-500 font-black">{t('attendance.adminOnly')}</p>
          <p className="text-gray-400 text-sm font-medium mt-2 max-w-md mx-auto">{t('attendance.adminOnlyHint')}</p>
        </div>
      )}

      {isAdmin && (
      <div className="grid grid-cols-3 gap-4">
        <Stat label={t('attendance.onSite')} value={onSite.length} tone="emerald" />
        <Stat label={t('attendance.clockedOut')} value={clockedOut.length} tone="gray" />
        {missed.length > 0 && <Stat label={t('attendance.missedPunch')} value={missed.length} tone="rose" />}
        <Stat label={t('attendance.noScanYet')} value={noShow.length} tone="amber" />
      </div>
      )}

      {!isAdmin ? null : loading ? (
        <p className="text-center py-20 text-gray-300 font-bold">{t('attendance.loadingTeam')}</p>
      ) : team.length === 0 ? (
        <div className="bg-white rounded-[32px] p-16 text-center border border-gray-100">
          <Users size={48} className="mx-auto text-gray-200 mb-4" />
          <p className="text-gray-400 font-bold">No one is assigned to you yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden">
          <div className="divide-y divide-gray-50">
            {[...team].sort((a, b) => {
              // Missed punches first: they are the rows that need fixing.
              const am = isMissedPunch(a.firstIn, a.lastOut, a.onSite);
              const bm = isMissedPunch(b.firstIn, b.lastOut, b.onSite);
              if (am !== bm) return am ? -1 : 1;
              if (a.onSite !== b.onSite) return a.onSite ? -1 : 1;
              if (!!a.firstIn !== !!b.firstIn) return a.firstIn ? -1 : 1;
              return a.name.localeCompare(b.name);
            }).map(r => (
              <div key={r.id} className="px-6 py-4 flex items-center gap-4">
                {/* The avatar opens that person's XonTel day for this date:
                    when they were signed in and taking calls, beside the
                    fingerprint times already on the row. */}
                <button
                  onClick={() => setXonDay({ userId: r.id, name: r.name })}
                  title={t('xon.openDay')}
                  className="shrink-0 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-300 hover:opacity-80 transition-opacity"
                >
                  <Avatar
                    name={r.name}
                    photoUrl={r.photoUrl || undefined}
                    className="w-11 h-11 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center font-black text-blue-600 shrink-0 overflow-hidden"
                  />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="font-black text-gray-900 text-sm truncate">{r.name}</p>
                  <p className="text-[11px] font-bold text-gray-400 truncate">{r.jobTitle || 'Employee'}</p>
                </div>
                <div className="flex items-center gap-5 shrink-0">
                  <TimeCell icon={LogIn} label="In" ts={r.firstIn} tone="emerald" />
                  {/* A span over a working day means this punch is missing,
                      so show it as missing rather than as a real time. */}
                  <TimeCell icon={LogOut} label="Out" ts={isMissedPunch(r.firstIn, r.lastOut, r.onSite) ? null : r.lastOut} tone="gray" />
                  <DurationCell firstIn={r.firstIn} lastOut={r.lastOut} onSite={r.onSite} />
                  {isAdmin && (r.firstInId || r.lastOutId) && (
                    <div className="hidden sm:flex items-center gap-1">
                      {r.firstInId && r.firstIn && (
                        <button
                          onClick={() => openEdit(r.firstInId!, r.name, 'IN', r.firstIn!)}
                          title={t('attendance.edit.in')}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-300 hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
                        >
                          <Pencil size={12} />
                        </button>
                      )}
                      {r.lastOutId && r.lastOut && (
                        <button
                          onClick={() => openEdit(r.lastOutId!, r.name, 'OUT', r.lastOut!)}
                          title={t('attendance.edit.out')}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-300 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                        >
                          <Pencil size={12} />
                        </button>
                      )}
                    </div>
                  )}
                  <span className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border ${
                    isMissedPunch(r.firstIn, r.lastOut, r.onSite) ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : r.onSite ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                    : r.firstIn ? 'bg-gray-50 text-gray-500 border-gray-100'
                    : 'bg-amber-50 text-amber-700 border-amber-100'
                  }`}>
                    {isMissedPunch(r.firstIn, r.lastOut, r.onSite) ? t('attendance.missedPunch')
                      : r.onSite ? t('attendance.onSite') : r.firstIn ? t('attendance.left') : t('attendance.noScan')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// One person's XonTel day, opened from their avatar on the attendance board.
// The fingerprint says when they reached the building; this says when they
// were actually signed in and taking calls, and where the time in between went.
function XontelDayPanel({ userId, name, date, onClose }: { userId: string; name: string; date: string; onClose: () => void }) {
  const { t } = useLanguage();
  const [day, setDay] = useState<XontelDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const d = await store.getXontelDay(userId, date);
        if (live) { setDay(d); setError(''); }
      } catch (e: any) {
        if (live) setError(e?.message || 'Could not load the XonTel day.');
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [userId, date]);

  const hhmm = (ts: number | null | undefined) => (ts ? format(new Date(ts), 'HH:mm') : '--:--');
  const dur = (s: number | null) => {
    if (!s) return '';
    const m = Math.round(s / 60);
    return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
  };
  // Minutes between reaching the building and signing in to take calls.
  const gap = day?.firstIn && day?.loginTs ? Math.round((day.loginTs - day.firstIn) / 60000) : null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-[32px] w-full max-w-2xl max-h-[86vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-8 pt-7 pb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-2xl font-black text-gray-900 tracking-tight truncate">{name}</h2>
            <p className="text-xs font-bold text-gray-400 mt-1">
              {format(parseISO(date), 'EEEE, MMMM d')}
              {day?.agentName ? ` · ${t('xon.col')}: ${day.agentName}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="w-11 h-11 rounded-2xl flex items-center justify-center bg-gray-50 text-gray-500 hover:bg-gray-100 shrink-0"><X size={16} /></button>
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="animate-spin text-gray-300" size={30} /></div>
        ) : error ? (
          <div className="mx-8 mb-8 bg-rose-50 border border-rose-100 rounded-2xl px-5 py-4 text-sm font-bold text-rose-600">{error}</div>
        ) : (
          <div className="flex-1 overflow-y-auto px-8 pb-8">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              {[
                { l: t('attendance.in'), v: hhmm(day?.firstIn), tone: 'text-emerald-600' },
                { l: t('attendance.out'), v: hhmm(day?.lastOut), tone: 'text-gray-700' },
                { l: `${t('xon.col')} ${t('attendance.in')}`, v: hhmm(day?.loginTs), tone: 'text-blue-600' },
                { l: `${t('xon.col')} ${t('attendance.out')}`, v: hhmm(day?.logoutTs), tone: 'text-blue-600' },
              ].map((c, i) => (
                <div key={i} className="rounded-2xl border border-gray-100 px-4 py-3 text-center">
                  <p className="text-[9px] font-black uppercase tracking-widest text-gray-300">{c.l}</p>
                  <p className={`text-lg font-black tabular-nums ${c.tone}`}>{c.v}</p>
                </div>
              ))}
            </div>

            {!day?.configured ? (
              <p className="text-sm font-bold text-gray-400 text-center py-6">{t('xon.notConfigured')}</p>
            ) : !day?.mapped ? (
              <div className="bg-amber-50 border border-amber-100 rounded-2xl px-5 py-4">
                <p className="text-sm font-black text-amber-800">{t('xon.notLinked')}</p>
                <p className="text-xs font-bold text-amber-600 mt-1">{t('xon.linkHint')}</p>
              </div>
            ) : (
              <>
                {gap !== null && (
                  <p className="text-xs font-bold text-gray-500 mb-4">
                    {t('xon.gap')}: <span className={gap > 15 ? 'text-orange-600' : 'text-gray-700'}>{gap > 0 ? `+${gap}` : gap} min</span>
                    {day.awaySeconds ? ` · ${t('xon.awaySeconds')} ${dur(day.awaySeconds)}` : ''}
                    {day.answeredCalls != null ? ` · ${day.answeredCalls} ${t('xon.answered')}` : ''}
                    {day.missedCalls ? ` · ${day.missedCalls} ${t('xon.missed')}` : ''}
                  </p>
                )}
                {/* Where the day went, per status. The timeline below is
                    dozens of short spells; this is the readable form of it. */}
                {!!day.totals?.length && (
                  <div className="mb-5">
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-300 mb-1">{t('xon.totals')}</p>
                    {/* Verified against the call records: an agent showed 87
                        minutes "in call" with not one call placed or received
                        in that window. The status is parked, not measured. */}
                    <p className="text-[10px] font-bold text-gray-400 mb-2 leading-snug">{t('xon.totalsNote')}</p>
                    {/* The server sends no "in call" total any more — the
                        measured talk time stands in for it, and takes its
                        place among the statuses by size. */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {[
                        ...day.totals.map(x => ({ ...x, count: x.count as number | null, talk: false, phantom: false })),
                        ...((day.talkSeconds || 0) > 0
                          ? [{ status: t('xon.talkTime'), seconds: day.talkSeconds || 0, count: day.answeredCalls ?? 0, signedIn: true, available: true, talk: true, phantom: false }]
                          : []),
                        // The parked part of "in call": status set, no call
                        // under it. Grey, and counted, so the day adds up.
                        ...((day.phantomCallSeconds || 0) > 0
                          ? [{ status: t('xon.phantom'), seconds: day.phantomCallSeconds || 0, count: null as number | null, signedIn: true, available: false, talk: false, phantom: true }]
                          : []),
                      ].sort((a, b) => b.seconds - a.seconds).map(x => (
                        <div key={x.talk ? '__talk' : x.phantom ? '__phantom' : x.status} title={x.phantom ? t('xon.phantomHint') : undefined} className={`rounded-xl px-3 py-2 border ${
                          x.talk ? 'bg-blue-50 border-blue-200'
                            : x.phantom ? 'bg-gray-100 border-gray-200 border-dashed'
                              : x.available ? 'bg-emerald-50 border-emerald-100'
                                : x.signedIn ? 'bg-amber-50 border-amber-100'
                                  : 'bg-gray-50 border-gray-100'
                        }`}>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className={`text-[11px] font-black truncate ${
                              x.talk ? 'text-blue-700' : x.phantom ? 'text-gray-500' : x.available ? 'text-emerald-700' : x.signedIn ? 'text-amber-800' : 'text-gray-500'
                            }`}>{x.status}</span>
                            {x.count !== null && (
                              <span className={`text-[9px] font-bold shrink-0 ${x.talk ? 'text-blue-400' : 'text-gray-400'}`}>×{x.count}</span>
                            )}
                          </div>
                          <p className={`text-sm font-black tabular-nums ${
                            x.talk ? 'text-blue-700' : x.phantom ? 'text-gray-500' : x.available ? 'text-emerald-700' : x.signedIn ? 'text-amber-800' : 'text-gray-500'
                          }`}>{dur(x.seconds) || '0m'}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* One chronological run. The "in call" STATUS is dropped and
                    the real calls take its place at the minutes they actually
                    happened — so where the status was parked with no call
                    underneath, the timeline shows the gap instead of an hour
                    of phantom talking. */}
                {(() => {
                  const rows = [
                    ...day.sessions.filter(s => s.status !== 'in call')
                      .map(s => ({ call: false as const, s })),
                    ...(day.calls || []).map(c => ({ call: true as const, c })),
                  ].sort((a, b) => (a.call ? a.c.startTs : a.s.startTs) - (b.call ? b.c.startTs : b.s.startTs));
                  if (!rows.length) return <p className="text-sm font-bold text-gray-400 text-center py-8">{t('xon.noLogin')}</p>;
                  return (
                    <div className="space-y-1.5">
                      {rows.map((r, i) => r.call ? (
                        <div key={i} className={`flex items-center gap-3 rounded-xl px-4 py-2.5 border ${
                          r.c.talkSec > 0 ? 'bg-blue-50/60 border-blue-100' : 'bg-gray-50 border-gray-100'
                        }`}>
                          <Phone size={12} className={`shrink-0 ${r.c.talkSec > 0 ? 'text-blue-500' : 'text-gray-300'}`} />
                          <span className={`text-xs font-black w-28 shrink-0 truncate ${r.c.talkSec > 0 ? 'text-blue-700' : 'text-gray-400'}`}>
                            {r.c.talkSec > 0 ? t('xon.talkTime') : t('xon.missed')}
                          </span>
                          <span className="text-xs font-bold text-gray-600 tabular-nums">
                            {hhmm(r.c.startTs)} → {hhmm(r.c.endTs)}
                          </span>
                          <span className="text-[11px] font-bold text-gray-400 truncate hidden sm:block">
                            {[r.c.number, r.c.queue].filter(Boolean).join(' · ')}
                          </span>
                          <span className={`text-[11px] font-black tabular-nums ml-auto shrink-0 ${r.c.talkSec > 0 ? 'text-blue-700' : 'text-gray-400'}`}>
                            {r.c.talkSec > 0 ? dur(r.c.talkSec) : '—'}
                          </span>
                        </div>
                      ) : (
                        <div key={i} className={`flex items-center gap-3 rounded-xl px-4 py-2.5 border ${
                          r.s.signedIn ? 'bg-white border-gray-100' : 'bg-gray-50 border-gray-100'
                        }`}>
                          {/* green = reachable, amber = signed in but away, grey = signed out */}
                          <span className={`w-2 h-2 rounded-full shrink-0 ml-0.5 ${
                            r.s.available ? 'bg-emerald-400' : r.s.signedIn ? 'bg-amber-400' : 'bg-gray-300'
                          }`} />
                          <span className="text-xs font-black text-gray-800 w-28 shrink-0 truncate">{r.s.status}</span>
                          <span className="text-xs font-bold text-gray-500 tabular-nums">
                            {hhmm(r.s.startTs)} → {r.s.endTs ? hhmm(r.s.endTs) : '…'}
                          </span>
                          <span className="text-[11px] font-bold text-gray-400 tabular-nums ml-auto">{dur(r.s.durationSec)}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Links each call-centre person to their XonTel agent. Suggestions come from
// the name and are shown pre-selected but never saved until confirmed —
// a wrong link would put one agent's logins on another person's record.
function XontelLinkPanel({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const [agents, setAgents] = useState<XontelAgent[]>([]);
  const [rows, setRows] = useState<XontelMapRow[]>([]);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  // The XonTel address: a quick tunnel's hostname changes on every restart.
  const [addr, setAddr] = useState('');
  const [addrInfo, setAddrInfo] = useState<{ baseUrl: string | null; newServer: boolean; lastError: string | null; lastSyncAt: number | null } | null>(null);
  const [addrMsg, setAddrMsg] = useState('');
  const [addrBusy, setAddrBusy] = useState(false);
  const loadAddr = React.useCallback(async () => {
    try { const a = await store.getXontelAddress(); setAddrInfo(a); setAddr(a.baseUrl || ''); } catch { /* panel still works */ }
  }, []);
  useEffect(() => { loadAddr(); }, [loadAddr]);
  const saveAddr = async () => {
    setAddrBusy(true); setAddrMsg('');
    try {
      await store.setXontelAddress(addr.trim());
      setAddrMsg('Saved. Swipr reads from this address from the next sync (within 5 minutes).');
      await loadAddr();
    } catch (e: any) {
      const m = String(e?.message || '').match(/\{.*\}/s);
      let msg = 'Could not save the address.';
      try { msg = (m && JSON.parse(m[0])?.error) || msg; } catch { /* keep default */ }
      setAddrMsg(msg);
    }
    setAddrBusy(false);
  };

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await store.getXontelAgentMap();
      setAgents(r.agents);
      setRows(r.rows);
      const pre: Record<string, string> = {};
      for (const row of r.rows) pre[row.userId] = row.xontelAgentId ?? row.suggestion?.id ?? '';
      setChoice(pre);
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Could not load the XonTel agent list.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (row: XontelMapRow, agentId: string | null) => {
    setBusy(row.userId);
    try {
      const agent = agentId ? agents.find(a => a.id === agentId) || null : null;
      await store.setXontelAgent(row.userId, agent);
      // Patch in place so the list does not jump while working down it.
      setRows(prev => prev.map(x => x.userId === row.userId
        ? { ...x, xontelAgentId: agent?.id ?? null, xontelAgentName: agent?.name ?? null, suggestion: null }
        : x));
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Could not save that link.');
    } finally {
      setBusy(null);
    }
  };

  const linked = rows.filter(r => r.xontelAgentId).length;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm" onClick={() => !busy && onClose()}>
      <div className="bg-white rounded-[32px] w-full max-w-3xl max-h-[88vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-8 pt-7 pb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black text-gray-900 tracking-tight">{t('xon.linkTitle')}</h2>
            <p className="text-xs font-bold text-gray-400 mt-1 max-w-xl">{t('xon.linkHint')}</p>
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-300 mt-2">{t('xon.linked')}: {linked} / {rows.length}</p>
          </div>
          <button onClick={onClose} className="w-11 h-11 rounded-2xl flex items-center justify-center bg-gray-50 text-gray-500 hover:bg-gray-100 shrink-0"><X size={16} /></button>
        </div>
        <div className="mx-8 mb-4 p-4 rounded-2xl bg-gray-50 border border-gray-100">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">XonTel address{addrInfo?.newServer ? ' · new server' : ''}</p>
          <div className="flex gap-2">
            <input value={addr} onChange={e => setAddr(e.target.value)} placeholder="https://name.trycloudflare.com/pbx"
              className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-white border border-gray-200 text-sm font-mono text-gray-900 outline-none focus:ring-4 focus:ring-blue-500/10" />
            <button onClick={saveAddr} disabled={addrBusy || !addr.trim() || addr.trim() === addrInfo?.baseUrl}
              className="px-4 py-2 rounded-xl bg-gray-900 text-white text-xs font-black uppercase tracking-widest disabled:opacity-40">{addrBusy ? 'Checking…' : 'Save'}</button>
          </div>
          <p className="text-[11px] text-gray-500 mt-2">
            {addrMsg || (addrInfo?.lastError ? `Last error: ${addrInfo.lastError}` : addrInfo?.lastSyncAt ? `Last synced ${new Date(addrInfo.lastSyncAt).toLocaleString()}` : 'Paste the tunnel address here whenever it changes. For the new server it ends in /pbx.')}
          </p>
        </div>
        {error && <div className="mx-8 mb-3 bg-rose-50 border border-rose-100 rounded-2xl px-4 py-3 text-xs font-bold text-rose-600">{error}</div>}
        <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-2">
          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="animate-spin text-gray-300" size={28} /></div>
          ) : rows.map(row => {
            const current = choice[row.userId] ?? '';
            const state = row.xontelAgentId ? 'linked' : row.suggestion ? 'suggested' : 'unlinked';
            const dirty = current !== (row.xontelAgentId ?? '');
            return (
              <div key={row.userId} className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border border-gray-100 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-black text-gray-900 text-sm truncate">{row.name}</p>
                  <p className="text-[10px] font-bold text-gray-400">{row.company || row.role}</p>
                </div>
                <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest shrink-0 ${
                  state === 'linked' ? 'bg-emerald-50 text-emerald-600' : state === 'suggested' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-400'
                }`}>{t(`xon.${state}`)}</span>
                <select value={current} onChange={e => setChoice(c => ({ ...c, [row.userId]: e.target.value }))}
                  className="sm:w-64 px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs font-bold text-gray-800 outline-none focus:border-gray-900">
                  <option value="">{t('xon.choose')}</option>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => save(row, current || null)} disabled={busy === row.userId || (!dirty && state === 'linked') || (!current && !row.xontelAgentId)}
                    className="px-4 py-2 bg-gray-900 hover:bg-black text-white rounded-xl font-black text-[9px] uppercase tracking-widest transition-all active:scale-95 disabled:opacity-30">
                    {busy === row.userId ? <Loader2 size={12} className="animate-spin" /> : t('xon.confirm')}
                  </button>
                  {row.xontelAgentId && (
                    <button onClick={() => save(row, null)} disabled={busy === row.userId}
                      className="px-3 py-2 bg-gray-50 hover:bg-gray-100 text-gray-500 rounded-xl font-black text-[9px] uppercase tracking-widest disabled:opacity-30">
                      {t('xon.unlink')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const Stat: React.FC<{ label: string; value: number; tone: 'emerald' | 'gray' | 'amber' | 'rose' }> = ({ label, value, tone }) => {
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    gray: 'bg-gray-50 text-gray-600 border-gray-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
  };
  return (
    <div className={`rounded-3xl border p-5 ${tones[tone]}`}>
      <p className="text-3xl font-black tabular-nums">{value}</p>
      <p className="text-[10px] font-black uppercase tracking-widest mt-1 opacity-70">{label}</p>
    </div>
  );
};

// Nobody works longer than this in one go, so a longer span means the
// clock-out was never punched — not that someone has been here for days.
// Kept below the 14h SHIFT_GAP_MS the server pairs shifts with: a span the
// server still treats as one shift but that is too long to be real is
// exactly the case this flags.
const MAX_SHIFT_MS = 11 * 60 * 60 * 1000;

// Time actually worked. While someone is still on site it counts up from
// their clock-in — the board re-polls every few seconds, so it stays current
// without a timer of its own.
const workedMs = (firstIn: number | null, lastOut: number | null, onSite: boolean): number | null => {
  if (!firstIn) return null;
  const end = onSite ? Date.now() : lastOut;
  if (!end) return null;
  const ms = end - firstIn;
  // A negative span would mean the pair is not a real shift; show nothing
  // rather than a nonsense figure.
  return ms >= 0 ? ms : null;
};

// A shift whose span exceeds a working day is a missing punch, not a long
// shift. Someone left without clocking out: their row would otherwise sit at
// "ON SITE" counting up indefinitely (91h and climbing), which also inflates
// the on-site headcount. Flagged instead, for an admin to correct.
const isMissedPunch = (firstIn: number | null, lastOut: number | null, onSite: boolean): boolean => {
  const ms = workedMs(firstIn, lastOut, onSite);
  return ms !== null && ms > MAX_SHIFT_MS;
};

const fmtWorked = (ms: number) => {
  const mins = Math.floor(ms / 60000);
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
};

const DurationCell: React.FC<{ firstIn: number | null; lastOut: number | null; onSite: boolean }> = ({ firstIn, lastOut, onSite }) => {
  const { t } = useLanguage();
  const ms = workedMs(firstIn, lastOut, onSite);
  const missed = isMissedPunch(firstIn, lastOut, onSite);
  return (
    <div className="hidden sm:flex items-center gap-1.5 min-w-[74px]">
      {missed
        ? <AlertTriangle size={13} className="text-rose-500" />
        : <Timer size={13} className={ms === null ? 'text-gray-200' : onSite ? 'text-blue-500' : 'text-gray-400'} />}
      <div>
        <p className={`text-[8px] font-black uppercase tracking-widest leading-none ${missed ? 'text-rose-400' : 'text-gray-300'}`}>
          {missed ? t('attendance.noPunchOut') : t('attendance.worked')}
        </p>
        <p className={`text-xs font-black tabular-nums ${
          missed ? 'text-rose-600' : ms === null ? 'text-gray-200' : onSite ? 'text-blue-600' : 'text-gray-900'
        }`}>
          {missed || ms === null ? '--:--' : fmtWorked(ms)}
        </p>
      </div>
    </div>
  );
};

const TimeCell: React.FC<{ icon: any; label: string; ts: number | null; tone: 'emerald' | 'gray' }> = ({ icon: Icon, label, ts, tone }) => (
  <div className="hidden sm:flex items-center gap-1.5 min-w-[74px]">
    <Icon size={13} className={ts ? (tone === 'emerald' ? 'text-emerald-500' : 'text-gray-400') : 'text-gray-200'} />
    <div>
      <p className="text-[8px] font-black text-gray-300 uppercase tracking-widest leading-none">{label}</p>
      <p className={`text-xs font-black tabular-nums ${ts ? 'text-gray-900' : 'text-gray-200'}`}>
        {ts ? format(new Date(ts), 'p') : '--:--'}
      </p>
    </div>
  </div>
);
