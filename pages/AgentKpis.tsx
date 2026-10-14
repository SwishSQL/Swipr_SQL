import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { Download, Search, X, AlertTriangle, ChevronUp, ChevronDown, SlidersHorizontal, Fingerprint, PhoneMissed } from 'lucide-react';
import { store } from '../store';
import { AgentKpiReport, AgentKpiRow, AdherenceReport, AdherenceRow, KpiTargets, MissedReport, MissedCall } from '../types';

// ---------------------------------------------------------------------------
// Agent performance — call-centre KPIs per agent, from XonTel data.
//
// Colour does one job here: identity of the five ways a signed-in day is
// spent. Fixed slots, validated (scripts/validate_palette.js) in this order
// against the app's card surfaces — light #ffffff and dark #1e293b — with
// orange and yellow deliberately NOT adjacent (that pair fails when touching).
// Every chart has a table twin: the agent ledger carries every number.
// ---------------------------------------------------------------------------
const VIZ_CSS = `
.kpi-viz{--c-talk:#2a78d6;--c-break:#eb6834;--c-avail:#1baf7a;--c-complain:#eda100;--c-other:#cbd5e1;
  --ink:#0f172a;--ink-2:#475569;--ink-3:#94a3b8;--grid:#eef0f3;--base:#cbd5e1;--surface:#ffffff;--tip:#0f172a;--tip-ink:#ffffff}
.dark .kpi-viz{--c-talk:#3987e5;--c-break:#d95926;--c-avail:#199e70;--c-complain:#c98500;--c-other:#475569;
  --ink:#f1f5f9;--ink-2:#cbd5e1;--ink-3:#94a3b8;--grid:#2a3649;--base:#475569;--surface:#1e293b;--tip:#f1f5f9;--tip-ink:#0f172a}
.kpi-viz .kpi-mark:focus-visible{outline:2px solid var(--c-talk);outline-offset:2px}
@media (prefers-reduced-motion: reduce){.kpi-viz *{transition:none!important}}
`;

type PartKey = 'talkSec' | 'breakSec' | 'availableSec' | 'complainSec' | 'otherSec';
const PARTS: { key: PartKey; label: string; color: string }[] = [
  { key: 'talkSec', label: 'Talking', color: 'var(--c-talk)' },
  { key: 'breakSec', label: 'Breaks', color: 'var(--c-break)' },
  { key: 'availableSec', label: 'Available', color: 'var(--c-avail)' },
  { key: 'complainSec', label: 'Complain', color: 'var(--c-complain)' },
  { key: 'otherSec', label: 'Coaching & other', color: 'var(--c-other)' },
];

const ymd = (d: Date) => format(d, 'yyyy-MM-dd');
const PRESETS: { key: string; label: string; range: () => [string, string] }[] = [
  { key: 'today', label: 'Today', range: () => [ymd(new Date()), ymd(new Date())] },
  { key: 'yesterday', label: 'Yesterday', range: () => { const d = new Date(); d.setDate(d.getDate() - 1); return [ymd(d), ymd(d)]; } },
  { key: 'month', label: 'This month', range: () => { const d = new Date(); return [ymd(new Date(d.getFullYear(), d.getMonth(), 1)), ymd(d)]; } },
  { key: 'lastMonth', label: 'Last month', range: () => { const d = new Date(); return [ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)), ymd(new Date(d.getFullYear(), d.getMonth(), 0))]; } },
];

// 2:14 for a handle time; 4h 12m / 38m for time spent.
// Tolerant of a missing value: a reporting page fed by an external system
// should degrade to a dash, never blank the whole screen on one undefined.
const mmss = (s: number) => { const v = Math.max(0, Math.round(Number(s) || 0)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; };
const dur = (s: number) => {
  const m = Math.max(0, Math.round((Number(s) || 0) / 60));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};
const num = (n: number) => (Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('en-US');

// ---- tooltip --------------------------------------------------------------
type Tip = { x: number; y: number; title: string; rows: { label: string; value: string; color?: string }[] } | null;
const Tooltip: React.FC<{ tip: Tip }> = ({ tip }) => {
  if (!tip) return null;
  return (
    <div role="tooltip" className="fixed z-[300] pointer-events-none rounded-xl px-3.5 py-2.5 shadow-xl text-xs"
      style={{ left: tip.x + 14, top: tip.y + 14, background: 'var(--tip)', color: 'var(--tip-ink)', maxWidth: 260 }}>
      <p className="font-bold opacity-70 mb-1">{tip.title}</p>
      {tip.rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 leading-5">
          {r.color && <span className="inline-block w-3 h-[3px] rounded-full" style={{ background: r.color }} />}
          <span className="font-black tabular-nums">{r.value}</span>
          <span className="opacity-70">{r.label}</span>
        </div>
      ))}
    </div>
  );
};

const useWidth = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const measure = () => { if (ref.current) setW(Math.max(240, Math.floor(ref.current.getBoundingClientRect().width))); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
};

// Clean axis ticks: 0 and 3-4 round steps up to the max.
const ticks = (max: number) => {
  if (max <= 0) return [0];
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) || raw;
  const out = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v));
  if (out[out.length - 1] < max) out.push(Math.round(out[out.length - 1] + step));
  return out;
};

// Bar with a 4px rounded data-end and a square base.
const colPath = (x: number, y: number, w: number, h: number) => {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};
const barPath = (x: number, y: number, w: number, h: number) => {
  const r = Math.min(4, h / 2, w);
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
};

// ---- calls answered: one series, columns ------------------------------------
const CallsChart: React.FC<{ data: AgentKpiReport; setTip: (t: Tip) => void }> = ({ data, setTip }) => {
  const [ref, w] = useWidth();
  const pts = data.series;
  const max = Math.max(1, ...pts.map((p) => p.answered));
  const tk = ticks(max);
  // Room for the widest tick label ("1,500"), so none is clipped.
  const H = 360, padB = 26, padT = 12, padL = 14 + 7 * Math.max(...tk.map((t) => num(t).length));
  const top = tk[tk.length - 1] || 1;
  const plotW = w - padL - 4, plotH = H - padB - padT;
  const slot = plotW / Math.max(1, pts.length);
  const bw = Math.min(24, Math.max(3, slot - 4));
  const y = (v: number) => padT + plotH - (v / top) * plotH;
  const every = pts.length > 16 ? Math.ceil(pts.length / 10) : 1;
  const label = (k: string) => (data.hourly ? k : String(Number(k.slice(8))));
  const fullLabel = (k: string) => (data.hourly ? `${k}:00 – ${k}:59` : format(new Date(k + 'T00:00:00'), 'EEE, MMM d'));
  return (
    <div ref={ref} className="w-full min-w-0 overflow-hidden">
      <svg viewBox={`0 0 ${w} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label={`Calls answered by ${data.hourly ? 'hour' : 'day'}`}>
        {tk.map((t) => (
          <g key={t}>
            <line x1={padL} x2={w - 4} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--base)' : 'var(--grid)'} strokeWidth={1} />
            <text x={padL - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--ink-3)" style={{ fontVariantNumeric: 'tabular-nums' }}>{num(t)}</text>
          </g>
        ))}
        {pts.map((p, i) => {
          const cx = padL + i * slot + slot / 2;
          const h = (p.answered / top) * plotH;
          const show = () => ({ title: fullLabel(p.key), rows: [
            { label: 'answered', value: num(p.answered), color: 'var(--c-talk)' },
            { label: 'missed', value: num(p.missed) },
          ] });
          return (
            <g key={p.key}>
              {/* The hit area is the whole slot, not just the painted bar. */}
              <rect x={padL + i * slot} y={padT} width={slot} height={plotH} fill="transparent" className="kpi-mark" tabIndex={0}
                onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY, ...show() })}
                onPointerLeave={() => setTip(null)}
                onFocus={(e) => { const r = (e.target as SVGRectElement).getBoundingClientRect(); setTip({ x: r.x + r.width / 2, y: r.y + 20, ...show() }); }}
                onBlur={() => setTip(null)} />
              {p.answered > 0 && <path d={colPath(cx - bw / 2, y(p.answered), bw, h)} fill="var(--c-talk)" pointerEvents="none" />}
              {i % every === 0 && (
                <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--ink-3)" style={{ fontVariantNumeric: 'tabular-nums' }}>{label(p.key)}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
};

// ---- handle time by agent: horizontal bars against the team average -----------
const AhtChart: React.FC<{ rows: AgentKpiRow[]; teamAht: number; setTip: (t: Tip) => void }> = ({ rows, teamAht, setTip }) => {
  const [ref, w] = useWidth();
  const list = rows.filter((r) => r.answered >= 5).sort((a, b) => b.ahtSec - a.ahtSec).slice(0, 14);
  const labelW = Math.min(132, w * 0.38), valueW = 44, row = 24;
  // Names are cut to what the label column can hold (~6.5px a character at 12px).
  const maxChars = Math.max(6, Math.floor((labelW - 12) / 6.5));
  const H = list.length * row + 30;
  const max = Math.max(teamAht, ...list.map((r) => r.ahtSec), 1);
  const plotW = Math.max(40, w - labelW - valueW - 8);
  const x = (s: number) => labelW + (s / max) * plotW;
  if (!list.length) return <p className="text-sm text-gray-400 py-10 text-center">No agent answered 5 or more calls in this range.</p>;
  return (
    <div ref={ref} className="w-full min-w-0 overflow-hidden">
      <svg viewBox={`0 0 ${w} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Average handle time by agent">
        {/* Team average: a reference line under the bars, labelled in text. */}
        <line x1={x(teamAht)} x2={x(teamAht)} y1={2} y2={H - 22} stroke="var(--ink-3)" strokeWidth={1} />
        {list.map((r, i) => {
          const yy = 6 + i * row;
          const show = (cx: number, cy: number) => setTip({ x: cx, y: cy, title: r.name, rows: [
            { label: 'avg handle time', value: mmss(r.ahtSec), color: 'var(--c-talk)' },
            { label: 'calls answered', value: num(r.answered) },
            { label: `team average`, value: mmss(teamAht) },
          ] });
          return (
            <g key={r.userId}>
              <rect x={0} y={yy - 3} width={w} height={row} fill="transparent" className="kpi-mark" tabIndex={0}
                onPointerMove={(e) => show(e.clientX, e.clientY)} onPointerLeave={() => setTip(null)}
                onFocus={(e) => { const b = (e.target as SVGRectElement).getBoundingClientRect(); show(b.x + labelW, b.y + 10); }} onBlur={() => setTip(null)} />
              <text x={labelW - 10} y={yy + 8} dy="0.32em" textAnchor="end" fontSize="12" fill="var(--ink-2)" pointerEvents="none">
                {r.name.length > maxChars ? r.name.slice(0, maxChars - 1) + '…' : r.name}
              </text>
              <path d={barPath(labelW, yy + 1, Math.max(2, x(r.ahtSec) - labelW), 14)} fill="var(--c-talk)" pointerEvents="none" />
              <text x={x(r.ahtSec) + 6} y={yy + 8} dy="0.32em" fontSize="12" fontWeight={700} fill="var(--ink)" stroke="var(--surface)" strokeWidth={4} paintOrder="stroke" pointerEvents="none" style={{ fontVariantNumeric: 'tabular-nums' }}>{mmss(r.ahtSec)}</text>
            </g>
          );
        })}
        <text x={x(teamAht)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--ink-2)">Team avg {mmss(teamAht)}</text>
      </svg>
    </div>
  );
};

// ---- one agent's signed-in time, as a strip --------------------------------
const Strip: React.FC<{ r: AgentKpiRow; setTip: (t: Tip) => void }> = ({ r, setTip }) => {
  const total = Math.max(1, PARTS.reduce((s, p) => s + r[p.key], 0));
  const segs = PARTS.map((p) => ({ ...p, v: r[p.key] })).filter((p) => p.v > 0);
  const tipRows = PARTS.map((p) => ({ label: p.label, value: dur(r[p.key]), color: p.color }));
  return (
    <div className="flex h-2.5 w-full min-w-[160px] rounded-full overflow-hidden kpi-mark cursor-default" tabIndex={0}
      style={{ gap: 2, background: 'var(--surface)' }} aria-label={`${r.name}: ${tipRows.map((t) => `${t.label} ${t.value}`).join(', ')}`}
      onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY, title: `${r.name} · ${dur(r.signedInSec)} signed in`, rows: tipRows })}
      onPointerLeave={() => setTip(null)}
      onFocus={(e) => { const b = e.currentTarget.getBoundingClientRect(); setTip({ x: b.x, y: b.y + 8, title: `${r.name} · ${dur(r.signedInSec)} signed in`, rows: tipRows }); }}
      onBlur={() => setTip(null)}>
      {segs.map((s) => <span key={s.key} style={{ width: `${(s.v / total) * 100}%`, background: s.color, minWidth: 2 }} />)}
    </div>
  );
};

type SortKey = 'name' | 'answered' | 'missed' | 'ahtSec' | 'outCalls' | 'talkSec' | 'breakSec' | 'complainSec' | 'signedInSec';

export default function AgentKpis() {
  const [from, setFrom] = useState(() => ymd(new Date()));
  const [to, setTo] = useState(() => ymd(new Date()));
  const [unit, setUnit] = useState('');
  const [query, setQuery] = useState('');
  const [data, setData] = useState<AgentKpiReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tip, setTip] = useState<Tip>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'answered', dir: -1 });
  const [tab, setTab] = useState<'kpis' | 'adherence' | 'missed'>('kpis');
  const [adh, setAdh] = useState<AdherenceReport | null>(null);
  const [adhLoading, setAdhLoading] = useState(true);
  const [adhError, setAdhError] = useState('');
  const [missed, setMissed] = useState<MissedReport | null>(null);
  const [missedLoading, setMissedLoading] = useState(true);
  const [missedError, setMissedError] = useState('');
  const [targets, setTargets] = useState<KpiTargets | null>(null);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [onlyOutside, setOnlyOutside] = useState(false);
  const today = ymd(new Date());

  useEffect(() => {
    let live = true;
    setLoading(true); setError('');
    store.getAgentKpis(from, to)
      .then((r) => { if (live) setData(r); })
      .catch((e: any) => {
        if (!live) return;
        const m = String(e?.message || '').match(/\{.*\}/s);
        let msg = 'Could not load these days.';
        try { msg = (m && JSON.parse(m[0])?.error) || msg; } catch { /* keep default */ }
        setError(msg);
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [from, to]);

  useEffect(() => {
    let live = true;
    setAdhLoading(true); setAdhError('');
    store.getAdherence(from, to)
      .then((r) => { if (live) setAdh(r); })
      .catch((e: any) => { if (live) setAdhError(e?.message || 'Could not load shift adherence.'); })
      .finally(() => { if (live) setAdhLoading(false); });
    return () => { live = false; };
  }, [from, to]);
  useEffect(() => {
    let live = true;
    setMissedLoading(true); setMissedError('');
    store.getMissedCalls(from, to)
      .then((r) => { if (live) setMissed(r); })
      .catch((e: any) => { if (live) setMissedError(e?.message || 'Could not load missed calls.'); })
      .finally(() => { if (live) setMissedLoading(false); });
    return () => { live = false; };
  }, [from, to]);
  useEffect(() => { store.getKpiTargets().then(setTargets).catch(() => {}); }, []);

  // Which targets an agent's figures fall outside of (see TargetsModal).
  const breaches = (r: AgentKpiRow): string[] => {
    if (!targets) return [];
    const out: string[] = [];
    if (r.answered >= 5 && r.ahtSec > targets.ahtMaxSec) out.push('aht');
    if (r.activeDays > 0 && r.breakSec / r.activeDays > targets.breakMaxSecPerDay) out.push('breaks');
    if (r.answered + r.missed >= 10 && (r.answered / (r.answered + r.missed)) * 100 < targets.pickupMinPct) out.push('pickup');
    return out;
  };

  const activePreset = PRESETS.find((p) => { const [a, b] = p.range(); return a === from && b === to; })?.key;
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (data?.agents || []).filter((r) =>
      (!unit || r.unit === unit) && (!q || r.name.toLowerCase().includes(q) || r.employeeCode.toLowerCase().includes(q))
      && (!onlyOutside || breaches(r).length > 0));
    return [...list].sort((a, b) => {
      const k = sort.key;
      const d = k === 'name' ? a.name.localeCompare(b.name) : (a[k] as number) - (b[k] as number);
      return d * sort.dir;
    });
  }, [data, unit, query, sort, onlyOutside, targets]);
  const outsideCount = useMemo(() => (data?.agents || []).filter((r) => (!unit || r.unit === unit) && breaches(r).length > 0).length, [data, unit, targets]);

  const adhRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (adh?.rows || []).filter((r) => (!unit || r.unit === unit) && (!q || r.name.toLowerCase().includes(q) || r.employeeCode.toLowerCase().includes(q)))
      .sort((a, b) => b.date.localeCompare(a.date) || a.shiftStart - b.shiftStart || a.name.localeCompare(b.name));
  }, [adh, unit, query]);

  // Totals follow the filters, so every number on the page agrees.
  const team = useMemo(() => {
    const t = rows.reduce((s, r) => ({
      answered: s.answered + r.answered, missed: s.missed + r.missed, inTalk: s.inTalk + r.inTalkSec,
      out: s.out + r.outCalls, outAns: s.outAns + r.outAnswered,
      brk: s.brk + r.breakSec, cmp: s.cmp + r.complainSec, agentDays: s.agentDays + r.activeDays,
    }), { answered: 0, missed: 0, inTalk: 0, out: 0, outAns: 0, brk: 0, cmp: 0, agentDays: 0 });
    // Incoming calls only — an outgoing call isn't "handled", and its talk
    // would drag the AHT down (2:01 instead of 2:22 on 2026-10-01).
    return { ...t, aht: t.answered ? Math.round(t.inTalk / t.answered) : 0,
      rate: t.answered + t.missed ? Math.round((t.answered / (t.answered + t.missed)) * 100) : 0,
      brkPerDay: t.agentDays ? t.brk / t.agentDays : 0 };
  }, [rows]);

  // The column chart shows the whole scope's calls; with a department or a
  // name picked, rebuild it from those agents' own days so it agrees.
  const chartData = useMemo(() => {
    if (!data || (!unit && !query.trim()) || data.hourly) return data;
    const keep = new Set(rows.map((r) => r.userId));
    const byDay = new Map(data.series.map((p) => [p.key, { key: p.key, answered: 0, missed: 0 }]));
    for (const d of data.agentDays) if (keep.has(d.userId)) { const p = byDay.get(d.day); if (p) { p.answered += d.answered; p.missed += d.missed; } }
    return { ...data, series: [...byDay.values()] };
  }, [data, rows, unit, query]);
  const hourlyFiltered = !!data?.hourly && (!!unit || !!query.trim());

  const exportExcel = () => {
    if (!data || !rows.length) return;
    const keep = new Set(rows.map((r) => r.userId));
    const nameOf = new Map(rows.map((r) => [r.userId, r]));
    const m = (s: number) => Math.round(s / 60);
    const agentSheet = rows.map((r) => ({
      Agent: r.name, 'Employee ID': r.employeeCode, Department: r.unit, 'Days worked': r.activeDays,
      'Customer calls answered': r.answered, 'Missed': r.missed, 'Avg handle time, incoming (m:ss)': mmss(r.ahtSec),
      'Outgoing calls': r.outCalls, 'Outgoing reached customer': r.outAnswered,
      'Talk, both directions (min)': m(r.talkSec), 'Breaks (min)': m(r.breakSec), 'Breaks (count)': r.breakCount,
      'Complain (min)': m(r.complainSec), 'Coaching & other (min)': m(r.otherSec), 'Available (min)': m(r.availableSec),
      'Signed in (min)': m(r.signedInSec),
    }));
    const daySheet = data.agentDays.filter((d) => keep.has(d.userId)).map((d) => ({
      Date: d.day, Agent: nameOf.get(d.userId)?.name, Department: nameOf.get(d.userId)?.unit,
      'Customer calls answered': d.answered, 'Missed': d.missed, 'Avg handle time, incoming (m:ss)': mmss(d.ahtSec),
      'Outgoing calls': d.outCalls, 'Outgoing reached customer': d.outAnswered,
      'Talk, both directions (min)': m(d.talkSec), 'Breaks (min)': m(d.breakSec), 'Breaks (count)': d.breakCount,
      'Complain (min)': m(d.complainSec), 'Coaching & other (min)': m(d.otherSec), 'Signed in (min)': m(d.signedInSec),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(agentSheet), 'Agents');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(daySheet), 'By day');
    if (adhRows.length) {
      const t = (ms: number | null) => (ms ? format(new Date(ms), 'yyyy-MM-dd HH:mm') : '');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(adhRows.map((r) => ({
        Date: r.date, Agent: r.name, Department: r.unit, 'Employee ID': r.employeeCode, 'Roster type': r.dayType,
        'Shift start': t(r.shiftStart), 'Shift end': t(r.shiftEnd), 'Fingerprint in': t(r.fpIn), 'Fingerprint out': t(r.fpOut),
        'XonTel login': t(r.loginTs), 'Login late (min)': r.loginLateMin ?? '', 'XonTel logout': t(r.logoutTs), 'Logged out early (min)': r.earlyLogoutMin ?? '',
        'Signed in (min)': Math.round(r.signedInSec / 60), 'Adherence %': r.adherencePct ?? '', Status: ADH_LABEL[r.status],
      }))), 'Adherence');
    }
    if (missed?.calls.length) {
      const t = (ms: number | null) => (ms ? format(new Date(ms), 'yyyy-MM-dd HH:mm') : '');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(missed.calls.map((c) => ({
        'Missed at': t(c.missedTs), Customer: c.caller, Queue: c.queue, Status: c.handled ? 'Called back' : 'Pending',
        'Called back by': c.calledBackBy || '', 'Called back at': t(c.assignedTs), 'Wait (min)': c.waitSec === null ? '' : Math.round(c.waitSec / 60),
        Outcome: c.callbacks.length ? outcomeLabel(c.callbacks[c.callbacks.length - 1].outcome) : '', Attempts: c.callbacks.length,
      }))), 'Missed calls');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(missed.agents.filter((a) => !unit || a.unit === unit).map((a) => ({
        Agent: a.name, Department: a.unit, 'Employee ID': a.employeeCode, 'Call-backs': a.callbacks, Reached: a.reached, Busy: a.busy, 'No answer': a.noAnswer,
        'Avg wait (min)': a.avgWaitSec === null ? '' : Math.round(a.avgWaitSec / 60),
      }))), 'Call-backs by agent');
    }
    XLSX.writeFile(wb, `Agent_performance_${from}${from === to ? '' : '_to_' + to}${unit ? '_' + unit.replace(/\W+/g, '-') : ''}.xlsx`);
  };

  const Th: React.FC<{ k: SortKey; children: React.ReactNode; right?: boolean; first?: boolean }> = ({ k, children, right, first }) => (
    <th className={`px-3 py-3 font-bold text-xs text-gray-500 whitespace-nowrap ${right ? 'text-right' : 'text-left'} ${first ? 'pl-6' : ''}`}
      aria-sort={sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className="inline-flex items-center gap-1 hover:text-gray-900" onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (-s.dir as 1 | -1) : (k === 'name' ? 1 : -1) }))}>
        {children}
        {sort.key === k ? (sort.dir === 1 ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : null}
      </button>
    </th>
  );

  const rangeLabel = from === to ? format(new Date(from + 'T00:00:00'), 'EEEE, MMMM d') : `${format(new Date(from + 'T00:00:00'), 'MMM d')} – ${format(new Date(to + 'T00:00:00'), 'MMM d, yyyy')}`;
  const multiDay = from !== to;

  return (
    <div className="kpi-viz space-y-8 min-w-0">
      <style>{VIZ_CSS}</style>
      <Tooltip tip={tip} />

      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">Agent performance</h1>
          <p className="text-sm text-gray-500 mt-1.5">
            {rangeLabel}{from === today ? ' so far' : ''}. Calls, handle time, breaks and complain time per agent, from XonTel
            {data?.lastSync ? `, updated ${format(new Date(data.lastSync), 'p')}` : ''}.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start md:self-auto">
        <button onClick={() => setTargetsOpen(true)} disabled={!targets}
          className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm font-bold transition-colors disabled:opacity-40">
          <SlidersHorizontal size={16} /> Targets
        </button>
        <button onClick={exportExcel} disabled={!rows.length}
          className="self-start md:self-auto flex items-center gap-2 px-5 py-3 rounded-2xl bg-gray-900 hover:bg-black text-white text-sm font-bold transition-colors disabled:opacity-40 border border-transparent dark:border-slate-500">
          <Download size={16} /> Export to Excel
        </button>
        </div>
      </div>

      {/* One filter row, scoping everything below it. */}
      <div className="flex flex-col xl:flex-row xl:items-center gap-3">
        <div className="inline-flex p-1 bg-gray-100 rounded-2xl self-start max-w-full overflow-x-auto">
          {PRESETS.map((p) => (
            <button key={p.key} onClick={() => { const [a, b] = p.range(); setFrom(a); setTo(b); }}
              className={`px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition-colors ${activePreset === p.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <input type="date" value={from} max={today} aria-label="From"
            onChange={(e) => { const v = e.target.value; if (v) { setFrom(v); if (v > to) setTo(v); } }}
            className="px-3 py-2.5 rounded-xl bg-white border border-gray-100 font-bold text-gray-900 outline-none focus:ring-4 focus:ring-blue-500/10" />
          <span className="text-gray-400">to</span>
          <input type="date" value={to} max={today} aria-label="To"
            onChange={(e) => { const v = e.target.value; if (v) { setTo(v); if (v < from) setFrom(v); } }}
            className="px-3 py-2.5 rounded-xl bg-white border border-gray-100 font-bold text-gray-900 outline-none focus:ring-4 focus:ring-blue-500/10" />
        </div>
        {(data?.units.length || 0) > 1 && (
          <select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Department"
            className="px-4 py-2.5 rounded-xl bg-white border border-gray-100 text-sm font-bold text-gray-900 outline-none focus:ring-4 focus:ring-blue-500/10">
            <option value="">All departments</option>
            {data!.units.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        )}
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find an agent by name or ID" aria-label="Find an agent"
            className="w-full pl-10 pr-9 py-2.5 rounded-xl bg-white border border-gray-100 text-sm text-gray-900 outline-none focus:ring-4 focus:ring-blue-500/10 placeholder:text-gray-400" />
          {query && <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"><X size={15} /></button>}
        </div>
      </div>

      <div className="inline-flex p-1 bg-gray-100 rounded-2xl">
        {([['kpis', 'Calls & time'], ['adherence', 'Shift adherence'], ['missed', 'Missed customers']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${tab === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'missed' ? (
        <MissedTab report={missed} loading={missedLoading} error={missedError} unit={unit} query={query} multiDay={multiDay} today={today} setTip={setTip} />
      ) : tab === 'adherence' ? (
        <AdherenceTab report={adh} rows={adhRows} loading={adhLoading} error={adhError} targets={targets} multiDay={multiDay} today={today} />
      ) : error ? (
        <div className="bg-rose-50 border border-rose-100 rounded-2xl px-5 py-4 text-sm font-bold text-rose-600">{error}</div>
      ) : !data ? (
        <p className="text-center py-24 text-gray-400">Loading agent numbers…</p>
      ) : (
        // A refetch keeps the previous numbers on screen, dimmed — no flash.
        <div className={`space-y-8 transition-opacity ${loading ? 'opacity-50' : ''}`}>
          {/* Headline numbers */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-px bg-gray-100 rounded-[28px] overflow-hidden border border-gray-100">
            {[
              { label: 'Customer calls answered', value: num(team.answered), sub: `${num(team.missed)} missed` },
              { label: 'Pickup rate', value: `${team.rate}%`, sub: `of ${num(team.answered + team.missed)} incoming calls that rang an agent` },
              { label: 'Average handle time', value: mmss(team.aht), sub: 'talk per answered incoming call' },
              { label: 'Outgoing calls', value: num(team.out), sub: `${num(team.outAns)} reached the customer` },
              { label: multiDay ? 'Breaks per agent a day' : 'Breaks per agent', value: dur(team.brkPerDay), sub: `${dur(team.brk)} in total` },
              { label: 'Complain time', value: dur(team.cmp), sub: `${rows.filter((r) => r.complainSec > 0).length} agents` },
            ].map((s) => (
              <div key={s.label} className="bg-white min-w-0 px-5 sm:px-6 py-5">
                <p className="text-sm font-semibold text-gray-500">{s.label}</p>
                <p className="text-[26px] sm:text-[34px] leading-tight font-black text-gray-900 tracking-tight mt-1">{s.value}</p>
                <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
            <section className="xl:col-span-3 min-w-0 bg-white rounded-[28px] border border-gray-100 p-5 sm:p-6">
              <div className="flex items-baseline justify-between gap-3 mb-4">
                <h2 className="text-lg font-black text-gray-900">Customer calls answered {data.hourly ? 'by hour' : 'by day'}</h2>
                {hourlyFiltered && <span className="text-xs text-gray-400">All departments — the hourly view isn't split by filter</span>}
              </div>
              {chartData && <CallsChart data={chartData} setTip={setTip} />}
            </section>
            <section className="xl:col-span-2 min-w-0 bg-white rounded-[28px] border border-gray-100 p-5 sm:p-6">
              <div className="mb-4">
                <h2 className="text-lg font-black text-gray-900">Average handle time by agent</h2>
                <p className="text-xs text-gray-400 mt-0.5">Incoming calls · agents with 5 or more answered, longest first</p>
              </div>
              <AhtChart rows={rows} teamAht={team.aht} setTip={setTip} />
            </section>
          </div>

          {/* The ledger: every number above, per agent — and the table view of the charts. */}
          <section className="bg-white rounded-[28px] border border-gray-100 overflow-hidden">
            <div className="px-6 pt-6 pb-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-gray-900">Agents</h2>
                <p className="text-xs text-gray-400 mt-0.5">{rows.length} agent{rows.length !== 1 ? 's' : ''}{multiDay ? ' · totals for the whole range' : ''} · click a column to sort</p>
                {targets && (
                  <button onClick={() => setOnlyOutside((v) => !v)}
                    className={`mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${onlyOutside ? 'bg-amber-600 border-amber-600 text-white' : outsideCount ? 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100' : 'bg-gray-50 border-gray-200 text-gray-500'}`}>
                    <AlertTriangle size={12} /> {outsideCount} outside targets{onlyOutside ? ' · showing only these' : ''}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5" aria-label="How signed-in time is split">
                {PARTS.map((p) => (
                  <span key={p.key} className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />{p.label}
                  </span>
                ))}
              </div>
            </div>
            {rows.length === 0 ? (
              <p className="px-6 pb-10 pt-4 text-sm text-gray-400">
                {query || unit ? 'No agents match these filters.' : 'No XonTel activity for linked agents in this range.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-y border-gray-100 bg-gray-50/50">
                    <tr>
                      <Th k="name" first>Agent</Th>
                      <Th k="answered" right>Answered</Th>
                      <Th k="missed" right>Missed</Th>
                      <Th k="ahtSec" right>Avg handle</Th>
                      <Th k="outCalls" right>Outgoing</Th>
                      <Th k="talkSec" right>Talking</Th>
                      <Th k="breakSec" right>Breaks</Th>
                      <Th k="complainSec" right>Complain</Th>
                      <Th k="signedInSec" right>Signed in</Th>
                      <th className="px-3 py-3 font-bold text-xs text-gray-500 text-left w-[28%]">How the time was spent</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {rows.map((r) => (
                      <tr key={r.userId} className="hover:bg-gray-50/50">
                        <td className="px-3 py-3 pl-6">
                          <p className="font-bold text-gray-900 whitespace-nowrap">{r.name}</p>
                          <p className="text-xs text-gray-400 whitespace-nowrap">{[r.unit, r.employeeCode, multiDay ? `${r.activeDays} day${r.activeDays !== 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')}</p>
                          {r.flags.includes('long_signin') && (
                            <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                              <AlertTriangle size={12} /> Signed in over 12h a day — probably never logged out
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap font-bold text-gray-900 tabular-nums">{num(r.answered)}</td>
                        <td className={`px-3 py-3 text-right whitespace-nowrap tabular-nums ${breaches(r).includes('pickup') ? 'text-amber-700 font-bold' : 'text-gray-500'}`} title={breaches(r).includes('pickup') && targets ? `Pickup below ${targets.pickupMinPct}%` : undefined}>{breaches(r).includes('pickup') && <AlertTriangle size={12} className="inline mr-1 -mt-0.5" />}{num(r.missed)}</td>
                        <td className={`px-3 py-3 text-right whitespace-nowrap font-bold tabular-nums ${breaches(r).includes('aht') ? 'text-amber-700' : 'text-gray-900'}`} title={breaches(r).includes('aht') && targets ? `Above the ${mmss(targets.ahtMaxSec)} target` : undefined}>{breaches(r).includes('aht') && <AlertTriangle size={12} className="inline mr-1 -mt-0.5" />}{r.answered ? mmss(r.ahtSec) : '—'}</td>
                        <td className="px-3 py-3 text-right whitespace-nowrap text-gray-600 tabular-nums" title={`${r.outAnswered} of ${r.outCalls} reached the customer`}>{num(r.outCalls)}</td>
                        <td className="px-3 py-3 text-right whitespace-nowrap text-gray-600 tabular-nums">{dur(r.talkSec)}</td>
                        <td className={`px-3 py-3 text-right tabular-nums whitespace-nowrap ${breaches(r).includes('breaks') ? 'text-amber-700 font-bold' : 'text-gray-600'}`} title={breaches(r).includes('breaks') && targets ? `Above ${dur(targets.breakMaxSecPerDay)} a day` : undefined}>{breaches(r).includes('breaks') && <AlertTriangle size={12} className="inline mr-1 -mt-0.5" />}{dur(r.breakSec)}<span className="text-gray-400"> · {r.breakCount}</span></td>
                        <td className="px-3 py-3 text-right whitespace-nowrap text-gray-600 tabular-nums">{dur(r.complainSec)}</td>
                        <td className="px-3 py-3 text-right whitespace-nowrap text-gray-600 tabular-nums">{dur(r.signedInSec)}</td>
                        <td className="px-3 py-3 pr-6">{r.signedInSec > 0 ? <Strip r={r} setTip={setTip} /> : <span className="text-xs text-gray-400">No XonTel status recorded</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="px-6 py-4 border-t border-gray-100 text-xs text-gray-400 leading-relaxed">
              Answered calls and handle time count incoming customer calls only; outgoing calls are counted on their own. "Missed" is an incoming call that rang that agent and they didn't answer — the customer may still have been answered by a colleague, which is why XonTel's dashboard, counting missed customer calls at the queue, shows a different number. Handle time is talk time from XonTel's call records; XonTel's own AHT may also count hold or wrap-up time.
              Breaks are Break, Toilet, Pray and Eating. {from === today ? "Today's figures fill in as each status ends on XonTel." : ''}
            </p>
          </section>
        </div>
      )}

      {targetsOpen && targets && (
        <TargetsModal targets={targets} onClose={() => setTargetsOpen(false)}
          onSave={async (t) => { const saved = await store.saveKpiTargets(t); setTargets(saved); setTargetsOpen(false); }} />
      )}
    </div>
  );
}

const ADH_LABEL: Record<AdherenceRow['status'], string> = {
  ok: 'On time', late_login: 'Late login', early_logout: 'Logged out early', no_login: 'No login', upcoming: 'Upcoming',
};
const ADH_STYLE: Record<AdherenceRow['status'], string> = {
  ok: 'bg-emerald-50 text-emerald-700 border-emerald-100', late_login: 'bg-amber-50 text-amber-700 border-amber-100',
  early_logout: 'bg-amber-50 text-amber-700 border-amber-100', no_login: 'bg-rose-50 text-rose-700 border-rose-100', upcoming: 'bg-gray-50 text-gray-500 border-gray-200',
};
const hm = (ms: number | null) => (ms ? format(new Date(ms), 'HH:mm') : '—');

// Roster shift vs XonTel sign-in vs fingerprint, one row per shift.
const AdherenceTab: React.FC<{ report: AdherenceReport | null; rows: AdherenceRow[]; loading: boolean; error: string; targets: KpiTargets | null; multiDay: boolean; today: string }> =
  ({ report, rows, loading, error, targets, multiDay, today }) => {
  if (error) return <div className="bg-rose-50 border border-rose-100 rounded-2xl px-5 py-4 text-sm font-bold text-rose-600">{error}</div>;
  if (!report) return <p className="text-center py-24 text-gray-400">Loading shift adherence…</p>;
  const done = rows.filter((r) => r.status !== 'upcoming');
  const count = (st: AdherenceRow['status']) => done.filter((r) => r.status === st).length;
  const withPct = done.filter((r) => r.adherencePct !== null);
  const avgAdh = withPct.length ? Math.round(withPct.reduce((s, r) => s + (r.adherencePct || 0), 0) / withPct.length) : null;
  const fpStale = !report.fingerprintLastSync || Date.now() - report.fingerprintLastSync > 6 * 3600e3;
  const lateFlag = (r: AdherenceRow) => targets && r.loginLateMin !== null && r.loginLateMin > targets.lateLoginMaxMin;
  const adhFlag = (r: AdherenceRow) => targets && r.adherencePct !== null && r.status !== 'upcoming' && r.adherencePct < targets.adherenceMinPct;
  return (
    <div className={`space-y-8 transition-opacity ${loading ? 'opacity-50' : ''}`}>
      {fpStale && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-100 rounded-2xl text-sm text-amber-800">
          <Fingerprint size={18} className="shrink-0 mt-0.5" />
          <p><span className="font-bold">Fingerprint columns are empty</span> — the office bridge last delivered punches {report.fingerprintLastSync ? format(new Date(report.fingerprintLastSync), 'MMM d, p') : 'never'}. XonTel times are unaffected.</p>
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-px bg-gray-100 rounded-[28px] overflow-hidden border border-gray-100">
        {[
          { label: 'Shifts', value: num(done.length), sub: `${num(rows.length - done.length)} still to come` },
          { label: 'On time', value: num(count('ok')), sub: 'signed in within grace, stayed to the end' },
          { label: 'Late login', value: num(count('late_login')), sub: `more than ${report.lateGraceMin} min after the shift start` },
          { label: 'Logged out early', value: num(count('early_logout')), sub: `more than ${report.earlyLeaveMin} min before the end` },
          { label: 'No login', value: num(count('no_login')), sub: 'never signed in to XonTel' },
          { label: 'Avg adherence', value: avgAdh === null ? '—' : `${avgAdh}%`, sub: 'of the shift signed in' },
        ].map((s) => (
          <div key={s.label} className="bg-white min-w-0 px-5 sm:px-6 py-5">
            <p className="text-sm font-semibold text-gray-500">{s.label}</p>
            <p className="text-[26px] sm:text-[34px] leading-tight font-black text-gray-900 tracking-tight mt-1">{s.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      <section className="bg-white rounded-[28px] border border-gray-100 overflow-hidden">
        <div className="px-6 pt-6 pb-4">
          <h2 className="text-lg font-black text-gray-900">Shifts</h2>
          <p className="text-xs text-gray-400 mt-0.5">{rows.length} rostered shift{rows.length !== 1 ? 's' : ''} for linked agents · shift times anchored the same way as the Lateness page</p>
        </div>
        {rows.length === 0 ? (
          <p className="px-6 pb-10 pt-4 text-sm text-gray-400">No rostered shifts for linked agents in this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-gray-100 bg-gray-50/50">
                <tr>
                  {['Agent', multiDay ? 'Date · shift' : 'Shift', 'Fingerprint', 'XonTel login', 'XonTel logout', 'Signed in', 'Status'].map((h, i) => (
                    <th key={h} className={`px-3 py-3 font-bold text-xs text-gray-500 whitespace-nowrap text-left ${i === 0 ? 'pl-6' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r) => (
                  <tr key={`${r.userId}|${r.date}`} className="hover:bg-gray-50/50">
                    <td className="px-3 py-3 pl-6">
                      <p className="font-bold text-gray-900 whitespace-nowrap">{r.name}</p>
                      <p className="text-xs text-gray-400 whitespace-nowrap">{[r.unit, r.employeeCode].filter(Boolean).join(' · ')}</p>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap tabular-nums text-gray-700">
                      {multiDay && <span className="text-gray-400 mr-2">{format(new Date(r.date + 'T00:00:00'), 'EEE d')}</span>}
                      {hm(r.shiftStart)}–{hm(r.shiftEnd)}
                      {r.dayType !== 'NORMAL_SHIFT' && <span className="ml-2 text-[10px] font-bold uppercase text-gray-400">{r.dayType.replace(/_/g, ' ')}</span>}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap tabular-nums text-gray-600">{r.fpIn || r.fpOut ? `${hm(r.fpIn)} → ${hm(r.fpOut)}` : <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-3 whitespace-nowrap tabular-nums">
                      <span className="text-gray-900 font-bold">{hm(r.loginTs)}</span>
                      {r.loginLateMin !== null && r.loginLateMin > 0 && <span className={`ml-2 text-xs font-bold ${lateFlag(r) ? 'text-amber-700' : 'text-gray-400'}`}>+{r.loginLateMin}m</span>}
                      {r.loginLateMin !== null && r.loginLateMin < 0 && <span className="ml-2 text-xs text-gray-400">{r.loginLateMin}m</span>}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap tabular-nums">
                      <span className="text-gray-900 font-bold">{r.running ? <span className="text-emerald-600 font-semibold">still on shift</span> : hm(r.logoutTs)}</span>
                      {r.earlyLogoutMin !== null && r.earlyLogoutMin > 0 && <span className="ml-2 text-xs font-bold text-amber-700">−{r.earlyLogoutMin}m</span>}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap tabular-nums">
                      <span className={`font-bold ${adhFlag(r) ? 'text-amber-700' : 'text-gray-900'}`}>{r.adherencePct === null ? '—' : `${r.adherencePct}%`}</span>
                      <span className="text-gray-400 text-xs ml-2">{dur(r.signedInSec)}{r.running ? ' so far' : ''}</span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-bold border ${ADH_STYLE[r.status]}`}>{ADH_LABEL[r.status]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="px-6 py-4 border-t border-gray-100 text-xs text-gray-400 leading-relaxed">
          Login is the first XonTel sign-in for the shift (anything but offline; a sign-in up to 2 hours early counts). Logout is the last session end. Signed-in time includes breaks — they are part of the shift.
          {today >= report.from && today <= report.to ? " Today's shifts fill in as each XonTel status ends." : ''}
        </p>
      </section>
    </div>
  );
};

// ---- Missed customer calls ---------------------------------------------------
// The queue-level list from XonTel's own Missed Calls page: who abandoned a
// queue, whether anyone called them back, and how it went.
const outcomeLabel = (o: string) => { const s = o.toLowerCase(); return s === 'done' ? 'Reached' : s === 'busy' ? 'Busy' : /no\s*answer/.test(s) ? 'No answer' : o || '—'; };
const outcomeStyle = (o: string) => { const s = o.toLowerCase(); return s === 'done' ? 'text-emerald-700' : s === 'busy' || /no\s*answer/.test(s) ? 'text-amber-700' : 'text-gray-500'; };
const waitLabel = (s: number | null) => (s === null ? '—' : s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : dur(s));
const PENDING_OLD_MS = 60 * 60 * 1000;

// Missed calls per queue, split into called back / still pending.
const QueueChart: React.FC<{ calls: MissedCall[]; setTip: (t: Tip) => void }> = ({ calls, setTip }) => {
  const [ref, w] = useWidth();
  const byQ = new Map<string, { q: string; handled: number; pending: number }>();
  for (const c of calls) {
    const k = c.queue || 'No queue';
    if (!byQ.has(k)) byQ.set(k, { q: k, handled: 0, pending: 0 });
    const b = byQ.get(k)!;
    if (c.handled) b.handled++; else b.pending++;
  }
  const list = [...byQ.values()].sort((a, b) => (b.handled + b.pending) - (a.handled + a.pending)).slice(0, 14);
  const labelW = Math.min(150, w * 0.4), valueW = 44, row = 24;
  const maxChars = Math.max(6, Math.floor((labelW - 12) / 6.5));
  const H = list.length * row + 12;
  const max = Math.max(1, ...list.map((r) => r.handled + r.pending));
  const plotW = Math.max(40, w - labelW - valueW - 8);
  const x = (v: number) => labelW + (v / max) * plotW;
  if (!list.length) return <p className="text-sm text-gray-400 py-10 text-center">No missed customer calls in this range.</p>;
  return (
    <div ref={ref} className="w-full min-w-0 overflow-hidden">
      <svg viewBox={`0 0 ${w} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Missed customer calls by queue">
        {list.map((r, i) => {
          const yy = 6 + i * row;
          const total = r.handled + r.pending;
          const segs = [{ k: 'h', v: r.handled, c: 'var(--c-avail)' }, { k: 'p', v: r.pending, c: 'var(--c-break)' }].filter((s) => s.v > 0);
          const show = (cx: number, cy: number) => setTip({ x: cx, y: cy, title: r.q, rows: [
            { label: 'missed', value: num(total) },
            { label: 'called back', value: num(r.handled), color: 'var(--c-avail)' },
            { label: 'still pending', value: num(r.pending), color: 'var(--c-break)' },
          ] });
          let acc = 0;
          return (
            <g key={r.q}>
              <rect x={0} y={yy - 3} width={w} height={row} fill="transparent" className="kpi-mark" tabIndex={0}
                onPointerMove={(e) => show(e.clientX, e.clientY)} onPointerLeave={() => setTip(null)}
                onFocus={(e) => { const b = (e.target as SVGRectElement).getBoundingClientRect(); show(b.x + labelW, b.y + 10); }} onBlur={() => setTip(null)} />
              <text x={labelW - 10} y={yy + 8} dy="0.32em" textAnchor="end" fontSize="12" fill="var(--ink-2)" pointerEvents="none">
                {r.q.length > maxChars ? r.q.slice(0, maxChars - 1) + '…' : r.q}
              </text>
              {segs.map((s, j) => {
                const x0 = x(acc); acc += s.v; const x1 = x(acc);
                const wd = Math.max(2, x1 - x0);
                return j === segs.length - 1
                  ? <path key={s.k} d={barPath(x0, yy + 1, wd, 14)} fill={s.c} pointerEvents="none" />
                  : <rect key={s.k} x={x0} y={yy + 1} width={wd} height={14} fill={s.c} pointerEvents="none" />;
              })}
              <text x={x(total) + 6} y={yy + 8} dy="0.32em" fontSize="12" fontWeight={700} fill="var(--ink)" stroke="var(--surface)" strokeWidth={4} paintOrder="stroke" pointerEvents="none" style={{ fontVariantNumeric: 'tabular-nums' }}>{num(total)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

const MissedTab: React.FC<{ report: MissedReport | null; loading: boolean; error: string; unit: string; query: string; multiDay: boolean; today: string; setTip: (t: Tip) => void }> =
  ({ report, loading, error, unit, query, multiDay, today, setTip }) => {
  const [status, setStatus] = useState<'all' | 'pending' | 'handled'>('all');
  const [shown, setShown] = useState(150);
  if (error) return <div className="bg-rose-50 border border-rose-100 rounded-2xl px-5 py-4 text-sm font-bold text-rose-600">{error}</div>;
  if (!report) return <p className="text-center py-24 text-gray-400">Loading missed calls…</p>;
  const q = query.trim().toLowerCase();
  // The ledger is queue-level, so the department filter doesn't apply to it;
  // the search does (a customer number, a queue, or who called back).
  const calls = report.calls.filter((c) => !q || c.caller.includes(q) || c.queue.toLowerCase().includes(q) || (c.calledBackBy || '').toLowerCase().includes(q));
  const handled = calls.filter((c) => c.handled);
  const pending = calls.filter((c) => !c.handled);
  const now = Date.now();
  const oldPending = pending.filter((c) => now - c.missedTs > PENDING_OLD_MS).length;
  const waits = handled.map((c) => c.waitSec).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const median = waits.length ? waits[Math.floor(waits.length / 2)] : null;
  const outcomes = calls.flatMap((c) => c.callbacks).reduce((s, cb) => {
    const k = cb.outcome.toLowerCase();
    if (k === 'done') s.reached++; else if (k === 'busy') s.busy++; else if (/no\s*answer/.test(k)) s.noAnswer++;
    return s;
  }, { reached: 0, busy: 0, noAnswer: 0 });
  const agents = report.agents.filter((a) => (!unit || a.unit === unit) && (!q || a.name.toLowerCase().includes(q) || a.employeeCode.toLowerCase().includes(q)));
  const totalCallbacks = agents.reduce((s, a) => s + a.callbacks, 0);
  const visible = status === 'all' ? calls : status === 'pending' ? pending : handled;
  const queues = new Set(calls.map((c) => c.queue || 'No queue')).size;
  const sinceDay = report.oldestMissed ? ymd(new Date(report.oldestMissed)) : null;
  const partial = sinceDay !== null && report.from < sinceDay;
  const when = (ms: number) => format(new Date(ms), multiDay ? 'EEE d · HH:mm' : 'HH:mm');
  const age = (ms: number) => { const m = Math.round((now - ms) / 60000); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
  return (
    <div className={`space-y-8 transition-opacity ${loading ? 'opacity-50' : ''}`}>
      {partial && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-100 rounded-2xl text-sm text-amber-800">
          <PhoneMissed size={18} className="shrink-0 mt-0.5" />
          <p><span className="font-bold">Days before {format(new Date(sinceDay + 'T00:00:00'), 'MMM d')} are incomplete</span> — missed calls have been collected from XonTel since then; earlier days only show the calls that were called back.</p>
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-px bg-gray-100 rounded-[28px] overflow-hidden border border-gray-100">
        {[
          { label: 'Missed customer calls', value: num(calls.length), sub: `across ${queues} queue${queues !== 1 ? 's' : ''}` },
          { label: 'Called back', value: num(handled.length), sub: calls.length ? `${Math.round((handled.length / calls.length) * 100)}% of missed calls` : 'no missed calls' },
          { label: 'Still pending', value: num(pending.length), sub: oldPending ? `${num(oldPending)} waiting over an hour` : 'none waiting over an hour' },
          { label: 'Median wait', value: waitLabel(median), sub: 'from the missed call to the call-back' },
          { label: 'Reached the customer', value: num(outcomes.reached), sub: `${num(outcomes.busy)} busy · ${num(outcomes.noAnswer)} no answer` },
          { label: 'Agents calling back', value: num(agents.length), sub: `${num(totalCallbacks)} call-back${totalCallbacks !== 1 ? 's' : ''} in this range` },
        ].map((s) => (
          <div key={s.label} className="bg-white min-w-0 px-5 sm:px-6 py-5">
            <p className="text-sm font-semibold text-gray-500">{s.label}</p>
            <p className="text-[26px] sm:text-[34px] leading-tight font-black text-gray-900 tracking-tight mt-1">{s.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        <section className="xl:col-span-2 min-w-0 bg-white rounded-[28px] border border-gray-100 p-5 sm:p-6">
          <div className="mb-4">
            <h2 className="text-lg font-black text-gray-900">Missed calls by queue</h2>
            <p className="text-xs text-gray-400 mt-0.5 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--c-avail)' }} />Called back</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--c-break)' }} />Still pending</span>
            </p>
          </div>
          <QueueChart calls={calls} setTip={setTip} />
        </section>
        <section className="xl:col-span-3 min-w-0 bg-white rounded-[28px] border border-gray-100 overflow-hidden">
          <div className="px-6 pt-6 pb-4">
            <h2 className="text-lg font-black text-gray-900">Call-backs by agent</h2>
            <p className="text-xs text-gray-400 mt-0.5">{agents.length} agent{agents.length !== 1 ? 's' : ''} called customers back in this range · most first</p>
          </div>
          {agents.length === 0 ? (
            <p className="px-6 pb-10 pt-4 text-sm text-gray-400">{unit || q ? 'No agents match these filters.' : 'No call-backs logged on XonTel in this range.'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y border-gray-100 bg-gray-50/50">
                  <tr>
                    {['Agent', 'Call-backs', 'Reached', 'Busy', 'No answer', 'Avg wait'].map((h, i) => (
                      <th key={h} className={`px-3 py-3 font-bold text-xs text-gray-500 whitespace-nowrap ${i === 0 ? 'text-left pl-6' : 'text-right'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {agents.map((a) => (
                    <tr key={a.userId || `x:${a.name}`} className="hover:bg-gray-50/50">
                      <td className="px-3 py-3 pl-6">
                        <p className="font-bold text-gray-900 whitespace-nowrap">{a.name}</p>
                        <p className="text-xs text-gray-400 whitespace-nowrap">{a.linked ? [a.unit, a.employeeCode].filter(Boolean).join(' · ') : 'XonTel user · not linked to anyone in Swipr'}</p>
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap font-bold text-gray-900 tabular-nums">{num(a.callbacks)}</td>
                      <td className="px-3 py-3 text-right whitespace-nowrap text-emerald-700 font-bold tabular-nums">{num(a.reached)}</td>
                      <td className="px-3 py-3 text-right whitespace-nowrap text-gray-600 tabular-nums">{num(a.busy)}</td>
                      <td className="px-3 py-3 text-right whitespace-nowrap text-gray-600 tabular-nums">{num(a.noAnswer)}</td>
                      <td className="px-3 py-3 pr-6 text-right whitespace-nowrap text-gray-600 tabular-nums">{waitLabel(a.avgWaitSec)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="bg-white rounded-[28px] border border-gray-100 overflow-hidden">
        <div className="px-6 pt-6 pb-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-gray-900">Missed calls</h2>
            <p className="text-xs text-gray-400 mt-0.5">{visible.length} call{visible.length !== 1 ? 's' : ''} · newest first · every department, as XonTel lists them</p>
          </div>
          <div className="inline-flex p-1 bg-gray-100 rounded-2xl self-start">
            {([['all', `All · ${num(calls.length)}`], ['pending', `Pending · ${num(pending.length)}`], ['handled', `Called back · ${num(handled.length)}`]] as const).map(([k, l]) => (
              <button key={k} onClick={() => { setStatus(k); setShown(150); }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${status === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>{l}</button>
            ))}
          </div>
        </div>
        {visible.length === 0 ? (
          <p className="px-6 pb-10 pt-4 text-sm text-gray-400 flex items-center gap-2"><PhoneMissed size={16} className="text-gray-300" />{q ? 'No missed calls match the search.' : status === 'pending' ? 'Nothing pending — every missed call was called back.' : 'No missed customer calls in this range.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-gray-100 bg-gray-50/50">
                <tr>
                  {['Missed at', 'Customer', 'Queue', 'Status', 'Called back by', 'Wait', 'Outcome'].map((h, i) => (
                    <th key={h} className={`px-3 py-3 font-bold text-xs text-gray-500 whitespace-nowrap text-left ${i === 0 ? 'pl-6' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {visible.slice(0, shown).map((c) => {
                  const last = c.callbacks[c.callbacks.length - 1];
                  const stale = !c.handled && now - c.missedTs > PENDING_OLD_MS;
                  return (
                    <tr key={c.id} className="hover:bg-gray-50/50">
                      <td className="px-3 py-3 pl-6 whitespace-nowrap tabular-nums text-gray-700">{when(c.missedTs)}</td>
                      <td className="px-3 py-3 whitespace-nowrap font-bold text-gray-900 tabular-nums">{c.caller || '—'}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-gray-600">{c.queue || '—'}</td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {c.handled
                          ? <span className="inline-block px-2.5 py-1 rounded-lg text-xs font-bold border bg-emerald-50 text-emerald-700 border-emerald-100">Called back</span>
                          : <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-bold border ${stale ? 'bg-rose-50 text-rose-700 border-rose-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>
                              {/* XonTel leaves a call open after a failed try, with its status set to the outcome ("Busy"). */}
                              {c.status && c.status.toLowerCase() !== 'pending' ? `Still open · ${c.status}` : 'Pending'}{c.missedTs < now && report.to >= today ? ` · ${age(c.missedTs)}` : ''}
                            </span>}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {c.calledBackBy
                          ? <span className={last && !last.linked ? 'text-gray-500' : 'font-bold text-gray-900'} title={last && !last.linked ? 'XonTel user not linked to anyone in Swipr' : undefined}>{c.calledBackBy}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap tabular-nums text-gray-600">{waitLabel(c.waitSec)}</td>
                      <td className="px-3 py-3 pr-6 whitespace-nowrap">
                        {last
                          ? <span className={`font-bold ${outcomeStyle(last.outcome)}`}>{outcomeLabel(last.outcome)}{c.callbacks.length > 1 ? <span className="text-gray-400 font-normal"> · {c.callbacks.length} tries</span> : null}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {visible.length > shown && (
          <div className="px-6 py-3 border-t border-gray-100">
            <button onClick={() => setShown((n) => n + 150)} className="text-sm font-bold text-gray-700 hover:text-gray-900">Show {num(Math.min(150, visible.length - shown))} more of {num(visible.length - shown)} remaining</button>
          </div>
        )}
        <p className="px-6 py-4 border-t border-gray-100 text-xs text-gray-400 leading-relaxed">
          These are the customer calls XonTel's own Missed Calls page lists — abandoned in a queue before any agent answered — so this is the number that page shows, not the per-agent "Missed" on the Calls &amp; time tab. "Called back" is a call XonTel marks done once an agent is assigned to it; the outcome (reached, busy, no answer) is what that agent logged for each try. Refreshed every 5 minutes{report.lastSync ? `, last at ${format(new Date(report.lastSync), 'p')}` : ''}.
        </p>
      </section>
    </div>
  );
};

// The targets behind the amber flags, set by a lead; one set for everyone.
const TargetsModal: React.FC<{ targets: KpiTargets; onClose: () => void; onSave: (t: Partial<KpiTargets>) => Promise<void> }> = ({ targets, onClose, onSave }) => {
  const [aht, setAht] = useState(mmss(targets.ahtMaxSec));
  const [brk, setBrk] = useState(String(Math.round(targets.breakMaxSecPerDay / 60)));
  const [pickup, setPickup] = useState(String(targets.pickupMinPct));
  const [adhMin, setAdhMin] = useState(String(targets.adherenceMinPct));
  const [late, setLate] = useState(String(targets.lateLoginMaxMin));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const parseMmss = (v: string) => { const m = v.trim().match(/^(\d+):([0-5]?\d)$/); return m ? Number(m[1]) * 60 + Number(m[2]) : Number(v) * 60; };
  const save = async () => {
    setBusy(true); setError('');
    try {
      await onSave({ ahtMaxSec: Math.round(parseMmss(aht)), breakMaxSecPerDay: Math.round(Number(brk) * 60), pickupMinPct: Number(pickup), adherenceMinPct: Number(adhMin), lateLoginMaxMin: Number(late) });
    } catch (e: any) {
      const m = String(e?.message || '').match(/\{.*\}/s);
      let msg = 'Could not save the targets.';
      try { msg = (m && JSON.parse(m[0])?.error) || msg; } catch { /* keep default */ }
      setError(msg); setBusy(false);
    }
  };
  const field = (label: string, hint: string, value: string, set: (v: string) => void) => (
    <label className="block">
      <span className="text-sm font-bold text-gray-800">{label}</span>
      <span className="block text-xs text-gray-400 mb-1.5">{hint}</span>
      <input value={value} onChange={(e) => set(e.target.value)} className="w-32 px-3 py-2 rounded-xl bg-gray-50 border border-gray-100 font-bold text-sm text-gray-900 outline-none focus:ring-4 focus:ring-blue-500/10" />
    </label>
  );
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm" onClick={() => !busy && onClose()}>
      <div className="bg-white rounded-[32px] w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-7 pt-7 pb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-gray-900 tracking-tight">Targets</h2>
            <p className="text-xs text-gray-400 mt-1">Figures outside these are flagged in amber. One set for every department.</p>
          </div>
          <button onClick={() => !busy && onClose()} className="w-10 h-10 rounded-2xl flex items-center justify-center bg-gray-50 text-gray-500 hover:bg-gray-100 shrink-0"><X size={16} /></button>
        </div>
        <div className="px-7 pb-7 space-y-4">
          {field('Average handle time, at most', 'm:ss per answered incoming call', aht, setAht)}
          {field('Breaks per agent per day, at most', 'minutes', brk, setBrk)}
          {field('Pickup rate, at least', '% of incoming calls that rang the agent and were answered', pickup, setPickup)}
          {field('Shift adherence, at least', '% of the shift signed in to XonTel', adhMin, setAdhMin)}
          {field('Login late by, at most', 'minutes after the shift start', late, setLate)}
          {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
          <button onClick={save} disabled={busy}
            className="w-full py-3.5 rounded-2xl bg-gray-900 hover:bg-black text-white font-bold text-sm transition-colors disabled:opacity-50">
            {busy ? 'Saving…' : 'Save targets'}
          </button>
        </div>
      </div>
    </div>
  );
};

