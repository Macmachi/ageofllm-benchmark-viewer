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
  let logFilter = "";
  let openingOpen = null;
  let droppedOpen = false;
  let perfByModel = {};
  async function init() {
    try {
      const res = await fetch("data/ladder.json", { cache: "no-store" });
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
    aggregatePerf();
    renderBanner();
    renderOpening();
    renderDropped();
    renderThrone();
    renderBoard();
    renderLatest();
    renderLog();
    renderReigns();
    bindFilter();
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
          lossTurns: [],
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
        (acc[lose] || {}).lossTurns?.push(leg.turns);
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
  function perfCells(model) {
    const p = perfByModel[model];
    if (!p) return "";
    const lat = p.thinkMs != null ? `<span class="lad-stat" title="Mean thinking time per played turn, measured across ${p.matches} match(es) on a pinned provider">⏱ ${fmtMs(p.thinkMs)}</span>` : "";
    const rec = p.wins + p.losses + p.draws ? `<a class="lad-stat rec" href="#opening-history" title="Record across every match played on this ladder: W–L–D, and it always sums to the ${p.matches} match(es) played. A mutual destruction counts as a loss for both sides, not a draw. Click to open the match list and the replays.">▤ ${p.wins}W–${p.losses}L${p.draws ? `–${p.draws}D` : ""}</a>` : "";
    const tempo = p.winTurns != null ? `<span class="lad-stat" title="Mean turns taken in the ${p.wonMatches} match(es) this model won. Career figure, shown as information: a challenge is settled on the speed inside that duel, not on this average.">⚔ wins in ${p.winTurns.toFixed(0)}</span>` : "";
    const today = p.usdPerMatchToday;
    const drift = today != null && p.usdPerMatch ? Math.abs(today - p.usdPerMatch) / p.usdPerMatch : 0;
    const nowCell = drift > 0.05 ? ` <span class="lad-now" title="The same matches re-priced at the rates in force today, keeping the discount each match actually received (prompt caching included). The provider moved its price after these matches were played; the figure on the left is what was really paid.">→ ${fmtUsd(today)} today</span>` : "";
    const pt = own(data.pricing_today, model) || {};
    const discount = num(pt.discount);
    const listPerMatch = discount && discount < 1 && (today != null || p.usdPerMatch != null) ? (today != null ? today : p.usdPerMatch) / (1 - discount) : null;
    const promo = discount ? ` <span class="lad-promo" title="This model's pinned endpoint is on a promotion right now: $${num(pt.input)}/$${num(pt.output)} per 1M against a list price of $${num(pt.list_input)}/$${num(pt.list_output)}. ${listPerMatch != null ? `At list price these same matches average ${fmtUsd(listPerMatch)}. ` : ""}The discount is a date, not a price: it expires.">PROMO −${Math.round(discount * 100)}%</span>` : "";
    const cost = p.usdPerMatch != null ? `<span class="lad-stat${p.allReported ? "" : " estimated"}" title="${p.allReported ? "Average USD per match, as charged by the provider on the day it was played" : "Average USD per match: at least one match had no provider-reported cost and fell back to an estimate"}">💲 ${fmtUsd(p.usdPerMatch)}${nowCell}${promo}</span>` : "";
    const prov = p.providers.length === 1 ? `<span class="lad-stat prov" title="Every call was served by this endpoint">${esc(p.providers[0])}</span>` : p.providers.length > 1 ? `<span class="lad-stat prov warn" title="Served by more than one endpoint: the provider pin did not hold, so latency and cost mix backends">⚠ ${esc(p.providers.join(", "))}</span>` : "";
    const ill = p.illegalRate != null ? `<span class="lad-stat" title="Share of submitted actions the engine rejected for a reason the model could have foreseen: ${p.illegal} action(s)">⚠ ${(p.illegalRate * 100).toFixed(1)}% illegal</span>` : "";
    const fog = p.fog ? `<span class="lad-stat muted" title="Actions rejected by something outside the model's field of view (a hidden unit on the destination, an undiscovered building on the line of fire). Not counted as illegal: bumping into the unknown is how a fog-of-war game reveals the board.">🌫 ${p.fog} fog-blocked</span>` : "";
    return rec + lat + tempo + cost + ill + fog + prov;
  }
  function quantBadge(q) {
    if (!q) return "";
    const unknown = q === "unknown";
    const title = unknown ? "The provider does not publish the numeric precision it serves. Normal for a closed model: it can be neither chosen nor verified." : `Numeric precision of the pinned endpoint. Lower precision costs capability, and this model plays at ${q} because that is what the endpoint it is pinned to serves, shown next to its record.`;
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
  const PAGE_WIDE = { legs: 12, log: 8 };
  const PAGE_NARROW = { legs: 6, log: 3 };
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
             <th class="num" title="Mean turns taken in the matches this model WON: shorter means it closed them out faster">Win in</th>
             <th class="num" title="Mean turns taken in the matches this model LOST: longer means it held out longer">Lost in</th>
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
    if (!list.length) {
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
    const from = e.left_from_rank ? `<span class="lad-rank" title="The rung it was holding when it left">#${num(e.left_from_rank)}</span>` : "";
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
    const label = l.outcome === "draw" ? l.victory_type === "mutual_destruction" ? `${esc(name(l.a))} and ${esc(name(l.b))} destroyed each other` : `${esc(name(l.a))}, ${esc(name(l.b))} drew` : `${esc(name(l.outcome === "a" ? l.a : l.b))} beat ${esc(name(l.outcome === "a" ? l.b : l.a))}`;
    const vt = vtLabel(l.victory_type);
    if (!l.match_id) {
      return `<div class="leg sim" title="Fabricated for this preview: no such match was ever played">
                ${label} · ${vt}<span class="leg-sim">SIM</span></div>`;
    }
    return `<a class="leg" href="../viewer.html?match=${encodeURIComponent(l.match_id)}"
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
           <div class="ts"><b>${top.seeded ? "–" : num(top.climbed)}</b><span>places climbed</span></div>
         </div>
       </div>`;
  }
  function originBadge(e) {
    if (e.via === "opening") {
      return '<span class="lad-badge from-opening" title="Place won in the opening round-robin, not by challenging in">OPENING</span>';
    }
    if (e.seeded) {
      return '<span class="lad-badge seeded" title="Placed when the ladder was created, not won on the board">SEEDED</span>';
    }
    return `<span class="lad-badge climbed" title="Rungs won on the way in">▲ ${num(e.climbed)}</span>`;
  }
  function renderBoard() {
    const el = document.getElementById("lad-board");
    if (!(data.ladder || []).length) {
      el.innerHTML = '<div class="empty-state">The ladder is empty until the opening is played.</div>';
      return;
    }
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
  function renderLatest() {
    const el = document.getElementById("latest-challenge");
    const c = (data.challenges || [])[0];
    if (!c) {
      el.innerHTML = '<div class="empty-state">No challenge yet: the queue starts once the ladder exists.</div>';
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
    const verdictClass = rank === 1 ? "takes-throne" : rank ? "enters" : "fails";
    const verdict = rank === 1 ? "takes the throne" : rank ? `enters at #${num(rank)}` : "fails to enter";
    const displaced = c.displaced ? `<span class="chal-displaced">${esc(c.displaced)} drops off</span>` : "";
    const rungs = c.steps.length;
    const legs = c.steps.reduce((n, s) => n + s.legs.length, 0);
    return `<div class="chal ${expanded ? "open" : ""}">
      <div class="chal-head">
        <span class="chal-date">${fmtDate(c.date)}</span>
        <span class="chal-name">${flag(c.challenger.model)}${esc(c.challenger.display_name)} ${effortBadge(c.challenger.reasoning_effort)}${quantBadge(c.challenger.quantization)}</span>
        <span class="chal-verdict ${verdictClass}">${verdict}</span>
        ${displaced}
        <span class="chal-count" title="One card per rung challenged. Every rung is a two-leg tie, the same pair, sides swapped, so ${rungs} rungs means ${legs} matches.">${rungs} rung${rungs === 1 ? "" : "s"} · ${legs} match${legs === 1 ? "" : "es"}</span>
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
        <div class="climb">${c.steps.map(stepCard).join('<div class="climb-arrow">→</div>')}</div>
      </div>
    </div>`;
  }
  function stepCard(s) {
    const won = s.result === "win";
    const [pc, pi] = s.pts;
    const note = s.decided_by && s.decided_by !== "points" ? `<span class="step-note">${esc(s.decided_by)}</span>` : "";
    return `<div class="step ${won ? "won" : "lost"}">
      <div class="step-head">
        <span class="step-rank">#${num(s.rank)}</span>
        <span class="step-opp">${flag(s.opponent.model)}${esc(s.opponent.display_name)}</span>
        <span class="step-score">${fmtPts(pc)}–${fmtPts(pi)}</span>
      </div>
      ${note}
      <div class="step-legs">${s.legs.map(legChip).join("")}</div>
    </div>`;
  }
  function legChip(l, i) {
    const side = l.challenger_side === 0 ? '<span class="badge-p0" title="Challenger played player 1">P1</span>' : '<span class="badge-p1" title="Challenger played player 2">P2</span>';
    const res = l.outcome === "challenger" ? '<span class="leg-w">won</span>' : l.outcome === "incumbent" ? '<span class="leg-l">lost</span>' : l.victory_type === "mutual_destruction" ? '<span class="leg-l" title="Mutual destruction scores 0 for both, like a loss: it is not a draw">both lost</span>' : '<span class="leg-d">drew</span>';
    const vt = vtLabel(l.victory_type);
    const turns = l.turns ? `${num(l.turns)}t` : "";
    const body = `${side} ${res} · ${vt} ${turns}`;
    if (l.source === "simulated") {
      return `<div class="leg sim" title="Fabricated for this preview: no such match was ever played">
                ${body}<span class="leg-sim">SIM</span></div>`;
    }
    return `<a class="leg" href="../viewer.html?match=${encodeURIComponent(l.match_id)}"
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
    el.innerHTML = rs.map((r) => {
      const a = new Date(r.from).getTime();
      const b = r.to ? new Date(r.to).getTime() : end;
      const left = (a - start) / span * 100;
      const width = Math.max(2, (b - a) / span * 100);
      const days = daysBetween(r.from, r.to || todayISO());
      return `<div class="reign">
        <div class="reign-name">${flag(r.model)}${esc(r.display_name)}${r.seeded ? '<span class="lad-badge seeded">SEEDED</span>' : ""}</div>
        <div class="reign-track">
          <div class="reign-bar ${r.to ? "" : "current"}" style="left:${left}%;width:${width}%"
               title="${fmtRange(r.from, r.to || todayISO())}${r.to ? "" : " (archive frozen)"}"></div>
        </div>
        <div class="reign-days">${days} d${num(r.defences) ? ` · ${num(r.defences)} def.` : ""}</div>
      </div>`;
    }).join("");
  }
  function bindFilter() {
    const inp = document.getElementById("f-chal");
    if (!inp) return;
    inp.addEventListener("input", () => {
      logFilter = inp.value.trim().toLowerCase();
      renderLog();
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
  const FROZEN_ON = "2026-09-05";
  function todayISO() {
    return FROZEN_ON;
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
