/*
 * Swipr <-> Quality "warp" transition.
 *
 * Loaded render-blocking in the <head> of BOTH apps (Swipr serves it at /system-warp.js and the Quality app's
 * index.html links the same URL), so there is a single copy of it.
 *
 *   leaving  — window.__sysWarp.go(to, href, x, y) (called by the system switcher): a disc in the colours of the
 *              system you are going to bursts out of the button you pressed, light streaks rush past and the
 *              destination's badge assembles in the middle — then the browser navigates.
 *   arriving — this script runs before the new page paints, sees the hand-off in sessionStorage and puts the same
 *              portal on screen at once (no white flash). When the app's sidebar is up, the portal collapses into
 *              the switcher button and the button pings once.
 *
 * Smoothness: every moving part animates ONLY transform and opacity on its own layer, so the browser's compositor
 * (GPU) runs it at full frame rate even while the page underneath is still loading and the main thread is busy.
 * No clip-path, filter, letter-spacing or page-wide animations — those are drawn on the main thread and stutter.
 *
 * Plain JS on purpose: it must run before React, identically in two separately built apps.
 */
(function () {
  if (window.__sysWarp) return;
  var KEY = 'sys:warp';
  var MAX_AGE = 15000;                 // a hand-off older than this is stale (closed tab, back button, ...)
  var DISC = 200;                      // css px; the disc is drawn this size and scaled up on the GPU
  var SYSTEMS = {
    swipr: {
      name: 'SWIPR', tag: 'Staff Scheduling',
      c1: '#2563eb', c2: '#0a1a4a', c3: '#38bdf8',
      icon: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/>',
    },
    quality: {
      name: 'QUALITY', tag: 'Quality Assurance',
      c1: '#6d28d9', c2: '#1d1047', c3: '#c084fc',
      icon: '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>',
    },
  };
  var reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* old browser */ }
  var here = location.pathname.indexOf('/qa') === 0 ? 'quality' : 'swipr';

  var CSS = '' +
    '.sw-warp{position:fixed;inset:0;z-index:2147483647;overflow:hidden;pointer-events:all;cursor:progress;contain:strict;' +
    'font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased;}' +
    '.sw-warp *{box-sizing:border-box;}' +
    '.sw-warp__layer{position:absolute;inset:0;will-change:opacity;}' +
    '.sw-warp__disc{position:absolute;width:' + DISC + 'px;height:' + DISC + 'px;border-radius:50%;will-change:transform;' +
    'background:radial-gradient(circle,var(--c1) 0%,var(--c2) 70%);box-shadow:0 0 40px var(--c3);}' +
    '.sw-warp__bg{background:radial-gradient(120% 120% at 50% 50%,var(--c1) 0%,var(--c2) 50%,#03040c 100%);}' +
    // streaks: outer element spins, inner one rushes outward — two elements so each keyframe owns one transform
    '.sw-warp__spin{position:absolute;left:50%;top:50%;width:110vmax;height:110vmax;margin:-55vmax 0 0 -55vmax;will-change:transform;' +
    'animation:sw-spin 10s linear infinite;}' +
    '.sw-warp__spin.b{animation-duration:14s;animation-direction:reverse;}' +
    '.sw-warp__streaks{position:absolute;inset:0;will-change:transform,opacity;' +
    'background:repeating-conic-gradient(from 0deg,transparent 0deg 3.2deg,rgba(255,255,255,.45) 3.2deg 3.5deg,transparent 3.5deg 7.5deg);' +
    '-webkit-mask:radial-gradient(circle,transparent 0 7%,#000 22%,rgba(0,0,0,.4) 45%,transparent 70%);' +
    'mask:radial-gradient(circle,transparent 0 7%,#000 22%,rgba(0,0,0,.4) 45%,transparent 70%);' +
    'animation:sw-zoom 1.1s cubic-bezier(.45,0,.9,.6) infinite;}' +
    '.sw-warp__spin.b .sw-warp__streaks{animation-delay:-.55s;}' +
    '.sw-warp__ring{position:absolute;left:50%;top:50%;width:220px;height:220px;margin:-110px 0 0 -110px;border-radius:50%;' +
    'border:2px solid rgba(255,255,255,.6);box-shadow:0 0 26px var(--c3),inset 0 0 26px var(--c3);opacity:0;will-change:transform,opacity;' +
    'animation:sw-ring 1.6s cubic-bezier(.2,.6,.3,1) infinite;}' +
    '.sw-warp__ring.r2{animation-delay:.53s}.sw-warp__ring.r3{animation-delay:1.06s}' +
    '.sw-warp__glow{position:absolute;left:50%;top:50%;width:70vmin;height:70vmin;margin:-35vmin 0 0 -35vmin;border-radius:50%;' +
    'background:radial-gradient(circle,var(--c3) 0%,transparent 62%);opacity:.45;will-change:transform,opacity;animation:sw-breathe 1.4s ease-in-out infinite;}' +
    '.sw-warp__core{position:absolute;left:50%;top:50%;width:420px;height:300px;margin:-150px 0 0 -210px;' +
    'display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:#fff;will-change:transform,opacity;}' +
    '.sw-warp__badge{width:104px;height:104px;border-radius:30px;display:flex;align-items:center;justify-content:center;will-change:transform;' +
    'background:linear-gradient(140deg,var(--c3),var(--c1) 55%,var(--c2));border:1px solid rgba(255,255,255,.35);' +
    'box-shadow:0 0 0 10px rgba(255,255,255,.06),0 0 60px var(--c3),0 0 140px var(--c1),inset 0 1px 0 rgba(255,255,255,.5);' +
    'animation:sw-float 2.4s ease-in-out infinite;}' +
    '.sw-warp__badge svg{width:52px;height:52px;}' +
    '.sw-warp__name{margin-top:26px;font-size:46px;line-height:1;font-weight:900;letter-spacing:.3em;padding-left:.3em;white-space:nowrap;' +
    'text-shadow:0 0 24px var(--c3),0 0 60px var(--c1);will-change:transform,opacity;}' +
    '.sw-warp__tag{margin-top:12px;font-size:12px;font-weight:700;letter-spacing:.5em;padding-left:.5em;text-transform:uppercase;opacity:.75;}' +
    '.sw-warp__bar{margin-top:26px;width:180px;height:3px;border-radius:3px;background:rgba(255,255,255,.14);overflow:hidden;}' +
    '.sw-warp__bar span{display:block;height:100%;width:40%;border-radius:3px;background:linear-gradient(90deg,transparent,#fff,transparent);' +
    'will-change:transform;animation:sw-load .9s ease-in-out infinite;}' +
    '.sw-warp__flash{background:radial-gradient(circle at 50% 50%,#fff 0%,rgba(255,255,255,.55) 18%,transparent 55%);opacity:0;pointer-events:none;}' +
    '@keyframes sw-spin{to{transform:rotate(360deg)}}' +
    '@keyframes sw-zoom{0%{transform:scale(.5);opacity:0}25%{opacity:1}100%{transform:scale(2.6);opacity:0}}' +
    '@keyframes sw-ring{0%{transform:scale(.25);opacity:0}20%{opacity:.9}100%{transform:scale(5.5);opacity:0}}' +
    '@keyframes sw-breathe{50%{opacity:.7;transform:scale(1.08)}}' +
    '@keyframes sw-float{50%{transform:translateY(-6px) rotate(-1.5deg)}}' +
    '@keyframes sw-load{0%{transform:translateX(-120%)}100%{transform:translateX(300%)}}' +
    '@keyframes sw-ping{0%{box-shadow:0 0 0 0 var(--ping),0 0 0 0 var(--ping)}100%{box-shadow:0 0 0 18px transparent,0 0 0 34px transparent}}' +
    '.sys-switch__item.sw-ping{animation:sw-ping .9s cubic-bezier(.2,.6,.3,1) 2;}' +
    '.sys-switch__item.is-swipr.sw-ping{--ping:rgba(56,189,248,.75)}.sys-switch__item.is-quality.sw-ping{--ping:rgba(192,132,252,.75)}';

  function addCss() {
    if (document.getElementById('sw-warp-css')) return;
    var s = document.createElement('style');
    s.id = 'sw-warp-css';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function build(to) {
    var sys = SYSTEMS[to];
    var el = document.createElement('div');
    el.className = 'sw-warp';
    el.setAttribute('aria-hidden', 'true');
    el.style.setProperty('--c1', sys.c1);
    el.style.setProperty('--c2', sys.c2);
    el.style.setProperty('--c3', sys.c3);
    el.innerHTML =
      '<div class="sw-warp__disc"></div>' +
      '<div class="sw-warp__layer sw-warp__scene">' +
        '<div class="sw-warp__layer sw-warp__bg"></div>' +
        '<div class="sw-warp__glow"></div>' +
        '<div class="sw-warp__spin"><div class="sw-warp__streaks"></div></div>' +
        '<div class="sw-warp__spin b"><div class="sw-warp__streaks"></div></div>' +
        '<div class="sw-warp__ring"></div><div class="sw-warp__ring r2"></div><div class="sw-warp__ring r3"></div>' +
      '</div>' +
      '<div class="sw-warp__core">' +
        '<div class="sw-warp__badge"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + sys.icon + '</svg></div>' +
        '<div class="sw-warp__name">' + sys.name + '</div>' +
        '<div class="sw-warp__tag">' + sys.tag + '</div>' +
        '<div class="sw-warp__bar"><span></span></div>' +
      '</div>' +
      '<div class="sw-warp__layer sw-warp__flash"></div>';
    return el;
  }

  // centre the disc on (x, y) and return the scale at which it covers the whole screen
  function placeDisc(disc, x, y) {
    disc.style.left = (x - DISC / 2) + 'px';
    disc.style.top = (y - DISC / 2) + 'px';
    var w = window.innerWidth, h = window.innerHeight;
    var dx = Math.max(x, w - x), dy = Math.max(y, h - y);
    return (Math.sqrt(dx * dx + dy * dy) + 60) / (DISC / 2);
  }
  function anim(el, frames, opts) {
    try { return el && el.animate ? el.animate(frames, opts) : null; } catch (e) { return null; }
  }
  var Q = function (el, sel) { return el.querySelector(sel); };

  // ---------------------------------------------------------------- leaving
  var leaving = false;
  // Undo a leave whose navigation never happened (Esc / Stop / Back while the next page was loading, a slow server):
  // without this the portal would stay on screen and swallow every click.
  var pending = [];                    // timers of the current leave
  function onEsc(e) { if (e.key === 'Escape') teardown(); }
  function teardown() {
    leaving = false;
    pending.forEach(clearTimeout);
    pending = [];
    window.removeEventListener('keydown', onEsc);
    window.removeEventListener('popstate', teardown);
    window.removeEventListener('hashchange', teardown);
    var els = document.querySelectorAll('.sw-warp');
    for (var i = 0; i < els.length; i++) els[i].parentNode.removeChild(els[i]);
    try { sessionStorage.removeItem(KEY); } catch (e) { /* storage blocked */ }
  }
  function navigate(href) {
    location.href = href;
    window.addEventListener('popstate', teardown);
    window.addEventListener('hashchange', teardown);
    // still here long after asking for the other page: the navigation was cancelled or is hanging
    pending.push(setTimeout(function () { if (document.visibilityState === 'visible') teardown(); }, 9000));
  }
  function go(to, href, x, y) {
    if (!SYSTEMS[to]) { location.href = href; return; }
    if (leaving) return;
    leaving = true;
    window.addEventListener('keydown', onEsc);        // Esc at any point backs out of the switch
    try { sessionStorage.setItem(KEY, JSON.stringify({ to: to, ts: Date.now() })); } catch (e) { /* storage blocked: arrive without the intro */ }
    if (reduce || !document.body) { navigate(href); return; }
    addCss();
    if (typeof x !== 'number' || typeof y !== 'number') { x = window.innerWidth / 2; y = window.innerHeight / 2; }
    var el = build(to);
    var disc = Q(el, '.sw-warp__disc'), scene = Q(el, '.sw-warp__scene'), core = Q(el, '.sw-warp__core');
    var s = placeDisc(disc, x, y);
    scene.style.opacity = '0';
    core.style.opacity = '0';
    document.body.appendChild(el);

    var ease = 'cubic-bezier(.65,0,.2,1)';
    anim(disc, [{ transform: 'scale(0.02)' }, { transform: 'scale(' + (s * 0.16) + ')', offset: 0.25 }, { transform: 'scale(' + s + ')' }],
      { duration: 640, easing: ease, fill: 'forwards' });
    anim(scene, [{ opacity: 0 }, { opacity: 1 }], { duration: 380, delay: 260, easing: 'ease-out', fill: 'forwards' });
    anim(core, [
      { transform: 'scale(.3) rotate(-14deg)', opacity: 0 },
      { transform: 'scale(1.06) rotate(1deg)', opacity: 1, offset: 0.7 },
      { transform: 'scale(1) rotate(0)', opacity: 1 },
    ], { duration: 560, delay: 300, easing: 'cubic-bezier(.2,.9,.25,1)', fill: 'forwards' });
    anim(Q(el, '.sw-warp__name'), [{ transform: 'scaleX(1.7)', opacity: 0 }, { transform: 'scaleX(1)', opacity: 1 }],
      { duration: 520, delay: 380, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    anim(Q(el, '.sw-warp__flash'), [{ opacity: 0 }, { opacity: 0.5, offset: 0.5 }, { opacity: 0 }],
      { duration: 500, delay: 520, easing: 'ease-out', fill: 'forwards' });

    pending.push(setTimeout(function () { navigate(href); }, 900));
  }

  // ---------------------------------------------------------------- arriving
  function arrive() {
    var hand = null;
    try { hand = JSON.parse(sessionStorage.getItem(KEY) || 'null'); sessionStorage.removeItem(KEY); } catch (e) { hand = null; }
    if (!hand || hand.to !== here || !SYSTEMS[here] || Date.now() - hand.ts > MAX_AGE || reduce) return;
    play(650);
  }

  // the arriving half; minHold = how long the portal stays up at least (ms)
  function play(minHold) {
    addCss();
    var el = build(here);
    Q(el, '.sw-warp__disc').style.opacity = '0';
    // the page has no <body> yet: the overlay goes straight under <html> so it is on the very first frame
    document.documentElement.appendChild(el);
    var t0 = Date.now();
    var settledAt = 0;

    function target() {
      var a = document.querySelector('.sys-switch__item.is-active');
      if (a) {
        var b = a.getBoundingClientRect();
        if (b.width > 0 && b.right > 0 && b.left < window.innerWidth && b.bottom > 0 && b.top < window.innerHeight) {
          return { x: b.left + b.width / 2, y: b.top + b.height / 2, el: a };
        }
      }
      return { x: window.innerWidth / 2, y: window.innerHeight / 2, el: null };
    }

    function ready() {
      var age = Date.now() - t0;
      if (age > 6000) return true;
      if (age < minHold) return false;                                // let the portal be seen
      if (document.querySelector('.sys-switch')) {
        // give the app's first render burst a moment to finish so the collapse runs on a quiet page
        if (!settledAt) settledAt = Date.now();
        return Date.now() - settledAt > 150;
      }
      var root = document.getElementById('root');
      return !!(root && root.childElementCount > 0 && age > 1800);
    }

    var revealed = false;
    function reveal() {
      if (revealed) return;
      revealed = true;
      var p = target();
      var disc = Q(el, '.sw-warp__disc'), scene = Q(el, '.sw-warp__scene'), core = Q(el, '.sw-warp__core');
      var s = placeDisc(disc, p.x, p.y);
      disc.style.transform = 'scale(' + s + ')';
      disc.style.opacity = '1';
      anim(Q(el, '.sw-warp__flash'), [{ opacity: 0 }, { opacity: 0.8, offset: 0.35 }, { opacity: 0 }], { duration: 420, easing: 'ease-out', fill: 'forwards' });
      anim(core, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.5)', opacity: 0 }],
        { duration: 400, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' });
      anim(scene, [{ opacity: 1 }, { opacity: 0 }], { duration: 360, delay: 120, easing: 'ease-in', fill: 'forwards' });
      var close = anim(disc, [{ transform: 'scale(' + s + ')' }, { transform: 'scale(' + (s * 0.1) + ')', offset: 0.8 }, { transform: 'scale(0.02)' }],
        { duration: 820, delay: 160, easing: 'cubic-bezier(.75,0,.25,1)', fill: 'forwards' });

      var finished = false;
      var done = function () {
        if (finished) return;
        finished = true;
        if (el.parentNode) el.parentNode.removeChild(el);
        if (p.el) {
          p.el.classList.remove('sw-ping');
          void p.el.offsetWidth;
          p.el.classList.add('sw-ping');
          setTimeout(function () { p.el.classList.remove('sw-ping'); }, 2000);
        }
      };
      if (close) close.onfinish = done;
      setTimeout(done, 1300);
    }

    (function wait() {
      // a timer, not requestAnimationFrame: rAF is paused while the tab is hidden and the portal would wait for it
      if (ready()) { setTimeout(reveal, 40); return; }
      setTimeout(wait, 60);
    })();
  }

  // Back/forward can restore the old page from the browser cache with the leaving portal still on it.
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) teardown();
  });

  // go: used by the switcher. preview: replay the arriving half on the current page (for checking the look).
  window.__sysWarp = { go: go, preview: function (ms) { play(ms || 3000); } };
  arrive();
})();
