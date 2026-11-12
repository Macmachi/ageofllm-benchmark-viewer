/*! Age of LLM · Copyright (C) 2026 Rymentz · AGPL-3.0-or-later · https://ageofllm.org */
const Stats = (() => {
  const UNIT_VALUE = { drone: 2, sam: 3, tank: 4, fighter: 4 };
  const UNIT_TYPES = ["drone", "sam", "tank", "fighter"];
  const COL = {
    p0: "#4da6ff",
    p1: "#ff5d6c",
    credit: "#d4af37",
    uranium: "#5fd95f",
    grid: "#222c38",
    axis: "#3a4654",
    text: "#8a97a6",
    textHi: "#e8eef5",
    threshold: "#e0a82e"
  };
  function compute(replay, turnIdx) {
    const slice = replay.turns.slice(0, turnIdx + 1);
    const economy = [];
    const military = [];
    const bomb = [];
    const bombBase = replay.meta && replay.meta.bomb_base_cost || 25;
    let bombCostMax = 0;
    for (const t of slice) {
      const ps = t.players_state;
      const mil = [0, 1].map((o) => (t.units || []).filter((u) => u.owner === o).reduce((s, u) => s + (UNIT_VALUE[u.type] || 0), 0));
      const cost0 = typeof ps[0].bomb_cost === "number" ? ps[0].bomb_cost : bombBase;
      const cost1 = typeof ps[1].bomb_cost === "number" ? ps[1].bomb_cost : bombBase;
      bombCostMax = Math.max(bombCostMax, cost0, cost1);
      economy.push({
        turn: t.turn,
        c0: ps[0].credits,
        c1: ps[1].credits,
        u0: ps[0].uranium,
        u1: ps[1].uranium,
        cost0,
        cost1
      });
      military.push({ turn: t.turn, m0: mil[0], m1: mil[1] });
      bomb.push({
        turn: t.turn,
        p0: Math.min(1, ps[0].uranium / cost0),
        p1: Math.min(1, ps[1].uranium / cost1)
      });
    }
    const produced = emptyCounts();
    const losses = emptyCounts();
    const known = (type) => UNIT_TYPES.includes(type);
    for (const t of slice) {
      for (const a of t.actions || []) {
        if (a && a.type === "produce" && known(a.unit_type)) {
          produced[a.unit_type][a.player === 0 ? "A" : "B"]++;
        }
      }
      for (const e of t.events || []) {
        if (e && e.type === "unit_destroyed" && known(e.unit_type)) {
          losses[e.unit_type][e.owner === 0 ? "A" : "B"]++;
        }
      }
    }
    const bombThreshold = bombCostMax || bombBase;
    return { economy, military, bomb, produced, losses, bombBase, bombThreshold };
  }
  function emptyCounts() {
    const o = Object.create(null);
    for (const t of UNIT_TYPES) o[t] = { A: 0, B: 0 };
    return o;
  }
  function setupCanvas(canvas, w, h) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return ctx;
  }
  function lineChart(canvas, w, h, series, lines, opts = {}) {
    const ctx = setupCanvas(canvas, w, h);
    const padL = 30, padR = 8, padT = 10, padB = 18;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const xs = series.map((d) => d.turn);
    const xmin = Math.min(...xs), xmax = Math.max(...xs, xmin + 1);
    let ymax = opts.ymax;
    if (ymax == null) {
      ymax = 1;
      for (const ln of lines) for (const d of series) ymax = Math.max(ymax, d[ln.key]);
      ymax = Math.ceil(ymax * 1.1);
    }
    const X = (t) => padL + (xmax === xmin ? 0 : (t - xmin) / (xmax - xmin)) * plotW;
    const Y = (v) => padT + plotH - v / ymax * plotH;
    ctx.strokeStyle = COL.grid;
    ctx.fillStyle = COL.text;
    ctx.font = "9px monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i++) {
      const v = ymax / 4 * i, y = Y(v);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      ctx.fillText(String(Math.round(v)), padL - 4, y);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("T" + xmin, padL, h - padB + 4);
    ctx.fillText("T" + xmax, w - padR, h - padB + 4);
    if (opts.threshold != null) {
      const y = Y(opts.threshold);
      ctx.strokeStyle = COL.threshold;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const ln of lines) {
      ctx.strokeStyle = ln.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      series.forEach((d, i) => {
        const x = X(d.turn), y = Y(d[ln.key]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      if (series.length) {
        const last = series[series.length - 1];
        ctx.fillStyle = ln.color;
        ctx.beginPath();
        ctx.arc(X(last.turn), Y(last[ln.key]), 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  function groupedBars(canvas, w, h, cats, groups) {
    const ctx = setupCanvas(canvas, w, h);
    const data = canvas.__data;
    const padL = 24, padR = 8, padT = 10, padB = 26;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    let ymax = 1;
    for (const c of cats) for (const g of groups) ymax = Math.max(ymax, data[c][g.key]);
    if (!Number.isFinite(ymax)) ymax = 1;
    const step = niceStep(ymax, 6);
    ymax = Math.max(step, Math.ceil(ymax / step) * step);
    const Y = (v) => padT + plotH - v / ymax * plotH;
    ctx.strokeStyle = COL.grid;
    ctx.fillStyle = COL.text;
    ctx.font = "9px monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= ymax; i += step) {
      const y = Y(i);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      ctx.fillText(String(i), padL - 4, y);
    }
    const slot = plotW / cats.length;
    const bw = Math.min(16, slot / (groups.length + 1));
    cats.forEach((c, i) => {
      const cx = padL + slot * i + slot / 2;
      groups.forEach((g, gi) => {
        const v = data[c][g.key];
        const x = cx - groups.length * bw / 2 + gi * bw;
        ctx.fillStyle = g.color;
        const y = Y(v);
        ctx.fillRect(x, y, bw - 2, padT + plotH - y);
      });
      ctx.fillStyle = COL.text;
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(c.slice(0, 4), cx, h - padB + 6);
    });
  }
  function niceStep(max, ticks) {
    for (let p = 1; p < 1e12; p *= 10) {
      for (const n of [1, 2, 5]) if (Math.ceil(max / (n * p)) <= ticks) return n * p;
    }
    return 1e12;
  }
  function render(replay, turnIdx, host) {
    const s = compute(replay, turnIdx);
    const names = replay.meta.players;
    host.innerHTML = "";
    const tabs = [
      { k: "eco", l: "Economy" },
      { k: "mil", l: "Military" },
      { k: "bomb", l: "Bomb" },
      { k: "prod", l: "Production" },
      { k: "loss", l: "Losses" }
    ];
    const active = host.__activeTab || "eco";
    const tabBar = document.createElement("div");
    tabBar.className = "stat-tabs";
    for (const t of tabs) {
      const b = document.createElement("button");
      b.className = "stat-tab" + (t.k === active ? " active" : "");
      b.textContent = t.l;
      b.onclick = () => {
        host.__activeTab = t.k;
        render(replay, host.__turnIdx, host);
      };
      tabBar.appendChild(b);
    }
    host.appendChild(tabBar);
    host.__turnIdx = turnIdx;
    const W = 286, H = 150;
    const cv = document.createElement("canvas");
    cv.className = "stat-canvas";
    host.appendChild(cv);
    const legend = document.createElement("div");
    legend.className = "stat-legend";
    host.appendChild(legend);
    const nameOf = (p, i) => String(p && (p.name || p.model) || `Player ${i + 1}`);
    const nameA = nameOf(names[0], 0), nameB = nameOf(names[1], 1);
    if (active === "eco") {
      lineChart(cv, W, H, s.economy, [
        { key: "c0", color: COL.p0 },
        { key: "c1", color: COL.p1 },
        { key: "u0", color: COL.uranium },
        { key: "u1", color: COL.credit }
      ]);
      legend.append(
        swatch(COL.p0, `${nameA} credits`),
        swatch(COL.p1, `${nameB} credits`),
        swatch(COL.uranium, `${nameA} uranium`),
        swatch(COL.credit, `${nameB} uranium`)
      );
    } else if (active === "mil") {
      lineChart(cv, W, H, s.military, [
        { key: "m0", color: COL.p0 },
        { key: "m1", color: COL.p1 }
      ]);
      legend.append(
        swatch(COL.p0, `${nameA} power`),
        swatch(COL.p1, `${nameB} power`),
        note("Sum of living unit costs")
      );
    } else if (active === "bomb") {
      const series = s.economy.map((d) => ({ turn: d.turn, b0: d.u0, b1: d.u1 }));
      const thr = s.bombThreshold;
      lineChart(cv, W, H, series, [
        { key: "b0", color: COL.p0 },
        { key: "b1", color: COL.p1 }
      ], { threshold: thr, ymax: Math.max(thr + 2, ...series.map((d) => Math.max(d.b0, d.b1))) });
      const cur = s.economy[s.economy.length - 1] || { u0: 0, u1: 0, cost0: thr, cost1: thr };
      legend.append(
        swatch(COL.p0, `${nameA} ${Math.round(100 * cur.u0 / (cur.cost0 || thr))}%`),
        swatch(COL.p1, `${nameB} ${Math.round(100 * cur.u1 / (cur.cost1 || thr))}%`),
        swatch(COL.threshold, `Bomb cost ${thr} U`)
      );
    } else if (active === "prod") {
      cv.__data = s.produced;
      groupedBars(cv, W, H, UNIT_TYPES, [
        { key: "A", color: COL.p0 },
        { key: "B", color: COL.p1 }
      ]);
      legend.append(swatch(COL.p0, nameA), swatch(COL.p1, nameB), note("Units produced (cumulative)"));
    } else if (active === "loss") {
      cv.__data = s.losses;
      groupedBars(cv, W, H, UNIT_TYPES, [
        { key: "A", color: COL.p0 },
        { key: "B", color: COL.p1 }
      ]);
      legend.append(swatch(COL.p0, nameA), swatch(COL.p1, nameB), note("Units lost (cumulative)"));
    }
  }
  function swatch(color, label) {
    const item = document.createElement("span");
    item.className = "stat-sw-item";
    const sw = document.createElement("span");
    sw.className = "stat-sw";
    sw.style.background = color;
    item.append(sw, String(label));
    return item;
  }
  function note(text) {
    const el = document.createElement("div");
    el.className = "stat-note";
    el.textContent = text;
    return el;
  }
  return { render, compute };
})();
if (typeof module !== "undefined" && module.exports) module.exports = Stats;
