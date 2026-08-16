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

  const HOLD_MS = 1600;   // pause on the final position before looping
  const STEP_MS = 520;    // one half-turn

  const css = (n, fb) =>
    getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb;

  function draw(cv, data, idx) {
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
    const URA = css('--uranium', '#5fd95f'), GOLD = css('--gold', '#d4af37');
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

    // the nuke that ends the match: a wash over the board on the last frame
    const nuked = (f.events || []).some((e) => e.by === 'nuke');
    if (nuked) {
      g.fillStyle = 'rgba(255,255,255,.14)';
      g.fillRect(0, 0, w, h);
    }
  }

  function mount(host, data) {
    const winner = data.players.find((p) => p.slot === data.winner);
    const p0 = data.players.find((p) => p.slot === 0) || {};
    const p1 = data.players.find((p) => p.slot === 1) || {};
    const nameOf = (p) => (p.name || '—');
    const mark = (p) =>
      data.winner === p.slot ? '<span class="ft-win">▲</span>' : '';
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
      const render = () => draw(cv, data, last);
      render();
      window.addEventListener('resize', render);
      return;
    }

    let i = 0, timer = null, running = false;
    const tick = () => {
      draw(cv, data, i);
      const wait = i === last ? HOLD_MS : STEP_MS;
      i = i === last ? 0 : i + 1;
      timer = setTimeout(tick, wait);
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
