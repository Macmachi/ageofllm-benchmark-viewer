/* featured.js — the animated "latest match" card on the standing.
 *
 * Draws the closing half-turns of the most recent match as a flat minimap and
 * loops them. Deliberately sprite-free: the viewer's isometric renderer needs
 * 836 KB across 78 sprite files, which is not a price a landing page should pay
 * for a decoration. Flat cells and dots read fine at this size, and the card
 * links to the real viewer for anyone who wants the actual thing.
 *
 * Data: data/featured.json, written by scripts/build_featured.py (~11 KB — the
 * matching replay is 1.5 MB, four fifths of it reasoning text).
 */
(function () {
  'use strict';

  const HOLD_MS = 1900;   // pause on the final position before looping
  const STEP_MS = 780;    // one half-turn — slow enough to follow the arrows
  const BLAST_MS = 1250;  // the detonation, animated frame by frame

  const css = (n, fb) =>
    getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb;

  function draw(cv, data, idx, blast) {
    const [gw, gh] = data.grid || [13, 7];
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || 480;
    const cell = w / gw;
    const h = cell * gh;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.height = h + 'px';
    }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const P0 = css('--p0', '#4da6ff'), P1 = css('--p1', '#ff5d6c');
    const own = (o) => (o === 0 ? P0 : P1);

    // ground
    g.fillStyle = css('--bg-2', '#0f141c');
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.035)';
    g.lineWidth = 1;
    for (let x = 1; x < gw; x++) {
      g.beginPath(); g.moveTo(x * cell, 0); g.lineTo(x * cell, h); g.stroke();
    }
    for (let y = 1; y < gh; y++) {
      g.beginPath(); g.moveTo(0, y * cell); g.lineTo(w, y * cell); g.stroke();
    }

    const t = data.terrain || {};
    const box = (x, y, inset, fill) => {
      g.fillStyle = fill;
      g.fillRect(x * cell + inset, y * cell + inset, cell - inset * 2, cell - inset * 2);
    };
    for (const [x, y] of t.mountains || []) box(x, y, 0.5, 'rgba(255,255,255,.13)');
    for (const [x, y] of t.passages || []) box(x, y, cell * 0.32, 'rgba(255,255,255,.07)');

    const dep = t.deposits || {};
    const dot = (x, y, r, fill) => {
      g.beginPath();
      g.arc((x + 0.5) * cell, (y + 0.5) * cell, r, 0, Math.PI * 2);
      g.fillStyle = fill; g.fill();
    };
    for (const [x, y] of dep.credits || []) dot(x, y, cell * 0.12, 'rgba(212,175,55,.55)');
    for (const [x, y] of (dep.uranium || []).concat(dep.uranium_central || []))
      dot(x, y, cell * 0.12, 'rgba(95,217,95,.55)');

    const f = data.frames[idx];
    if (!f) return;

    for (const b of f.buildings || []) {
      const [x, y] = b.pos;
      const isBase = b.type === 'base';
      const dead = b.hp <= 0;
      const inset = isBase ? cell * 0.14 : cell * 0.26;
      g.globalAlpha = dead ? 0.25 : 1;
      box(x, y, inset, own(b.owner));
      if (isBase && !dead) {
        g.globalAlpha = 1;
        g.strokeStyle = 'rgba(255,255,255,.55)';
        g.lineWidth = 1.5;
        g.strokeRect(x * cell + inset, y * cell + inset, cell - inset * 2, cell - inset * 2);
      }
      g.globalAlpha = 1;
    }

    // Moves made since the previous half-turn, matched by unit id. Drawn under
    // the units so the dots stay readable on top of their own trail.
    const prev = data.frames[idx - 1];
    if (prev) {
      const was = new Map((prev.units || []).map((u) => [u.id, u.pos]));
      for (const u of f.units || []) {
        const from = was.get(u.id);
        if (!from || (from[0] === u.pos[0] && from[1] === u.pos[1])) continue;
        arrow(g, cell, from, u.pos, own(u.owner));
      }
    }

    for (const u of f.units || []) {
      const [x, y] = u.pos;
      const air = u.type === 'drone' || u.type === 'fighter';
      dot(x, y, cell * (air ? 0.17 : 0.21), own(u.owner));
      if (air) {                       // ring = it flies
        g.beginPath();
        g.arc((x + 0.5) * cell, (y + 0.5) * cell, cell * 0.27, 0, Math.PI * 2);
        g.strokeStyle = own(u.owner); g.lineWidth = 1; g.globalAlpha = 0.5;
        g.stroke(); g.globalAlpha = 1;
      }
    }

    // The nuke that ends the match, seen from above, centred on the base it
    // destroyed. `blast` runs 0 -> 1; null means no detonation on this frame.
    if (blast !== null && blast !== undefined) {
      const at = nukeCell(data, idx);
      if (at) drawBlast(g, w, h, cell, at, blast);
    }
  }

  // One move, cell centre to cell centre. Stops short of the destination so the
  // head does not disappear under the unit's own dot.
  function arrow(g, cell, from, to, color) {
    const x0 = (from[0] + 0.5) * cell, y0 = (from[1] + 0.5) * cell;
    const x1 = (to[0] + 0.5) * cell, y1 = (to[1] + 0.5) * cell;
    const a = Math.atan2(y1 - y0, x1 - x0);
    const gap = cell * 0.3;
    const ex = x1 - Math.cos(a) * gap, ey = y1 - Math.sin(a) * gap;

    g.globalAlpha = 0.55;
    g.strokeStyle = color;
    g.lineWidth = Math.max(1, cell * 0.055);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x0 + Math.cos(a) * gap * 0.7, y0 + Math.sin(a) * gap * 0.7);
    g.lineTo(ex, ey);
    g.stroke();

    const head = cell * 0.2, spread = 0.42;
    g.beginPath();
    g.moveTo(ex, ey);
    g.lineTo(ex - Math.cos(a - spread) * head, ey - Math.sin(a - spread) * head);
    g.lineTo(ex - Math.cos(a + spread) * head, ey - Math.sin(a + spread) * head);
    g.closePath();
    g.fillStyle = color;
    g.fill();
    g.globalAlpha = 1;
  }

  // Where the bomb landed: the base of the player the nuke event names.
  function nukeCell(data, idx) {
    const f = data.frames[idx];
    const ev = (f.events || []).find((e) => e.by === 'nuke');
    if (!ev) return null;
    const base = (f.buildings || []).find(
      (b) => b.type === 'base' && b.owner === ev.owner);
    return base ? base.pos : null;
  }

  function drawBlast(g, w, h, cell, [bx, by], p) {
    const cx = (bx + 0.5) * cell, cy = (by + 0.5) * cell;
    const ease = 1 - Math.pow(1 - p, 3);          // fast out, slow settle
    const fade = Math.max(0, 1 - p);

    // crater: stays for the whole hold, so a still frame still reads as a hit
    g.beginPath();
    g.arc(cx, cy, cell * 1.15, 0, Math.PI * 2);
    g.fillStyle = 'rgba(0,0,0,.55)';
    g.fill();

    // shockwave, two rings offset in time
    for (const [delay, width] of [[0, 2.5], [0.18, 1.2]]) {
      const q = (p - delay) / (1 - delay);
      if (q <= 0) continue;
      const qe = 1 - Math.pow(1 - Math.min(1, q), 2);
      g.beginPath();
      g.arc(cx, cy, cell * 0.6 + qe * cell * 5.5, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(255,214,150,' + (0.55 * (1 - qe)).toFixed(3) + ')';
      g.lineWidth = width;
      g.stroke();
    }

    // fireball: white core bleeding to orange, collapsing as it fades
    const r = cell * (0.35 + ease * 2.1);
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, 'rgba(255,255,245,' + (0.95 * fade).toFixed(3) + ')');
    grad.addColorStop(0.35, 'rgba(255,196,92,' + (0.75 * fade).toFixed(3) + ')');
    grad.addColorStop(0.7, 'rgba(226,106,32,' + (0.4 * fade).toFixed(3) + ')');
    grad.addColorStop(1, 'rgba(226,106,32,0)');
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fillStyle = grad;
    g.fill();

    // whole-board flash, front-loaded
    const flash = Math.max(0, 0.42 - p * 0.85);
    if (flash > 0) {
      g.fillStyle = 'rgba(255,255,255,' + flash.toFixed(3) + ')';
      g.fillRect(0, 0, w, h);
    }
  }

  function mount(host, data) {
    const winner = data.players.find((p) => p.slot === data.winner);
    const p0 = data.players.find((p) => p.slot === 0) || {};
    const p1 = data.players.find((p) => p.slot === 1) || {};
    const nameOf = (p) => (p.name || '—');
    // A draw (winner -1) marks neither side: a crown with no skull opposite
    // would read as a win that never happened.
    const mark = (p) => {
      if (data.winner === -1 || data.winner === undefined) return '';
      const won = data.winner === p.slot;
      return '<span class="ft-mark" title="' + (won ? 'Winner' : 'Defeated') +
        '">' + (won ? '👑' : '💀') + '</span>';
    };
    const vt = (data.victory_type || '').replace(/_/g, ' ');
    const when = (data.date || '').slice(0, 10);

    host.innerHTML =
      '<div class="ft-head">' +
        '<span class="ft-kicker">Latest match</span>' +
        '<span class="ft-meta">' + (vt ? '☢ ' : '') + vt +
          ' · ' + (data.total_turns || '?') + ' turns · ' + when + '</span>' +
      '</div>' +
      '<div class="ft-players">' +
        '<span class="ft-p ft-p0">' + mark(p0) + nameOf(p0) + '</span>' +
        '<span class="ft-vs">vs</span>' +
        '<span class="ft-p ft-p1">' + nameOf(p1) + mark(p1) + '</span>' +
      '</div>' +
      '<canvas class="ft-canvas"></canvas>' +
      '<a class="ft-cta" href="viewer.html?match=' +
        encodeURIComponent(data.match_id) + '">▶ Watch the replay</a>';

    const cv = host.querySelector('.ft-canvas');
    const still = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const last = data.frames.length - 1;

    if (still || data.frames.length < 2) {     // no motion: show the finish
      const render = () => draw(cv, data, last, nukeCell(data, last) ? 1 : undefined);
      render();
      window.addEventListener('resize', render);
      return;
    }

    const raf = (fn) => (window.requestAnimationFrame
      ? window.requestAnimationFrame(fn) : setTimeout(fn, 16));
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

    let i = 0, timer = null, running = false;
    const tick = () => {
      const isLast = i === last;
      if (isLast && nukeCell(data, i)) { detonate(); return; }
      draw(cv, data, i);
      const wait = isLast ? HOLD_MS : STEP_MS;
      i = isLast ? 0 : i + 1;
      timer = setTimeout(tick, wait);
    };
    // The detonation is the one moment worth animating between half-turns.
    const detonate = () => {
      const t0 = now();
      const frame = () => {
        if (!running) return;
        const p = Math.min(1, (now() - t0) / BLAST_MS);
        draw(cv, data, last, p);
        if (p < 1) raf(frame);
        else { i = 0; timer = setTimeout(tick, HOLD_MS); }
      };
      frame();
    };
    const start = () => { if (!running) { running = true; tick(); } };
    const stop = () => { running = false; clearTimeout(timer); timer = null; };

    start();
    window.addEventListener('resize', () => draw(cv, data, i));
    // A canvas loop in a hidden tab is pure waste; browsers throttle it, they
    // do not cancel it.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop(); else start();
    });
  }

  function init() {
    const host = document.getElementById('featured-match');
    if (!host) return;
    fetch('data/featured.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        // No teaser yet (fresh install, or no finished match): leave the page
        // exactly as it was rather than showing an empty frame.
        if (!d || !Array.isArray(d.frames) || !d.frames.length) return;
        host.hidden = false;
        mount(host, d);
      })
      .catch(() => {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
