/*! Age of LLM · Copyright (C) 2026 Rymentz · AGPL-3.0-or-later · https://ageofllm.org */
(function() {
  "use strict";
  const META = window.MODEL_META || {};
  const effortBadge = window.effortBadge || (() => "");
  const VT_LABEL = {
    nuclear: "Nuclear",
    military: "Military",
    ultimatum: "Ultimatum",
    peace: "Peace",
    mutual_destruction: "Mutual destr.",
    timeout: "Timeout"
  };
  let data = null;
  let v1 = null;
  let logFilter = "";
  let modelFilter = "";
  const openModels = new Set();
  const isThrone = () => ((data || {}).rules || {}).format === "throne";
  const chalThrone = (c) => (c.format || "gauntlet") === "throne";
  let openingOpen = null;
  let droppedOpen = false;
  let perfByModel = {};
  function predecessor() {
    const rs = data.reigns || [];
    return rs.length > 1 ? rs[rs.length - 2].display_name : null;
  }
  const COPY = {
    throne: {
      tagline: "One champion. Beat it over two matches and the crown is yours.",
      sub: 'There is one thing to win here: <strong>the throne</strong>. A new model does not join a standing and it does not climb. It plays the reigning champion, <strong>two matches, one from each side of the map</strong>, and either takes the crown or goes home. <span class="lb-sub-tie"><strong>One win each</strong>: the crown goes to whichever model won in fewer turns. <strong>Two draws</strong>: the champion keeps it.</span>',
      boardTitle: "Every model tested",
      boardNote: "The champion, then every former champion by time on the throne, then every other model, most recently tested first. <strong>Not a ranking</strong>: only the throne is played for. <strong>Open a model to see each of its matches and watch the replays.</strong>",
      boardNoteTitle: "Models did not play the same number of matches: the opening four played each other, a challenger plays the champion twice. Their records are shown for what they are, and none of them is compared with another. The Season 1 models at the end were played on an older game engine and are kept frozen."
    },
    gauntlet: {
      tagline: "The current standing: four places, held until someone takes them",
      sub: 'Four places. A new model does not join the ladder. It challenges in at the bottom: <strong>two matches against #4, one from each side of the map</strong>. Win both and it moves up to face #3, then #2, then #1. As soon as it fails to take a place, the climb stops there and it keeps the last place it won. <span class="lb-sub-tie"><strong>One win each</strong>: the place goes to whichever model won in fewer turns. <strong>Two draws</strong>: the model already there keeps its place.</span>',
      boardTitle: "Standing",
      boardNote: "Seeded once by the opening table, then held until a challenger wins the tie for it.",
      boardNoteTitle: "Points set this order once and do not touch it again. The opening round-robin was scored on points and its top 4 became these places; from then on a place changes hands only when a challenger wins the two-leg tie played for it."
    }
  };
  function renderCopy() {
    const c = COPY[isThrone() ? "throne" : "gauntlet"];
    const set = (id, html, title) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = html;
      if (title) el.setAttribute("title", title);
    };
    set("lb-tagline", c.tagline);
    set("lb-sub", c.sub);
    set("board-title", c.boardTitle);
    set("board-note", c.boardNote, c.boardNoteTitle);
  }
  async function init() {
    try {
      const res = await fetch("/data/ladder.json", { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      data = await res.json();
    } catch (e) {
      document.getElementById("lad-board").innerHTML = '<div class="empty-state">The data could not be loaded.</div>';
      return;
    }
    const ver = document.getElementById("lad-ver");
    if (ver) ver.textContent = data.engine_version ? "game engine " + data.engine_version : "ladder";
    const site = document.getElementById("lad-site");
    if (site && data.site_version) site.textContent = "site v" + data.site_version;
    const v1Loading = loadV1();
    aggregatePerf();
    renderCopy();
    renderBanner();
    renderOpening();
    renderDropped();
    renderThrone();
    renderBoard();
    renderLatest();
    renderLog();
    renderReigns();
    bindFilter();
    v1 = await v1Loading;
    if (v1) {
      renderBoard();
      renderReigns();
    }
  }
  async function loadV1() {
    try {
      const get = (url) => fetch(url).then((r) => {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      });
      const [lb, idx] = await Promise.all([
        get("/data/leaderboard_v1.json"),
        get("/replays/index_v1.json")
      ]);
      return { lb, idx };
    } catch (e) {
      return null;
    }
  }
  function aggregatePerf() {
    const acc = Object.create(null);
    const eat = (leg, win, lose) => {
      const perf = leg && leg.perf;
      if (!perf || typeof perf !== "object") return;
      for (const [model, p] of Object.entries(perf)) {
        if (!p || typeof p !== "object") continue;
        const a = acc[model] || (acc[model] = {
          usd: 0,
          usdToday: 0,
          usdTodayN: 0,
          matches: 0,
          thinkSum: 0,
          thinkN: 0,
          providers: new Set(),
          reported: 0,
          ok: 0,
          illegal: 0,
          fog: 0,
          winTurns: [],
          w: 0,
          l: 0,
          d: 0
        });
        if (isNum(p.usd)) {
          a.usd += p.usd;
          a.matches += 1;
        }
        if (isNum(p.usd_today)) {
          a.usdToday += p.usd_today;
          a.usdTodayN += 1;
        }
        if (p.cost_source === "provider") a.reported += 1;
        if (isNum(p.think_ms) && num(p.half_turns)) {
          a.thinkSum += p.think_ms * num(p.half_turns);
          a.thinkN += num(p.half_turns);
        }
        a.ok += num(p.actions_ok);
        a.illegal += num(p.illegal);
        a.fog += num(p.fog_blocked);
        if (p.served_by) [].concat(p.served_by).forEach((x) => a.providers.add(String(x)));
      }
      const mutual = leg.victory_type === "mutual_destruction";
      for (const model of Object.keys(leg.perf || {})) {
        const a = acc[model];
        if (!a) continue;
        if (mutual) a.l += 1;
        else if (model === win) a.w += 1;
        else if (model === lose) a.l += 1;
        else a.d += 1;
      }
      if (isNum(leg.turns) && win && lose && !mutual) {
        (acc[win] || {}).winTurns?.push(leg.turns);
      }
    };
    ((data.opening || {}).legs || []).forEach((leg) => {
      const w = leg.outcome === "a" ? leg.a : leg.outcome === "b" ? leg.b : null;
      eat(leg, w, w ? w === leg.a ? leg.b : leg.a : null);
    });
    (data.challenges || []).forEach((c) => c.steps.forEach((st) => st.legs.forEach((leg) => {
      const ch = (c.challenger || {}).model;
      const inc = (st.opponent || {}).model;
      const w = leg.outcome === "challenger" ? ch : leg.outcome === "incumbent" ? inc : null;
      eat(leg, w, w ? w === ch ? inc : ch : null);
    })));
    perfByModel = Object.create(null);
    for (const [model, a] of Object.entries(acc)) {
      perfByModel[model] = {
        usdPerMatch: a.matches ? a.usd / a.matches : null,
        usdPerMatchToday: a.matches && a.usdTodayN === a.matches ? a.usdToday / a.matches : null,
        thinkMs: a.thinkN ? a.thinkSum / a.thinkN : null,
        matches: a.matches,
        providers: [...a.providers],
        allReported: a.matches > 0 && a.reported === a.matches,
        illegal: a.illegal,
        fog: a.fog,
        illegalRate: a.ok + a.illegal ? a.illegal / (a.ok + a.illegal) : null,
        winTurns: a.winTurns.length ? a.winTurns.reduce((s, x) => s + x, 0) / a.winTurns.length : null,
        wonMatches: a.winTurns.length,
        wins: a.w,
        losses: a.l,
        draws: a.d
      };
    }
  }
  function perfCells(model, opts) {
    const p = perfByModel[model];
    if (!p) return "";
    const lat = p.thinkMs != null ? `<span class="lad-stat" title="Mean thinking time per played turn, measured across ${p.matches} match(es) on a pinned provider">⏱ ${fmtMs(p.thinkMs)}</span>` : "";
    const rec = opts && opts.record === false ? "" : p.wins + p.losses + p.draws ? `<a class="lad-stat rec" href="#board-title" data-model="${esc(model)}" title="Record across every match played on this ladder (W–L–D). It always sums to the ${p.matches} match(es) played. A mutual destruction counts as a loss for both sides, not a draw. Click to open its matches and replays in the model list.">▤ ${p.wins}W–${p.losses}L${p.draws ? `–${p.draws}D` : ""}</a>` : "";
    const tempo = p.winTurns != null ? `<span class="lad-stat" title="Mean turns taken in the ${p.wonMatches} match(es) this model won. Career figure, shown as information: a challenge is settled on the speed inside that duel, not on this average.">⚔ wins in ${p.winTurns.toFixed(0)}</span>` : "";
    const today = p.usdPerMatchToday;
    const drift = today != null && p.usdPerMatch ? Math.abs(today - p.usdPerMatch) / p.usdPerMatch : 0;
    const nowCell = drift > 0.05 ? ` <span class="lad-now" title="The same matches re-priced at the rates in force today, keeping the discount each match actually received (prompt caching included). The provider moved its price after these matches were played; the figure on the left is what was really paid.">→ ${fmtUsd(today)} today</span>` : "";
    const pt = own(data.pricing_today, model) || {};
    const discount = num(pt.discount);
    const listPerMatch = discount && discount < 1 && (today != null || p.usdPerMatch != null) ? (today != null ? today : p.usdPerMatch) / (1 - discount) : null;
    const promo = discount ? ` <span class="lad-promo" title="This model's pinned endpoint is on a promotion right now: $${num(pt.input)}/$${num(pt.output)} per 1M against a list price of $${num(pt.list_input)}/$${num(pt.list_output)}. ${listPerMatch != null ? `At list price these same matches average ${fmtUsd(listPerMatch)}. ` : ""}The discount is a date, not a price: it expires.">PROMO −${Math.round(discount * 100)}%</span>` : "";
    const cost = p.usdPerMatch != null ? `<span class="lad-stat${p.allReported ? "" : " estimated"}" title="${p.allReported ? "Average USD per match, as charged by the provider on the day it was played" : "Average USD per match. At least one match had no provider-reported cost and fell back to an estimate"}">💲 ${fmtUsd(p.usdPerMatch)}${nowCell}${promo}</span>` : "";
    const prov = p.providers.length === 1 ? `<span class="lad-stat prov" title="Every call was served by this endpoint">${esc(p.providers[0])}</span>` : p.providers.length > 1 ? `<span class="lad-stat prov warn" title="Served by more than one endpoint: the provider pin did not hold, so latency and cost mix backends">⚠ ${esc(p.providers.join(", "))}</span>` : "";
    const ill = p.illegalRate != null ? `<span class="lad-stat" title="Share of submitted actions the engine rejected for a reason the model could have foreseen (${p.illegal} action(s))">⚠ ${(p.illegalRate * 100).toFixed(1)}% illegal</span>` : "";
    const fog = p.fog ? `<span class="lad-stat muted" title="Actions rejected by something outside the model's field of view (a hidden unit on the destination, an undiscovered building on the line of fire). Not counted as illegal: bumping into the unknown is how a fog-of-war game reveals the board.">🌫 ${p.fog} fog-blocked</span>` : "";
    return rec + lat + tempo + cost + ill + fog + prov;
  }
  function quantBadge(q) {
    if (!q) return "";
    const unknown = q === "unknown";
    const title = unknown ? "The provider does not publish the numeric precision it serves. Normal for a closed model: it can be neither chosen nor verified." : `Numeric precision of the pinned endpoint. Lower precision costs capability, and this model plays at ${q} because that is what the endpoint it is pinned to serves. It is shown next to its record.`;
    return `<span class="lad-quant${unknown ? " unknown" : ""}" title="${esc(title)}">${esc(q)}</span>`;
  }
  function fmtMs(ms) {
    const s = num(ms) / 1e3;
    return s >= 10 ? s.toFixed(0) + "s" : s.toFixed(1) + "s";
  }
  function fmtUsd(v) {
    if (!isNum(v)) return "–";
    return v >= 1 ? "$" + v.toFixed(2) : "$" + v.toFixed(v >= 0.01 ? 3 : 4);
  }
  function renderBanner() {
    if (!data.preview) return;
    document.getElementById("preview-banner").innerHTML = `<div class="preview-banner">
         <span class="pb-tag">PREVIEW</span>
         <span>${esc(data.note || "Fabricated data, not a result.")}</span>
       </div>`;
  }
  const PAGE_WIDE = { legs: 12, log: 8, models: 10 };
  const PAGE_NARROW = { legs: 6, log: 3, models: 6 };
  const narrow = () => typeof window !== "undefined" && window.innerWidth ? window.innerWidth <= 640 : false;
  const pageSize = (key) => (narrow() ? PAGE_NARROW : PAGE_WIDE)[key];
  const pageAt = {};
  function pageSlice(key, items) {
    const size = pageSize(key);
    if (!size || items.length <= size) {
      pageAt[key] = 0;
      return items;
    }
    const pages = Math.ceil(items.length / size);
    const p = Math.min(Math.max(0, pageAt[key] || 0), pages - 1);
    pageAt[key] = p;
    return items.slice(p * size, (p + 1) * size);
  }
  function pagerBar(key, total) {
    const size = pageSize(key);
    if (!size || total <= size) return "";
    const pages = Math.ceil(total / size);
    const p = Math.min(Math.max(0, pageAt[key] || 0), pages - 1);
    const from = p * size + 1, to = Math.min(total, (p + 1) * size);
    return `<div class="pager" data-pager="${key}">
              <button class="pg-btn" data-pg="prev"${p === 0 ? " disabled" : ""}
                      aria-label="Previous page">‹</button>
              <span class="pg-info">${from}–${to} of ${total}</span>
              <button class="pg-btn" data-pg="next"${p >= pages - 1 ? " disabled" : ""}
                      aria-label="Next page">›</button>
            </div>`;
  }
  function bindPager(root, rerender) {
    root.querySelectorAll("[data-pager]").forEach((bar) => {
      const key = bar.getAttribute("data-pager");
      bar.querySelectorAll(".pg-btn").forEach((b) => {
        b.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (b.disabled) return;
          pageAt[key] = (pageAt[key] || 0) + (b.getAttribute("data-pg") === "next" ? 1 : -1);
          rerender();
        });
      });
    });
  }
  function renderOpening() {
    const top = document.getElementById("opening-section");
    const hist = document.getElementById("opening-history");
    const op = data.opening;
    top.innerHTML = "";
    if (hist) hist.innerHTML = "";
    if (!op) return;
    const el = op.status === "pending" ? top : hist || top;
    if (op.status === "pending") {
      el.innerHTML = `<div class="lb-section-title">Opening</div>
         <div class="opening pending">
           <div class="opening-lead">
             <b>${num(op.matches_to_play)} matches to play.</b>
             These four models play each other twice, once from each side of the
             map; the table they produce becomes the ladder. Nothing is placed by
             decree.
           </div>
           <div class="opening-models">
             ${(op.models || []).map((m) => `<span class="opening-model">${flag(m.model)}${esc(m.display_name)} ${effortBadge(m.reasoning_effort)}${quantBadge(m.quantization)}${author(m.model)}</span>`).join("")}
           </div>
         </div>`;
      return;
    }
    if (isThrone()) return;
    const champion = (op.table || [])[0];
    const firstDay = !(data.challenges || []).length;
    if (openingOpen === null) openingOpen = firstDay;
    el.innerHTML = `<div class="lb-section-title">Opening</div>
       <div class="opening done">
         <button class="opening-toggle" aria-expanded="${openingOpen}">
           <span class="opening-chevron">${openingOpen ? "▼" : "▶"}</span>
           <span>How the ladder started</span>
           <span class="opening-summary">${fmtDate(op.date)} · ${(op.legs || []).length} matches
             · ${champion ? esc(champion.display_name) + " took #1" : ""}</span>
         </button>
         <div class="opening-detail${openingOpen ? " open" : ""}">
         <table class="lb opening-table">
           <thead><tr><th>#</th><th>Model</th><th class="num">Pts</th>
             <th class="num">W</th><th class="num">D</th><th class="num">L</th>
             <th class="num" title="Mean turns taken in the matches this model WON. Shorter means it closed them out faster">Win in</th>
             <th class="num" title="Mean turns taken in the matches this model LOST. Longer means it held out longer">Lost in</th>
             <th title="Only filled when points and wins were level: which criterion settled the order">Settled by</th></tr></thead>
           <tbody>${(op.table || []).map((r) => `<tr><td>${num(r.rank)}</td>
                  <td>${flag(r.model)}${esc(r.display_name)} ${effortBadge(r.reasoning_effort)}${quantBadge(r.quantization)}${author(r.model)}</td>
                  <td class="num">${fmtPts(r.pts)}</td>
                  <td class="num">${num(r.w)}</td><td class="num">${num(r.d)}</td><td class="num">${num(r.l)}</td>
                  <td class="num">${r.avg_win_turns != null ? num(r.avg_win_turns) : "–"}</td>
                  <td class="num">${r.avg_loss_turns != null ? num(r.avg_loss_turns) : "–"}</td>
                  <td class="tiebreak${r.tiebreak && String(r.tiebreak).startsWith("unresolved") ? " warn" : ""}">${r.tiebreak ? esc(r.tiebreak) : ""}</td>
              </tr>`).join("")}</tbody>
         </table>
         <div class="opening-legs">${pageSlice("legs", op.legs || []).map(openingLeg).join("")}</div>
         ${pagerBar("legs", (op.legs || []).length)}
         </div>
       </div>`;
    const btn = el.querySelector(".opening-toggle");
    if (btn) btn.addEventListener("click", () => {
      const open = btn.getAttribute("aria-expanded") === "true";
      openingOpen = !open;
      btn.setAttribute("aria-expanded", String(!open));
      btn.querySelector(".opening-chevron").textContent = open ? "▶" : "▼";
      el.querySelector(".opening-detail").classList.toggle("open", !open);
    });
    bindPager(el, renderOpening);
  }
  function renderDropped() {
    const el = document.getElementById("dropped-history");
    if (!el) return;
    const list = data.dropped || [];
    if (!list.length || isThrone()) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = `<div class="lb-section-title">Dropped off the ladder</div>
       <div class="opening done">
         <button class="opening-toggle" aria-expanded="${droppedOpen}">
           <span class="opening-chevron">${droppedOpen ? "▼" : "▶"}</span>
           <span>Held a place, then lost it</span>
           <span class="opening-summary">${list.length} model${list.length === 1 ? "" : "s"}
             · most recent first</span>
         </button>
         <div class="opening-detail${droppedOpen ? " open" : ""}">
           ${list.map(droppedRow).join("")}
         </div>
       </div>`;
    const btn = el.querySelector(".opening-toggle");
    if (btn) btn.addEventListener("click", () => {
      const open = btn.getAttribute("aria-expanded") === "true";
      droppedOpen = !open;
      btn.setAttribute("aria-expanded", String(!open));
      btn.querySelector(".opening-chevron").textContent = open ? "▶" : "▼";
      el.querySelector(".opening-detail").classList.toggle("open", !open);
    });
  }
  function droppedRow(e) {
    const held = e.entered_at && e.left_at ? `<span title="When it held a place">${fmtRange(e.entered_at, e.left_at)}</span>` : "";
    const by = e.displaced_by ? `<span title="The challenger that pushed it off">pushed off by ${esc(e.displaced_by)}</span>` : "";
    const from = e.left_from_rank ? `<span class="lad-rank" title="The rung it was holding when it left">#${num(e.left_from_rank)}</span>` : '<span class="line-dot" aria-hidden="true">·</span>';
    return `<div class="lad-row dropped-row">
              ${from}
              <div class="lad-model"><span class="lad-name">${flag(e.model)}${esc(e.display_name)}</span>${effortBadge(e.reasoning_effort)}${quantBadge(e.quantization)}${originBadge(e)}</div>
              <div class="lad-meta">
                ${perfCells(e.model)}
                ${held}
                <span title="Challenges survived before it left">${num(e.holds)} hold${num(e.holds) === 1 ? "" : "s"}</span>
                ${by}
              </div>
            </div>`;
  }
  function openingLeg(l) {
    const name = (m) => {
      const row = (data.opening.models || []).find((x) => x.model === m);
      return row ? row.display_name : m;
    };
    const label = l.outcome === "draw" ? l.victory_type === "mutual_destruction" ? `${esc(name(l.a))} and ${esc(name(l.b))} destroyed each other` : `${esc(name(l.a))} and ${esc(name(l.b))} drew` : `${esc(name(l.outcome === "a" ? l.a : l.b))} beat ${esc(name(l.outcome === "a" ? l.b : l.a))}`;
    const vt = vtLabel(l.victory_type);
    if (!l.match_id) {
      return `<div class="leg sim" title="Fabricated for this preview: no such match was ever played">
                ${label} · ${vt}<span class="leg-sim">SIM</span></div>`;
    }
    return `<a class="leg" href="/viewer.html?match=${encodeURIComponent(l.match_id)}"
               title="Watch the replay">${label} · ${vt}<span class="leg-play">▶</span></a>`;
  }
  function renderThrone() {
    const el = document.getElementById("throne");
    const top = (data.ladder || [])[0];
    if (!top) {
      el.innerHTML = '<div class="empty-state">No champion yet: the opening has not been played.</div>';
      return;
    }
    const reign = (data.reigns || []).filter((x) => x.to === null).pop() || (data.reigns || [])[data.reigns.length - 1];
    const since = reign ? reign.from : top.entered_at;
    const days = daysBetween(since, todayISO());
    el.innerHTML = `<div class="throne">
         <div class="throne-crown">👑</div>
         <div class="throne-main">
           <div class="throne-name">${flag(top.model)}${esc(top.display_name)} ${effortBadge(top.reasoning_effort)}${author(top.model)}</div>
           <div class="throne-sub">Champion since ${fmtDate(since)}</div>
         </div>
         <div class="throne-stats">
           <div class="ts"><b>${days}</b><span>days held</span></div>
           <div class="ts"><b>${num(reign && reign.defences)}</b><span>defence${num(reign && reign.defences) === 1 ? "" : "s"}</span></div>
           ${thirdTile(top)}
         </div>
       </div>`;
  }
  function thirdTile(top) {
    if (!isThrone()) {
      return `<div class="ts"><b>${top.seeded ? "–" : num(top.climbed)}</b><span>places climbed</span></div>`;
    }
    const prev = predecessor();
    return prev ? `<div class="ts wide" title="The champion this model beat to take the crown"><b>${esc(prev)}</b><span>dethroned</span></div>` : `<div class="ts wide" title="No predecessor: this model won the opening round-robin"><b>–</b><span>won the opening</span></div>`;
  }
  function originBadge(e) {
    if (e.via === "opening") {
      return '<span class="lad-badge from-opening" title="Place won in the opening round-robin, not by challenging in">OPENING</span>';
    }
    if (e.seeded) {
      return '<span class="lad-badge seeded" title="Placed when the ladder was created, not won on the board">SEEDED</span>';
    }
    if (e.via === "throne") {
      return '<span class="lad-badge throne" title="Won the crown by beating the reigning champion over two matches, the only way onto this page">👑 TOOK THE THRONE</span>';
    }
    return `<span class="lad-badge climbed" title="Rungs won on the way in">▲ ${num(e.climbed)}</span>`;
  }
  function renderBoard() {
    const el = document.getElementById("lad-board");
    if (!(data.ladder || []).length) {
      el.innerHTML = '<div class="empty-state">The board is empty until the opening is played.</div>';
      return;
    }
    if (isThrone()) return renderModels(el);
    el.innerHTML = (data.ladder || []).map((e) => {
      return `<div class="lad-row rank-${num(e.rank)}">
                <div class="lad-rank">#${num(e.rank)}</div>
                <div class="lad-model"><span class="lad-name">${flag(e.model)}${esc(e.display_name)}</span>${effortBadge(e.reasoning_effort)}${quantBadge(e.quantization)}${originBadge(e)}</div>
                <div class="lad-meta">
                  ${perfCells(e.model)}
                  <span title="When this model took the place">${e.seeded ? "seeded " : "entered "}${fmtDate(e.entered_at)}</span>
                  <span title="Challenges survived at this place">${num(e.holds)} hold${num(e.holds) === 1 ? "" : "s"}</span>
                </div>
              </div>`;
    }).join("");
  }
  const V1_ENGINES = "0.9.2 – 0.15.0";
  function nameOf(model) {
    const hit = [].concat(
      (data.opening || {}).models || [],
      data.ladder || [],
      data.dropped || [],
      ...(data.challenges || []).map((c) => [c.challenger].concat(c.steps.map((s) => s.opponent)))
    ).find((m) => m && m.model === model);
    return hit ? hit.display_name : model;
  }
  function resultFor(me, winner, vt) {
    if (vt === "mutual_destruction") return "md";
    if (!winner) return "d";
    return winner === me ? "w" : "l";
  }
  function ctxLabel(rank, role, throne) {
    if (throne || rank === 1) return role === "challenger" ? "Throne challenge" : "Throne defence";
    return role === "challenger" ? `Climb · #${rank}` : `Defence · #${rank}`;
  }
  function ladderMatches() {
    const by = Object.create(null);
    const push = (model, m) => (by[model] = by[model] || []).push(m);
    const op = data.opening || {};
    (op.legs || []).forEach((l) => {
      const winner = l.outcome === "a" ? l.a : l.outcome === "b" ? l.b : null;
      const base = {
        id: l.match_id,
        date: l.date || op.date,
        vt: l.victory_type,
        turns: l.turns,
        sim: !l.match_id,
        ctx: "Opening"
      };
      push(l.a, { ...base, opp: l.b, side: l.a_side, res: resultFor(l.a, winner, l.victory_type) });
      push(l.b, { ...base, opp: l.a, side: 1 - l.a_side, res: resultFor(l.b, winner, l.victory_type) });
    });
    (data.challenges || []).forEach((c) => {
      const throne = chalThrone(c);
      c.steps.forEach((st) => st.legs.forEach((l) => {
        const ch = c.challenger.model, inc = st.opponent.model;
        const winner = l.outcome === "challenger" ? ch : l.outcome === "incumbent" ? inc : null;
        const base = {
          id: l.match_id,
          date: l.date || c.date,
          vt: l.victory_type,
          turns: l.turns,
          sim: l.source === "simulated"
        };
        push(ch, {
          ...base,
          ctx: ctxLabel(st.rank, "challenger", throne),
          opp: inc,
          side: l.challenger_side,
          res: resultFor(ch, winner, l.victory_type)
        });
        push(inc, {
          ...base,
          ctx: ctxLabel(st.rank, "incumbent", throne),
          opp: ch,
          side: 1 - l.challenger_side,
          res: resultFor(inc, winner, l.victory_type)
        });
      }));
    });
    return by;
  }
  function crowning(r) {
    const c = (data.challenges || []).find((x) => x.challenger.model === r.model && x.final_rank === 1 && x.date === r.from);
    if (c) {
      const legs = c.steps[c.steps.length - 1].legs;
      const leg = legs[legs.length - 1];
      return { at: leg.date || c.date, leg };
    }
    const dates = ((data.opening || {}).legs || []).map((l) => l.date).filter(Boolean).sort();
    return { at: dates.length ? dates[dates.length - 1] : r.from, leg: null, opening: true };
  }
  function reignSpan(r) {
    const rs = data.reigns || [];
    const next = rs[rs.indexOf(r) + 1] || null;
    const start = new Date(crowning(r).at).getTime();
    const end = next ? new Date(crowning(next).at).getTime() : Date.now();
    const days = daysBetween(r.from, r.to || todayISO());
    return { days, ms: Math.max(0, end - start), next };
  }
  function fmtSpan(s) {
    if (s.days >= 1) return `${s.days} day${s.days === 1 ? "" : "s"}`;
    const h = s.ms / 36e5;
    return h >= 1 ? `${Math.round(h)} h` : "< 1 h";
  }
  function ladderModels() {
    const matches = ladderMatches();
    const rs = data.reigns || [];
    const op = data.opening || {};
    return Object.keys(matches).map((model) => {
      const list = matches[model].slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const reigns = rs.filter((r) => r.model === model);
      const spans = reigns.map(reignSpan);
      const current = reigns.some((r) => r.to === null);
      const asChallenger = (data.challenges || []).filter((c) => c.challenger.model === model);
      const opRow = (op.table || []).find((t) => t.model === model);
      const firstTested = opRow ? op.date : asChallenger.map((c) => c.date).sort()[0] || list[list.length - 1].date;
      const chal = asChallenger[0];
      return {
        id: model,
        era: "ladder",
        name: nameOf(model),
        list,
        effort: (opRow || chal && chal.challenger || {}).reasoning_effort || ((data.ladder || []).concat(data.dropped || []).find((e) => e.model === model) || {}).reasoning_effort,
        quant: (chal && chal.challenger || (op.models || []).find((m) => m.model === model) || {}).quantization,
        decision: chal && chal.challenger.decision_interface,
        current,
        reigns,
        spans,
        throneMs: spans.reduce((s, x) => s + x.ms, 0),
        throneDays: spans.reduce((s, x) => s + x.days, 0),
        firstTested: String(firstTested).slice(0, 10),
        status: ladderStatus(model, reigns, spans, chal, opRow)
      };
    });
  }
  function ladderStatus(model, reigns, spans, chal, opRow) {
    const last = reigns[reigns.length - 1];
    if (last && last.to === null) {
      return `<span class="mdl-what king">Champion since ${fmtDate(last.from)} · ${num(last.defences)} defence${num(last.defences) === 1 ? "" : "s"}</span>`;
    }
    if (last) {
      const s = spans[spans.length - 1];
      const when = last.from === last.to ? `for ${fmtSpan(s)} in ${fmtDate(last.from)}` : fmtDate(last.from) === fmtDate(last.to) ? `in ${fmtDate(last.from)}` : fmtRange(last.from, last.to);
      const opened = crowning(last).opening ? "Won the opening · c" : "C";
      return `<span class="mdl-what held"${crowning(last).opening ? ` title="${esc(openingWin(model))}"` : ""}>${opened}hampion ${when}${s.next ? `, dethroned by ${esc(s.next.display_name)}` : ""}</span>`;
    }
    if (chal) {
      const st = chal.steps[chal.steps.length - 1];
      if (chalThrone(chal)) {
        const [pc, pi] = st.pts;
        const speed = st.decided_by && /faster/.test(st.decided_by) ? " on speed" : "";
        return `<span class="mdl-what">Challenged ${esc(st.opponent.display_name)} in ${fmtDate(chal.date)} · lost the tie ${fmtPts(pc)}–${fmtPts(pi)}${speed}</span>`;
      }
      const how = "The first season's gauntlet: a challenger entered at #4 and climbed one two-leg tie at a time, before the throne format";
      return chal.final_rank ? `<span class="mdl-what" title="${how}">Gauntlet, ${fmtDate(chal.date)} · climbed to #${num(chal.final_rank)}</span>` : `<span class="mdl-what" title="${how}">Gauntlet, ${fmtDate(chal.date)} · lost its tie at #${num(st.rank)}</span>`;
    }
    if (opRow) {
      return `<span class="mdl-what">Opening round-robin, ${fmtDate((data.opening || {}).date)} · finished #${num(opRow.rank)} of ${(data.opening.table || []).length}</span>`;
    }
    return "";
  }
  function openingWin(model) {
    const t = (data.opening || {}).table || [];
    const me = t.find((r) => r.model === model);
    if (!me) return "";
    const level = t.filter((r) => r !== me && r.pts === me.pts);
    return `Finished first of the opening round-robin in ${fmtDate(data.opening.date)}: ${fmtPts(me.pts)} points, ${me.w}W–${me.l}L` + (level.length && me.tiebreak ? `, level on points with ${level.map((r) => r.display_name).join(", ")} and ahead on ${me.tiebreak}.` : ".");
  }
  function v1Models() {
    if (!v1) return [];
    const reps = v1.idx && v1.idx.replays || [];
    const lb = v1.lb && v1.lb.models || [];
    const min = v1.lb && v1.lb.min_matches_ranked || 0;
    const byPpm = (a, b) => (b.points_per_match || 0) - (a.points_per_match || 0);
    const active = lb.filter((m) => !m.archived);
    const ordered = active.filter((m) => m.total >= min).sort(byPpm).concat(active.filter((m) => m.total < min).sort(byPpm)).concat(lb.filter((m) => m.archived).sort(byPpm));
    return ordered.map((m, i) => {
      const ranked = !m.archived && m.total >= min;
      const list = reps.filter((r) => r.p1_model === m.model || r.p2_model === m.model).map((r) => {
        const me = r.p1_model === m.model ? 0 : 1;
        const winner = r.winner === 0 ? r.p1_model : r.winner === 1 ? r.p2_model : null;
        return {
          id: r.match_id,
          date: r.date,
          ctx: "Season 1",
          side: me,
          opp: me === 0 ? r.p2_model : r.p1_model,
          oppName: me === 0 ? r.p2_display_name : r.p1_display_name,
          res: resultFor(m.model, winner, r.victory_type),
          vt: r.victory_type,
          turns: r.total_turns
        };
      }).sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const dates = list.map((x) => String(x.date).slice(0, 10)).sort();
      return {
        id: "v1:" + m.model,
        model: m.model,
        era: "v1",
        name: m.display_name,
        list,
        effort: m.reasoning_effort,
        v1Rank: ranked ? i + 1 : null,
        v1: m,
        firstTested: dates[0] || "",
        status: `<span class="mdl-what" title="Played on game engine ${V1_ENGINES}, before the throne existed. Frozen in August 2026 and still published unchanged on the Season 1 page.">Season 1 · ${list.length} matches, ${fmtRange(dates[0], dates[dates.length - 1])}${m.archived ? " · archived" : ""}</span>`
      };
    });
  }
  function allModels() {
    const lad = ladderModels();
    const kings = lad.filter((m) => m.reigns.length).sort((a, b) => b.current - a.current || b.throneMs - a.throneMs);
    const others = lad.filter((m) => !m.reigns.length).sort((a, b) => b.firstTested.localeCompare(a.firstTested) || String(b.list[0].date).localeCompare(String(a.list[0].date)) || a.name.localeCompare(b.name));
    return kings.concat(others, v1Models());
  }
  function renderModels(el) {
    const all = allModels();
    const list = modelFilter ? all.filter((m) => m.name.toLowerCase().includes(modelFilter)) : all;
    if (!list.length) {
      el.innerHTML = '<div class="empty-state">No model matches.</div>';
      return;
    }
    const page = pageSlice("models", list);
    el.innerHTML = page.map((m, i) => {
      const divider = m.era === "v1" && (i === 0 || page[i - 1].era !== "v1") ? `<div class="mdl-divider">
             <b>Season 1 archive, frozen.</b> Played on game engine ${V1_ENGINES}, under
             rules and a system prompt the current engine no longer uses, and before
             the throne existed. Shown in the order the
             <a href="/v1.html">Season 1 leaderboard</a> still publishes.
           </div>` : "";
      return divider + modelRow(m);
    }).join("") + pagerBar("models", list.length);
    bindPager(el, () => renderModels(el));
    el.querySelectorAll(".mdl-head").forEach((h) => {
      h.addEventListener("click", () => {
        const row = h.closest(".mdl");
        const id = row.getAttribute("data-id");
        const open = !row.classList.contains("open");
        if (open) openModels.add(id);
        else openModels.delete(id);
        row.classList.toggle("open", open);
        h.setAttribute("aria-expanded", String(open));
        const label = row.querySelector(".mdl-toggle-label");
        if (label) label.textContent = toggleLabel(row.getAttribute("data-n"), open);
      });
    });
  }
  function openModel(id) {
    modelFilter = "";
    const fm = document.getElementById("f-model");
    if (fm) fm.value = "";
    const i = allModels().findIndex((m) => m.id === id);
    if (i < 0) return;
    pageAt.models = Math.floor(i / pageSize("models"));
    openModels.add(id);
    renderBoard();
    const row = [...document.querySelectorAll(".mdl")].find((r) => r.getAttribute("data-id") === id);
    if (row) row.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function toggleLabel(n, open) {
    return open ? "Hide matches" : `Show its ${n} match${Number(n) === 1 ? "" : "es"}`;
  }
  function modelRow(m) {
    const open = openModels.has(m.id);
    const n = m.list.length;
    const w = m.list.filter((x) => x.res === "w").length;
    const l = m.list.filter((x) => x.res === "l" || x.res === "md").length;
    const d = m.list.filter((x) => x.res === "d").length;
    const mark = m.current ? "👑" : m.era === "ladder" && m.reigns.length ? "★" : "·";
    const badge = m.era === "v1" ? m.v1Rank === 1 ? '<span class="lad-badge v1-top" title="#1 of the frozen Season 1 leaderboard, on points per match">👑 S1 #1</span>' : m.v1Rank ? `<span class="lad-badge v1" title="Rank on the frozen Season 1 leaderboard, on points per match">S1 #${m.v1Rank}</span>` : '<span class="lad-badge v1" title="Not ranked on the Season 1 leaderboard">S1</span>' : "";
    const decision = m.decision && m.decision.kind === "choice" ? `<span class="effort effort-na" title="${esc(window.choiceInterfaceTitle(m.decision))}">CHOICE</span>` : effortBadge(m.effort);
    const throne = m.era === "v1" ? '<div class="mdl-tile muted" title="Season 1 was played before the throne existed"><b>–</b><span>before the throne</span></div>' : m.reigns.length ? `<div class="mdl-tile gold" title="${m.reigns.map((r) => r.to ? fmtRange(r.from, r.to) : `${fmtDate(r.from)} → today`).join(", ")}"><b>${fmtSpan({ days: m.throneDays, ms: m.throneMs })}</b><span>on the throne</span></div>` : '<div class="mdl-tile muted"><b>–</b><span>never champion</span></div>';
    const rec = `<div class="mdl-tile" title="Wins–losses${d ? "–draws" : ""} over its ${n} match${n === 1 ? "" : "es"}. A mutual destruction counts as a loss for both sides."><b>${w}W–${l}L${d ? `–${d}D` : ""}</b><span>${n} match${n === 1 ? "" : "es"}</span></div>`;
    const perf = m.era === "v1" ? v1Perf(m.v1) : perfCells(m.id, { record: false });
    const cls = m.current ? " king" : m.era === "ladder" && m.reigns.length ? " held" : "";
    return `<div class="mdl${cls}${m.era === "v1" ? " v1" : ""}${open ? " open" : ""}" data-id="${esc(m.id)}" data-n="${n}">
      <div class="mdl-head" role="button" tabindex="0" aria-expanded="${open}">
        <div class="mdl-mark" aria-hidden="true">${mark}</div>
        <div class="mdl-main">
          <div class="lad-model"><span class="lad-name">${flag(m.model || m.id)}${esc(m.name)}</span>${decision}${quantBadge(m.quant)}${badge}</div>
          <div class="mdl-status">${m.status}</div>
        </div>
        <div class="mdl-tiles">${throne}${rec}</div>
        <div class="mdl-toggle"><span class="mdl-toggle-label">${toggleLabel(n, open)}</span><span class="mdl-chevron">▾</span></div>
      </div>
      <div class="mdl-body">
        ${perf ? `<div class="chal-perf">${perf}</div>` : ""}
        <div class="mdl-legs">${m.list.map(modelLeg).join("")}</div>
      </div>
    </div>`;
  }
  function v1Perf(m) {
    const cells = [];
    if (m.avg_think_ms) cells.push(`<span class="lad-stat" title="Mean thinking time per turn, Season 1 corpus">⏱ ${fmtMs(m.avg_think_ms)}</span>`);
    if (m.avg_cost_per_match) cells.push(`<span class="lad-stat estimated" title="Average USD per match in the Season 1 corpus, at the prices of the day">💲 ${fmtUsd(m.avg_cost_per_match)}</span>`);
    if (m.invalid_action_rate != null) cells.push(`<span class="lad-stat" title="Share of submitted actions the Season 1 engine rejected">⚠ ${(num(m.invalid_action_rate) * 100).toFixed(1)}% invalid</span>`);
    return cells.join("");
  }
  function modelLeg(x) {
    const opp = x.oppName || nameOf(x.opp);
    const side = x.side === 0 ? '<span class="badge-p0" title="Played player 1">P1</span>' : '<span class="badge-p1" title="Played player 2">P2</span>';
    const res = x.res === "w" ? '<span class="leg-w">won</span>' : x.res === "l" ? '<span class="leg-l">lost</span>' : x.res === "md" ? '<span class="leg-l" title="Mutual destruction scores 0 for both, like a loss. It is not a draw">both lost</span>' : '<span class="leg-d">drew</span>';
    const vt = vtLabel(x.vt);
    const body = `<span class="mleg-date">${fmtDate(x.date)}</span>
      <span class="mleg-ctx">${esc(x.ctx)}</span>
      <span class="mleg-opp">vs ${flag(x.opp)}${esc(opp)}</span>
      <span class="mleg-res">${side} ${res} · ${vt} ${x.turns ? `<span class="mleg-turns">T${num(x.turns)}</span>` : ""}</span>`;
    if (x.sim) {
      return `<div class="leg mleg sim" title="Fabricated for this preview: no such match was ever played">${body}<span class="leg-sim">SIM</span></div>`;
    }
    return `<a class="leg mleg" href="/viewer.html?match=${encodeURIComponent(x.id)}" title="Watch the replay">${body}<span class="leg-play">▶ replay</span></a>`;
  }
  function renderLatest() {
    const el = document.getElementById("latest-challenge");
    const c = (data.challenges || [])[0];
    if (!c) {
      el.innerHTML = '<div class="empty-state">No challenge yet: the queue starts once there is a champion to play.</div>';
      return;
    }
    el.innerHTML = challengeCard(c, true);
    bindChalToggle(el);
  }
  function bindChalToggle(root) {
    root.querySelectorAll(".chal-head").forEach((h) => {
      h.addEventListener("click", () => h.closest(".chal").classList.toggle("open"));
    });
  }
  function renderLog() {
    const el = document.getElementById("lad-log");
    const list = (data.challenges || []).filter((c) => {
      if (!logFilter) return true;
      const hay = (c.challenger.display_name + " " + c.steps.map((s) => s.opponent.display_name).join(" ")).toLowerCase();
      return hay.includes(logFilter);
    });
    if (!list.length) {
      el.innerHTML = '<div class="empty-state">No challenge matches.</div>';
      return;
    }
    el.innerHTML = pageSlice("log", list).map((c) => challengeCard(c, false)).join("") + pagerBar("log", list.length);
    bindPager(el, renderLog);
    bindChalToggle(el);
  }
  function challengeCard(c, expanded) {
    const rank = c.final_rank;
    const throne = chalThrone(c);
    const retold = !throne && isThrone();
    const verdictClass = rank === 1 ? "takes-throne" : retold ? "fails" : rank ? "enters" : throne ? "held" : "fails";
    const verdict = rank === 1 ? "takes the throne" : retold ? "did not reach the champion" : rank ? `enters at #${num(rank)}` : throne ? "the champion holds" : "fails to enter";
    const lastStep = c.steps[c.steps.length - 1];
    const displaced = retold && rank !== 1 ? `<span class="chal-displaced">${rank ? `climbed to #${num(rank)}` : `lost its tie at #${num(lastStep.rank)}`}</span>` : c.displaced && !isThrone() ? `<span class="chal-displaced">${esc(c.displaced)} drops off</span>` : "";
    const gauntlet = retold ? `<span class="lad-badge gauntlet" title="Played under the first season's gauntlet, which gave way to the throne in September 2026: a challenger entered at #4 and had to win one two-leg tie per seat to reach the champion at #1. Same game engine, same rules of play: only the route to the throne was longer.">GAUNTLET</span>` : "";
    const rungs = c.steps.length;
    const legs = c.steps.reduce((n, s) => n + s.legs.length, 0);
    const count = throne ? `<span class="chal-count" title="A throne challenge is one two-leg tie against the champion: the same pair, sides swapped. Win it and the crown changes hands; lose it and nothing on the board moves.">${legs} match${legs === 1 ? "" : "es"} · one from each side</span>` : `<span class="chal-count" title="One card per seat challenged on the way up. Every seat is a two-leg tie (the same pair, sides swapped), so ${rungs} ties means ${legs} matches.">${rungs} ${retold ? "tie" : "rung"}${rungs === 1 ? "" : "s"} · ${legs} match${legs === 1 ? "" : "es"}</span>`;
    const decisionBadge = c.challenger.decision_interface?.kind === "choice" ? `<span class="effort effort-na" title="${esc(window.choiceInterfaceTitle(c.challenger.decision_interface))}">CHOICE</span>` : effortBadge(c.challenger.reasoning_effort);
    return `<div class="chal ${expanded ? "open" : ""}">
      <div class="chal-head">
        <span class="chal-date">${fmtDate(c.date)}</span>
        <span class="chal-name">${flag(c.challenger.model)}${esc(c.challenger.display_name)} ${decisionBadge}${quantBadge(c.challenger.quantization)}</span>
        ${gauntlet}
        <span class="chal-verdict ${verdictClass}">${verdict}</span>
        ${displaced}
        ${count}
        <span class="chal-chevron">▾</span>
      </div>
      <div class="chal-body">
        <!-- A challenger that fails to enter appears ONLY here: it never
             reaches the standing list, which is the other place that prints
             quantization, endpoint, latency and cost. Without this row those
             figures existed in the data and were shown nowhere, and the claim
             that every model's endpoint is published next to it was false for
             precisely the models most likely to be pinned to a third party. -->
        <div class="chal-perf">${perfCells(c.challenger.model)}</div>
        <div class="climb">${c.steps.map((st) => stepCard(st, throne)).join('<div class="climb-arrow">→</div>')}</div>
      </div>
    </div>`;
  }
  function stepCard(s, throne) {
    const won = s.result === "win";
    const [pc, pi] = s.pts;
    const note = s.decided_by && s.decided_by !== "points" ? `<span class="step-note">${esc(s.decided_by)}</span>` : "";
    return `<div class="step ${won ? "won" : "lost"}">
      <div class="step-head">
        <span class="step-rank${throne || s.rank === 1 ? " crown" : ""}" title="${throne || s.rank === 1 ? "The reigning champion, on the throne" : "The seat this tie was played for, on the way up to the champion"}">${throne || s.rank === 1 ? "👑" : "#" + num(s.rank)}</span>
        <span class="step-opp">${flag(s.opponent.model)}${esc(s.opponent.display_name)}</span>
        <span class="step-score">${fmtPts(pc)}–${fmtPts(pi)}</span>
      </div>
      ${note}
      <div class="step-legs">${s.legs.map(legChip).join("")}</div>
    </div>`;
  }
  function legChip(l, i) {
    const side = l.challenger_side === 0 ? '<span class="badge-p0" title="Challenger played player 1">P1</span>' : '<span class="badge-p1" title="Challenger played player 2">P2</span>';
    const res = l.outcome === "challenger" ? '<span class="leg-w">won</span>' : l.outcome === "incumbent" ? '<span class="leg-l">lost</span>' : l.victory_type === "mutual_destruction" ? '<span class="leg-l" title="Mutual destruction scores 0 for both, like a loss. It is not a draw">both lost</span>' : '<span class="leg-d">drew</span>';
    const vt = vtLabel(l.victory_type);
    const turns = l.turns ? `${num(l.turns)}t` : "";
    const body = `${side} ${res} · ${vt} ${turns}`;
    if (l.source === "simulated") {
      return `<div class="leg sim" title="Fabricated for this preview: no such match was ever played">
                ${body}<span class="leg-sim">SIM</span></div>`;
    }
    return `<a class="leg" href="/viewer.html?match=${encodeURIComponent(l.match_id)}"
               title="Watch the replay">${body}<span class="leg-play">▶</span></a>`;
  }
  function renderReigns() {
    const el = document.getElementById("lad-reigns");
    const rs = data.reigns || [];
    if (!rs.length) {
      el.innerHTML = '<div class="empty-state">No reign yet.</div>';
      return;
    }
    const start = new Date(rs[0].from).getTime();
    const last = rs.reduce((m, r) => Math.max(m, new Date(r.to || 0).getTime() || 0), 0);
    const end = Math.max(new Date(todayISO()).getTime(), last, start + 864e5);
    const span = end - start;
    el.innerHTML = v1Reign() + rs.map((r) => {
      const a = new Date(r.from).getTime();
      const b = r.to ? new Date(r.to).getTime() : end;
      const left = (a - start) / span * 100;
      const width = Math.max(2, (b - a) / span * 100);
      const cr = crowning(r);
      const how = cr.leg && cr.leg.match_id ? `<a class="reign-how" href="/viewer.html?match=${encodeURIComponent(cr.leg.match_id)}" title="Watch the match that won the crown">▶</a>` : cr.opening ? `<a class="reign-how" href="#board-title" data-open-model="${esc(r.model)}" title="${esc(openingWin(r.model))} Open its matches.">⚑</a>` : "";
      return `<div class="reign">
        <div class="reign-name">${flag(r.model)}${esc(r.display_name)}${r.seeded ? '<span class="lad-badge seeded">SEEDED</span>' : ""}${how}</div>
        <div class="reign-track">
          <div class="reign-bar ${r.to ? "" : "current"}" style="left:${left}%;width:${width}%"
               title="${r.to ? fmtRange(r.from, r.to) : `${fmtDate(r.from)} → now`}"></div>
        </div>
        <div class="reign-days">${fmtSpan(reignSpan(r))}${num(r.defences) ? ` · ${num(r.defences)} def.` : ""}</div>
      </div>`;
    }).join("");
  }
  function v1Reign() {
    const top = v1Models().find((m) => m.v1Rank === 1);
    if (!top) return "";
    const d = top.list.map((x) => String(x.date).slice(0, 10)).sort();
    return `<div class="reign-before">
      <span class="reign-before-tag">Before the throne</span>
      ${flag(top.model)}<b>${esc(top.name)}</b> led the frozen
      <a href="/v1.html">Season 1 leaderboard</a>: ${num(top.v1.wins)}W–${num(top.v1.losses)}L,
      ${fmtPts(top.v1.points_per_match)} points per match, ${fmtRange(d[0], d[d.length - 1])},
      game engine ${V1_ENGINES}
    </div>`;
  }
  function bindFilter() {
    const inp = document.getElementById("f-chal");
    if (inp) inp.addEventListener("input", () => {
      logFilter = inp.value.trim().toLowerCase();
      renderLog();
    });
    const fm = document.getElementById("f-model");
    if (fm) fm.addEventListener("input", () => {
      modelFilter = fm.value.trim().toLowerCase();
      pageAt.models = 0;
      renderBoard();
    });
    document.addEventListener("click", (e) => {
      const rec = e.target.closest && e.target.closest("a.rec[data-model]");
      if (rec && isThrone()) {
        e.preventDefault();
        openModel(rec.getAttribute("data-model"));
        return;
      }
      const first = e.target.closest && e.target.closest("a[data-open-model]");
      if (first) {
        e.preventDefault();
        openModel(first.getAttribute("data-open-model"));
      }
    });
    const board = document.getElementById("lad-board");
    if (board) board.addEventListener("keydown", (e) => {
      const h = e.target.closest && e.target.closest(".mdl-head");
      if (h && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        h.click();
      }
    });
  }
  function flag(id) {
    const m = own(META, id);
    return m && m.flag ? esc(m.flag) + " " : "";
  }
  function author(id) {
    const m = own(META, id);
    return m && m.author ? `<span class="model-author">${esc(m.author)}</span>` : "";
  }
  function own(o, k) {
    return o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : void 0;
  }
  function isNum(v) {
    return typeof v === "number" && Number.isFinite(v);
  }
  function num(v) {
    const x = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    return Number.isFinite(x) ? x : 0;
  }
  function vtLabel(v) {
    return `<span class="vt vt-${esc(v)}">${esc(own(VT_LABEL, v) || v)}</span>`;
  }
  function fmtPts(v) {
    return Number(v).toFixed(v % 1 ? 1 : 0);
  }
  function todayISO() {
    return (new Date()).toISOString().slice(0, 10);
  }
  function daysBetween(a, b) {
    const d = (new Date(b).getTime() - new Date(a).getTime()) / 864e5;
    return Number.isFinite(d) ? Math.max(0, Math.round(d)) : 0;
  }
  const MONTHS = "January February March April May June July August September October November December".split(" ");
  function fmtDate(iso) {
    const m = /^(\d{4})-(\d\d)/.exec(String(iso || ""));
    return m && +m[2] >= 1 && +m[2] <= 12 ? `${MONTHS[+m[2] - 1]} ${m[1]}` : "";
  }
  function fmtRange(a, b) {
    const x = fmtDate(a), y = fmtDate(b);
    return x && y && x !== y ? `${x} → ${y}` : x || y;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  document.addEventListener("DOMContentLoaded", init);
})();
