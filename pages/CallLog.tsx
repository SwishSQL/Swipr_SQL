import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../App';
import { useLanguage } from '../i18n';
import { store } from '../store';
import { CallLogEntry, UserRole } from '../types';
import { format, formatDistanceToNow } from 'date-fns';
import {
  PhoneCall, Search, ShieldCheck, Calendar, Lock, Play, Pause, Trash2,
  PhoneMissed, PhoneOff, PhoneIncoming, BellOff, Loader2, Download, MicOff,
} from 'lucide-react';

const FILTERS = ['All', 'Answered', 'Missed', 'Declined', 'Canceled', 'Recorded'] as const;
type Filter = typeof FILTERS[number];

const STATUS_STYLE: Record<string, { badge: string; icon: any; label: string }> = {
  answered:    { badge: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: PhoneCall,     label: 'call.log.answered' },
  missed:      { badge: 'bg-rose-100 text-rose-700 border-rose-200',          icon: PhoneMissed,   label: 'call.log.missed' },
  declined:    { badge: 'bg-amber-100 text-amber-700 border-amber-200',       icon: PhoneOff,      label: 'call.log.declined' },
  canceled:    { badge: 'bg-gray-100 text-gray-600 border-gray-200',          icon: PhoneOff,      label: 'call.log.canceled' },
  ringing:     { badge: 'bg-blue-100 text-blue-700 border-blue-200',          icon: PhoneIncoming, label: 'call.log.ringing' },
  interrupted: { badge: 'bg-gray-100 text-gray-600 border-gray-200',          icon: PhoneOff,      label: 'call.log.interrupted' },
  disconnected:{ badge: 'bg-orange-100 text-orange-700 border-orange-200',    icon: BellOff,       label: 'call.log.disconnected' },
};

const fmtDuration = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const fmtSize = (bytes: number) => bytes >= 1024 * 1024
  ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
  : `${Math.max(1, Math.round(bytes / 1024))} KB`;

// Who hung up. endedBy is a user id, and the row already carries both parties'
// names, so no extra lookup is needed. It is null when nobody hung up — a call
// that simply rang out, or one cut short by a server restart.
const endedByName = (e: CallLogEntry): string | null => {
  if (!e.endedBy) return null;
  if (e.endedBy === e.callerId) return e.callerName;
  if (e.endedBy === e.calleeId) return e.calleeName;
  return null;
};

const ENDED_BY_LABEL: Record<string, string> = {
  canceled: 'call.log.canceledBy',
  declined: 'call.log.declinedBy',
  answered: 'call.log.endedBy',
  // Deliberately "lost connection", not "ended by" — nobody chose this.
  disconnected: 'call.log.disconnectedBy',
};

const toLocalDay = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function CallLog() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [entries, setEntries] = useState<CallLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Playback state — one player at a time, keyed by call id.
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Object URLs must be revoked or the audio stays in memory for the session.
  const urlRef = useRef<string | null>(null);

  const isAdmin = user?.role === UserRole.ADMIN;

  useEffect(() => {
    if (!isAdmin) return;
    const unsub = store.subscribeToCallLog((data) => {
      setEntries(data);
      setLoading(false);
    }, 2000);
    return () => unsub();
  }, [isAdmin]);

  // Release the audio element and its blob URL when leaving the page.
  useEffect(() => () => {
    audioRef.current?.pause();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  const stopPlayback = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    setPlayingId(null);
  };

  const togglePlay = async (entry: CallLogEntry) => {
    if (playingId === entry.id) { stopPlayback(); return; }
    stopPlayback();
    setLoadingId(entry.id);
    try {
      const url = await store.getCallRecordingUrl(entry.id);
      urlRef.current = url;
      const audio = new Audio(url);
      audio.onended = () => stopPlayback();
      audioRef.current = audio;
      await audio.play();
      setPlayingId(entry.id);
    } catch {
      stopPlayback();
    } finally {
      setLoadingId(null);
    }
  };

  const download = async (entry: CallLogEntry) => {
    try {
      const url = await store.getCallRecordingUrl(entry.id);
      const a = document.createElement('a');
      a.href = url;
      a.download = `call-${entry.callerName}-${entry.calleeName}-${format(entry.startedAt, 'yyyy-MM-dd-HHmm')}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch { /* nothing to download */ }
  };

  const removeRecording = async (entry: CallLogEntry) => {
    if (!window.confirm(t('call.log.confirmDelete'))) return;
    if (playingId === entry.id) stopPlayback();
    await store.deleteCallRecording(entry.id);
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, hasRecording: false, recordingBytes: null } : e)));
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (filter === 'Recorded' && !e.hasRecording) return false;
      if (filter !== 'All' && filter !== 'Recorded' && e.status !== filter.toLowerCase()) return false;
      const day = toLocalDay(e.startedAt);
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
      if (!q) return true;
      return e.callerName.toLowerCase().includes(q) || e.calleeName.toLowerCase().includes(q);
    });
  }, [entries, search, filter, dateFrom, dateTo]);

  const stats = useMemo(() => ({
    total: filtered.length,
    answered: filtered.filter((e) => e.status === 'answered').length,
    missed: filtered.filter((e) => e.status === 'missed').length,
    recorded: filtered.filter((e) => e.hasRecording).length,
  }), [filtered]);

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <div className="bg-rose-50 w-20 h-20 rounded-full flex items-center justify-center mb-6">
          <Lock className="text-rose-400" size={36} />
        </div>
        <h2 className="text-xl font-black text-gray-400 uppercase tracking-widest">{t('call.log.adminOnly')}</h2>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto space-y-8 pb-24 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-black text-gray-900 tracking-tight">{t('call.log.title')}</h1>
            <span className="flex items-center gap-1.5 px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-[10px] font-black uppercase tracking-widest border border-purple-200">
              <ShieldCheck size={12} /> {t('call.log.adminAccess')}
            </span>
          </div>
          <p className="text-gray-400 font-medium text-sm mt-1">{t('call.log.subtitle')}</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: t('call.log.total'), value: stats.total, tone: 'text-gray-900' },
          { label: t('call.log.answered'), value: stats.answered, tone: 'text-emerald-600' },
          { label: t('call.log.missed'), value: stats.missed, tone: 'text-rose-600' },
          { label: t('call.log.recorded'), value: stats.recorded, tone: 'text-blue-600' },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-gray-100 rounded-2xl px-5 py-4 shadow-sm">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{s.label}</p>
            <p className={`text-2xl font-black mt-1 ${s.tone}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative group flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
          <input
            type="text"
            placeholder={t('call.log.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-12 pr-4 py-3 rounded-2xl bg-gray-50 border border-gray-100 text-gray-900 focus:ring-4 focus:ring-blue-500/10 focus:bg-white outline-none text-sm font-medium placeholder:text-gray-400 transition-all"
          />
        </div>
        <div className="flex items-center gap-1.5 p-1 bg-gray-50 border border-gray-100 rounded-2xl overflow-x-auto hide-scrollbar">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all ${
                filter === f ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-400 hover:bg-white'
              }`}
            >
              {t(`call.log.filter.${f.toLowerCase()}`)}
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
            onChange={(e) => setDateFrom(e.target.value)}
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
            onChange={(e) => setDateTo(e.target.value)}
            className="bg-transparent text-xs font-black text-gray-900 outline-none"
          />
        </div>
        {(dateFrom || dateTo) && (
          <button
            onClick={() => { setDateFrom(''); setDateTo(''); }}
            className="px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-900 transition-colors"
          >
            {t('audit.clearDates')}
          </button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="py-32 text-center text-gray-300 font-black uppercase tracking-widest text-sm">{t('call.log.loading')}</div>
      ) : filtered.length === 0 ? (
        <div className="py-32 text-center">
          <PhoneCall className="mx-auto text-gray-200 mb-4" size={48} />
          <p className="text-gray-300 font-black uppercase tracking-widest text-sm">{t('call.log.empty')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((e) => {
            const style = STATUS_STYLE[e.status] || STATUS_STYLE.canceled;
            const Icon = style.icon;
            const isPlaying = playingId === e.id;
            const isLoading = loadingId === e.id;
            return (
              <div key={e.id} className="bg-white border border-gray-100 rounded-2xl px-5 py-4 shadow-sm hover:border-gray-200 transition-colors">
                <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                  {/* Who called whom */}
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center border shrink-0 ${style.badge}`}>
                      <Icon size={17} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-black text-gray-900 text-sm truncate">
                        {e.callerName} <span className="text-gray-300 font-bold mx-1">→</span> {e.calleeName}
                      </p>
                      <div className="flex items-center gap-2 flex-wrap mt-1">
                        <span className="text-[11px] font-bold text-gray-400">
                          {format(e.startedAt, 'MMM d, yyyy · HH:mm')}
                        </span>
                        <span className="text-[11px] font-medium text-gray-300">
                          {/* A server clock a little ahead of the viewer's would
                              otherwise render a past call as "in 1 minute". */}
                          {e.startedAt > Date.now()
                            ? t('call.log.justNow')
                            : formatDistanceToNow(e.startedAt, { addSuffix: true })}
                        </span>
                      </div>
                      {endedByName(e) && ENDED_BY_LABEL[e.status] && (
                        <p className="text-[11px] font-bold text-gray-500 mt-1">
                          {t(ENDED_BY_LABEL[e.status])}{' '}
                          <span className="text-gray-900">{endedByName(e)}</span>
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Outcome */}
                  <div className="flex items-center gap-2 flex-wrap shrink-0">
                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${style.badge}`}>
                      {t(style.label)}
                    </span>
                    {e.status === 'answered' && (
                      <span className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-[10px] font-black tracking-widest border border-gray-200">
                        {fmtDuration(e.durationSec)}
                      </span>
                    )}
                    {/* The distinction the admin actually asked for: did it
                        even reach them, or did they ignore a real ring? */}
                    {e.status !== 'answered' && !e.ringDelivered && !e.pushSent && (
                      <span className="flex items-center gap-1.5 px-3 py-1 bg-orange-50 text-orange-600 rounded-full text-[10px] font-black uppercase tracking-widest border border-orange-200">
                        <BellOff size={11} /> {t('call.log.neverReached')}
                      </span>
                    )}
                    {e.status === 'missed' && (e.ringDelivered || e.pushSent) && (
                      <span className="px-3 py-1 bg-rose-50 text-rose-600 rounded-full text-[10px] font-black uppercase tracking-widest border border-rose-200">
                        {t('call.log.rangNoAnswer')}
                      </span>
                    )}
                  </div>

                  {/* Recording */}
                  <div className="flex items-center gap-2 shrink-0">
                    {e.hasRecording ? (
                      <>
                        <button
                          onClick={() => togglePlay(e)}
                          disabled={isLoading}
                          title={isPlaying ? t('call.log.stop') : t('call.log.play')}
                          className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all active:scale-95 ${
                            isPlaying ? 'bg-gray-900 text-white' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                          } disabled:opacity-50`}
                        >
                          {isLoading ? <Loader2 size={16} className="animate-spin" /> : isPlaying ? <Pause size={16} /> : <Play size={16} />}
                        </button>
                        {e.recordingBytes !== null && (
                          <span className="text-[10px] font-black text-gray-300 tracking-widest w-14">{fmtSize(e.recordingBytes)}</span>
                        )}
                        <button
                          onClick={() => download(e)}
                          title={t('call.log.download')}
                          className="w-10 h-10 rounded-xl flex items-center justify-center bg-gray-50 text-gray-500 hover:bg-gray-100 transition-all active:scale-95"
                        >
                          <Download size={15} />
                        </button>
                        <button
                          onClick={() => removeRecording(e)}
                          title={t('call.log.delete')}
                          className="w-10 h-10 rounded-xl flex items-center justify-center bg-gray-50 text-gray-400 hover:bg-rose-50 hover:text-rose-600 transition-all active:scale-95"
                        >
                          <Trash2 size={15} />
                        </button>
                      </>
                    ) : (
                      <span className="flex items-center gap-1.5 text-[10px] font-black text-gray-300 uppercase tracking-widest px-3">
                        <MicOff size={12} /> {t('call.log.noRecording')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] font-medium text-gray-300 text-center pt-4">{t('call.log.retentionNote')}</p>
    </div>
  );
}
