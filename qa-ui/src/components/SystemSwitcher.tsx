import React from 'react';
import { CalendarDays, BadgeCheck } from 'lucide-react';

// Switch between Swipr and the Quality module. The SAME component lives in ../../../SystemSwitcher.tsx (Swipr)
// (the two apps are built separately) — keep the two files identical. It carries its own styles so it looks and sits
// exactly the same in both apps: first thing in each sidebar, 16px from the top-left, 222px wide.
// Each app remembers its last page in sessionStorage, so switching back returns to where the person was.
export type SystemKey = 'swipr' | 'quality';

const read = (key: string) => { try { return sessionStorage.getItem(key); } catch { return null; } };
export const rememberPage = (system: SystemKey, path: string) => {
  try { sessionStorage.setItem(system === 'swipr' ? 'swipr:lastPath' : 'qa:lastPath', path); } catch { /* storage blocked */ }
};

const CSS = `
.sys-switch{box-sizing:border-box;width:222px;display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;margin:0;
  border-radius:14px;background:#1e293b;border:1px solid rgba(255,255,255,.07);box-shadow:0 6px 20px -8px rgba(15,23,42,.55);
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;}
.sys-switch__item{box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:7px;height:36px;padding:0 8px;
  border:0;border-radius:10px;font-size:12.5px;font-weight:700;font-style:normal;letter-spacing:.01em;line-height:1;
  text-transform:none;text-decoration:none;white-space:nowrap;color:#94a3b8;background:transparent;
  transition:background-color .2s ease,color .2s ease,box-shadow .2s ease;}
a.sys-switch__item:hover{color:#f1f5f9;background:rgba(255,255,255,.07);}
a.sys-switch__item:focus-visible{outline:2px solid #93c5fd;outline-offset:1px;}
.sys-switch__item.is-active{color:#fff;cursor:default;}
.sys-switch__item.is-active.is-swipr{background:#2563eb;box-shadow:0 6px 16px -6px rgba(37,99,235,.75);}
.sys-switch__item.is-active.is-quality{background:#4f46e5;box-shadow:0 6px 16px -6px rgba(79,70,229,.75);}
.sys-switch__item svg{flex:none;}
`;

// Plays the switch animation (public/system-warp.js, loaded in both apps' <head>) before leaving. A plain link
// still works if the script is missing, and ctrl/cmd/shift/middle-click keep their normal browser meaning.
const warp = (to: SystemKey, href: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
  const w = (window as any).__sysWarp;
  if (!w || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  const b = e.currentTarget.getBoundingClientRect();
  w.go(to, href, b.left + b.width / 2, b.top + b.height / 2);
};

export const SystemSwitcher: React.FC<{ current: SystemKey }> = ({ current }) => {
  const items: { key: SystemKey; label: string; icon: React.ReactNode; href: string }[] = [
    { key: 'swipr', label: 'Swipr', icon: <CalendarDays size={16} strokeWidth={2.2} />, href: '/#' + (read('swipr:lastPath') || '/') },
    { key: 'quality', label: 'Quality', icon: <BadgeCheck size={16} strokeWidth={2.2} />, href: read('qa:lastPath') || '/qa/' },
  ];
  return (
    <nav className="sys-switch" aria-label="Switch system">
      <style>{CSS}</style>
      {items.map(it => it.key === current
        ? <span key={it.key} className={`sys-switch__item is-active is-${it.key}`} aria-current="page">{it.icon}{it.label}</span>
        : <a key={it.key} className={`sys-switch__item is-${it.key}`} href={it.href} title={`Open ${it.label}`} onClick={warp(it.key, it.href)}>{it.icon}{it.label}</a>)}
    </nav>
  );
};

export default SystemSwitcher;
