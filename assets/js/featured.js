/*! Age of LLM · Copyright (C) 2026 Rymentz · AGPL-3.0-or-later · https://ageofllm.org */
(function() {
  "use strict";
  const HOLD_MS = 1900;
  const STEP_MS = 780;
  const BLAST_MS = 1250;
  const css = (n, fb) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb;
  function draw(cv, data, idx, blast) {
    const [gw, gh] = data.grid || [13, 7];
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || 480;
    const cell = w / gw;
    const h = cell * gh;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.height = h + "px";
    }
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalAlpha = 1;
    g.lineCap = "butt";
    g.lineJoin = "miter";
    g.clearRect(0, 0, w, h);
    const P0 = css("--p0", "#4da6ff"), P1 = css("--p1", "#ff5d6c");
    const own = (o) => o === 0 ? P0 : P1;
    g.fillStyle = css("--bg-2", "#0f141c");
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(255,255,255,.035)";
    g.lineWidth = 1;
    for (let x = 1; x < gw; x++) {
      g.beginPath();
      g.moveTo(x * cell, 0);
      g.lineTo(x * cell, h);
      g.stroke();
    }
    for (let y = 1; y < gh; y++) {
      g.beginPath();
      g.moveTo(0, y * cell);
      g.lineTo(w, y * cell);
      g.stroke();
    }
    const t = data.terrain || {};
    const box = (x, y, inset, fill) => {
      g.fillStyle = fill;
      g.fillRect(x * cell + inset, y * cell + inset, cell - inset * 2, cell - inset * 2);
    };
    for (const [x, y] of t.mountains || []) box(x, y, 0.5, "rgba(255,255,255,.13)");
    for (const [x, y] of t.passages || []) box(x, y, cell * 0.32, "rgba(255,255,255,.07)");
    const dep = t.deposits || {};
    const dot = (x, y, r, fill) => {
      g.beginPath();
      g.arc((x + 0.5) * cell, (y + 0.5) * cell, r, 0, Math.PI * 2);
      g.fillStyle = fill;
      g.fill();
    };
    for (const [x, y] of dep.credits || []) dot(x, y, cell * 0.12, "rgba(212,175,55,.55)");
    for (const [x, y] of (dep.uranium || []).concat(dep.uranium_central || []))
      dot(x, y, cell * 0.12, "rgba(95,217,95,.55)");
    const f = data.frames[idx];
    if (!f) return;
    for (const b of f.buildings || []) {
      const [x, y] = b.pos;
      g.globalAlpha = b.hp <= 0 ? 0.22 : 1;
      buildingGlyph(g, cell, (x + 0.5) * cell, (y + 0.5) * cell, b.type, own(b.owner));
      g.globalAlpha = 1;
    }
    const prev = data.frames[idx - 1];
    if (prev) {
      const was = new Map((prev.units || []).map((u) => [u.id, u.pos]));
      for (const u of f.units || []) {
        const from = was.get(u.id);
        if (!from || from[0] === u.pos[0] && from[1] === u.pos[1]) continue;
        arrow(g, cell, from, u.pos, own(u.owner));
      }
    }
    for (const u of f.units || []) {
      const [x, y] = u.pos;
      unitGlyph(
        g,
        cell,
        (x + 0.5) * cell,
        (y + 0.5) * cell,
        u.type,
        own(u.owner),
        u.owner === 0 ? 1 : -1
      );
    }
    if (blast !== null && blast !== void 0) {
      for (const at of nukeCells(data, idx)) drawBlast(g, w, h, cell, at, blast);
    }
  }
  function outline(g, color) {
    g.fillStyle = color;
    g.strokeStyle = "rgba(0,0,0,.55)";
    g.lineWidth = 1;
    g.fill();
    g.stroke();
  }
  function unitGlyph(g, cell, cx, cy, type, color, f) {
    const s = cell * 0.3;
    if (type === "tank") {
      g.beginPath();
      g.rect(cx - s * 0.85, cy - s * 0.62, s * 1.7, s * 1.24);
      outline(g, color);
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + f * s * 1.5, cy);
      g.strokeStyle = color;
      g.lineWidth = Math.max(1.5, cell * 0.06);
      g.lineCap = "butt";
      g.stroke();
      g.beginPath();
      g.arc(cx, cy, s * 0.42, 0, Math.PI * 2);
      outline(g, color);
      return;
    }
    if (type === "fighter") {
      g.beginPath();
      g.moveTo(cx + f * s * 1.35, cy);
      g.lineTo(cx - f * s * 0.55, cy - s * 0.95);
      g.lineTo(cx - f * s * 0.15, cy);
      g.lineTo(cx - f * s * 0.55, cy + s * 0.95);
      g.closePath();
      outline(g, color);
      return;
    }
    if (type === "drone") {
      g.beginPath();
      g.arc(cx, cy, s * 0.34, 0, Math.PI * 2);
      outline(g, color);
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        g.beginPath();
        g.arc(cx + dx * s * 0.78, cy + dy * s * 0.78, s * 0.26, 0, Math.PI * 2);
        g.fillStyle = color;
        g.globalAlpha = 0.8;
        g.fill();
        g.globalAlpha = 1;
      }
      return;
    }
    g.beginPath();
    g.moveTo(cx - s * 0.9, cy + s * 0.7);
    g.lineTo(cx + s * 0.9, cy + s * 0.7);
    g.lineTo(cx + s * 0.6, cy - s * 0.1);
    g.lineTo(cx - s * 0.6, cy - s * 0.1);
    g.closePath();
    outline(g, color);
    g.strokeStyle = color;
    g.lineWidth = Math.max(1.4, cell * 0.05);
    for (const t of [-0.35, 0.35]) {
      g.beginPath();
      g.moveTo(cx + t * s, cy - s * 0.1);
      g.lineTo(cx + t * s * 1.5, cy - s * 1.05);
      g.stroke();
    }
  }
  function buildingGlyph(g, cell, cx, cy, type, color) {
    const s = cell * 0.34;
    if (type === "base") {
      g.beginPath();
      g.rect(cx - s * 0.8, cy - s * 0.8, s * 1.6, s * 1.6);
      outline(g, color);
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        g.beginPath();
        g.rect(cx + dx * s * 0.95 - s * 0.3, cy + dy * s * 0.95 - s * 0.3, s * 0.6, s * 0.6);
        outline(g, color);
      }
      return;
    }
    if (type === "silo") {
      g.beginPath();
      g.arc(cx, cy, s * 0.95, 0, Math.PI * 2);
      outline(g, color);
      g.strokeStyle = "rgba(0,0,0,.6)";
      g.lineWidth = Math.max(1, cell * 0.04);
      g.beginPath();
      g.moveTo(cx, cy - s * 0.95);
      g.lineTo(cx, cy + s * 0.95);
      g.stroke();
      return;
    }
    const accent = type === "credit_mine" ? "#d4af37" : "#5fd95f";
    g.beginPath();
    g.rect(cx - s * 0.95, cy - s * 0.25, s * 1.9, s * 1.1);
    outline(g, color);
    for (const dx of [-0.45, 0.25]) {
      g.beginPath();
      g.rect(cx + dx * s, cy - s * 0.95, s * 0.36, s * 0.72);
      outline(g, color);
    }
    g.beginPath();
    g.arc(cx + s * 0.62, cy - s * 0.72, s * 0.3, 0, Math.PI * 2);
    g.fillStyle = accent;
    g.fill();
    if (type === "uranium_mine_central") {
      g.beginPath();
      g.arc(cx, cy + s * 0.1, s * 1.35, 0, Math.PI * 2);
      g.strokeStyle = accent;
      g.lineWidth = 1;
      g.globalAlpha = 0.7;
      g.stroke();
      g.globalAlpha = 1;
    }
  }
  function arrow(g, cell, from, to, color) {
    const x0 = (from[0] + 0.5) * cell, y0 = (from[1] + 0.5) * cell;
    const x1 = (to[0] + 0.5) * cell, y1 = (to[1] + 0.5) * cell;
    const a = Math.atan2(y1 - y0, x1 - x0);
    const gap = cell * 0.3;
    const ex = x1 - Math.cos(a) * gap, ey = y1 - Math.sin(a) * gap;
    g.globalAlpha = 0.55;
    g.strokeStyle = color;
    g.lineWidth = Math.max(1, cell * 0.055);
    g.lineCap = "round";
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
  function nukeCells(data, idx) {
    const f = data.frames[idx];
    const out = [];
    for (const ev of (f.events || []).filter((e) => e.by === "nuke")) {
      const base = (f.buildings || []).find(
        (b) => b.type === "base" && b.owner === ev.owner
      );
      if (base) out.push(base.pos);
    }
    return out;
  }
  function drawBlast(g, w, h, cell, [bx, by], p) {
    const cx = (bx + 0.5) * cell, cy = (by + 0.5) * cell;
    const ease = 1 - Math.pow(1 - p, 3);
    const fade = Math.max(0, 1 - p);
    g.beginPath();
    g.arc(cx, cy, cell * 1.15, 0, Math.PI * 2);
    g.fillStyle = "rgba(0,0,0,.55)";
    g.fill();
    for (const [delay, width] of [[0, 2.5], [0.18, 1.2]]) {
      const q = (p - delay) / (1 - delay);
      if (q <= 0) continue;
      const qe = 1 - Math.pow(1 - Math.min(1, q), 2);
      g.beginPath();
      g.arc(cx, cy, cell * 0.6 + qe * cell * 5.5, 0, Math.PI * 2);
      g.strokeStyle = "rgba(255,214,150," + (0.55 * (1 - qe)).toFixed(3) + ")";
      g.lineWidth = width;
      g.stroke();
    }
    const r = cell * (0.35 + ease * 2.1);
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, "rgba(255,255,245," + (0.95 * fade).toFixed(3) + ")");
    grad.addColorStop(0.35, "rgba(255,196,92," + (0.75 * fade).toFixed(3) + ")");
    grad.addColorStop(0.7, "rgba(226,106,32," + (0.4 * fade).toFixed(3) + ")");
    grad.addColorStop(1, "rgba(226,106,32,0)");
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fillStyle = grad;
    g.fill();
    const flash = Math.max(0, 0.42 - p * 0.85);
    if (flash > 0) {
      g.fillStyle = "rgba(255,255,255," + flash.toFixed(3) + ")";
      g.fillRect(0, 0, w, h);
    }
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const MONTHS = "January February March April May June July August September October November December".split(" ");
  function fmtDate(iso) {
    const m = /^(\d{4})-(\d\d)/.exec(String(iso || ""));
    return m && +m[2] >= 1 && +m[2] <= 12 ? `${MONTHS[+m[2] - 1]} ${m[1]}` : "";
  }
  function mount(host, data) {
    const players = Array.isArray(data.players) ? data.players.filter((p) => p && typeof p === "object") : [];
    const p0 = players.find((p) => p.slot === 0) || {};
    const p1 = players.find((p) => p.slot === 1) || {};
    const nameOf = (p) => esc(p.name || "–");
    const mark = (p) => {
      if (data.winner === -1 || data.winner === void 0) return "";
      const won = data.winner === p.slot;
      return '<span class="ft-mark" title="' + (won ? "Winner" : "Defeated") + '">' + (won ? "👑" : "💀") + "</span>";
    };
    const vt = esc(String(data.victory_type || "").replace(/_/g, " "));
    const when = fmtDate(data.date);
    const turns = Number.isFinite(Number(data.total_turns)) && Number(data.total_turns) > 0 ? Number(data.total_turns) : "?";
    host.innerHTML = '<div class="ft-head"><span class="ft-kicker">Latest match</span><span class="ft-meta">' + (vt ? "☢ " : "") + vt + " · " + turns + " turns" + (when ? " · " + when : "") + '</span></div><div class="ft-players"><span class="ft-p ft-p0">' + mark(p0) + nameOf(p0) + '</span><span class="ft-vs">vs</span><span class="ft-p ft-p1">' + nameOf(p1) + mark(p1) + '</span></div><canvas class="ft-canvas"></canvas><a class="ft-cta" href="/viewer.html?match=' + esc(encodeURIComponent(String(data.match_id))) + '">▶ Watch the replay</a>';
    const cv = host.querySelector(".ft-canvas");
    const still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const last = data.frames.length - 1;
    if (still || data.frames.length < 2) {
      const render = () => draw(cv, data, last, nukeCells(data, last).length ? 1 : void 0);
      render();
      window.addEventListener("resize", render);
      return;
    }
    const raf = (fn) => window.requestAnimationFrame ? window.requestAnimationFrame(fn) : setTimeout(fn, 16);
    const now = () => typeof performance !== "undefined" ? performance.now() : Date.now();
    let i = 0, timer = null, run = 0;
    let shown = [0, void 0];
    const paint = (idx, blast) => {
      shown = [idx, blast];
      draw(cv, data, idx, blast);
    };
    const tick = (r) => {
      if (r !== run) return;
      const isLast = i === last;
      if (isLast && nukeCells(data, i).length) {
        detonate(r);
        return;
      }
      paint(i);
      const wait = isLast ? HOLD_MS : STEP_MS;
      i = isLast ? 0 : i + 1;
      timer = setTimeout(() => tick(r), wait);
    };
    const detonate = (r) => {
      const t0 = now();
      const frame = () => {
        if (r !== run) return;
        const p = Math.min(1, (now() - t0) / BLAST_MS);
        paint(last, p);
        if (p < 1) raf(frame);
        else {
          i = 0;
          timer = setTimeout(() => tick(r), HOLD_MS);
        }
      };
      frame();
    };
    let running = false;
    const start = () => {
      if (!running) {
        running = true;
        run += 1;
        tick(run);
      }
    };
    const stop = () => {
      running = false;
      run += 1;
      clearTimeout(timer);
      timer = null;
    };
    start();
    window.addEventListener("resize", () => draw(cv, data, shown[0], shown[1]));
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
      else start();
    });
  }
  function init() {
    const host = document.getElementById("featured-match");
    if (!host) return;
    fetch("/data/featured.json", { cache: "no-cache" }).then((r) => r.ok ? r.json() : null).then((d) => {
      if (!d || !Array.isArray(d.frames) || !d.frames.length) return;
      host.hidden = false;
      mount(host, d);
    }).catch(() => {
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
