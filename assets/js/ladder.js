/*
 * ladder.js — renders data/ladder.json: the standing top-N, the climb of each
 * challenger, and the succession of reigns.
 *
 * The file is written by run_ladder.py (real matches) or by
 * scripts/preview_ladder.py (fabricated preview). When it carries
 * "preview": true this page says so, loudly, at the top.
 */

(function () {
  'use strict';

  const META = window.MODEL_META || {};
  const effortBadge = window.effortBadge || (() => '');

  const VT_LABEL = {
    nuclear: 'Nuclear', military: 'Military', ultimatum: 'Ultimatum',
    peace: 'Peace', mutual_destruction: 'Mutual destr.', timeout: 'Timeout',
  };

  let data = null;
  let logFilter = '';
  let perfByModel = {};      // model -> aggregated cost / latency / provider

  async function init() {
    try {
      const res = await fetch('data/ladder.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      data = await res.json();
    } catch (e) {
      document.getElementById('lad-board').innerHTML =
        '<div class="empty-state">No data/ladder.json yet. Generate a preview with ' +
        '<code>python scripts/preview_ladder.py</code>.</div>';
      return;
    }

    const ver = document.getElementById('lad-ver');
    // Labelled on purpose: an unlabelled "v0.17.0" invites the reader to think
    // the rules changed when only the site did. This badge is the RULES version
    // — the one that says whether these matches are comparable to each other.
    if (ver) ver.textContent = data.engine_version ? 'game engine ' + data.engine_version : 'ladder';
    const site = document.getElementById('lad-site');
    if (site && data.site_version) site.textContent = 'site v' + data.site_version;

    aggregatePerf();
    renderBanner();
    renderRules();
    renderOpening();
    renderThrone();
    renderBoard();
    renderLatest();
    renderLog();
    renderReigns();
    bindFilter();
  }

  // ── measured per-model figures ───────────────────────────────────────────
  // Cost and latency are aggregated from the legs rather than stored per model,
  // so the JSON keeps one source of truth. Only the PROVIDER-REPORTED cost is
  // shown: the price x token estimate is kept in the replays for comparison but
  // it cannot see prompt caching and reads high, so publishing it would be
  // publishing a number we know to be wrong.
  function aggregatePerf() {
    const acc = {};
    const eat = (leg, win, lose) => {
      const perf = leg && leg.perf;
      if (!perf) return;
      for (const [model, p] of Object.entries(perf)) {
        const a = acc[model] || (acc[model] = {
          usd: 0, matches: 0, thinkSum: 0, thinkN: 0, providers: new Set(),
          reported: 0, ok: 0, illegal: 0, fog: 0, winTurns: [], lossTurns: [],
        });
        if (typeof p.usd === 'number') { a.usd += p.usd; a.matches += 1; }
        if (p.cost_source === 'provider') a.reported += 1;
        if (typeof p.think_ms === 'number' && p.half_turns) {
          a.thinkSum += p.think_ms * p.half_turns;
          a.thinkN += p.half_turns;
        }
        // Rejected actions, split by whether the model could have avoided it.
        // Only the avoidable ones are a rule-following signal; a move into a
        // cell held by a unit it could not see is the fog doing its job.
        a.ok += p.actions_ok || 0;
        a.illegal += p.illegal || 0;
        a.fog += p.fog_blocked || 0;
        if (p.served_by) [].concat(p.served_by).forEach((x) => a.providers.add(x));
      }
      // Turns to win / to lose. The winning model is named differently by the
      // two leg shapes — the opening says "a"/"b", a challenge says
      // "challenger"/"incumbent" — so the caller resolves it and passes the
      // slugs in. Draws count for neither: nobody closed the match out.
      if (typeof leg.turns === 'number' && win && lose) {
        (acc[win] || {}).winTurns?.push(leg.turns);
        (acc[lose] || {}).lossTurns?.push(leg.turns);
      }
    };
    ((data.opening || {}).legs || []).forEach((leg) => {
      const w = leg.outcome === 'a' ? leg.a : leg.outcome === 'b' ? leg.b : null;
      eat(leg, w, w ? (w === leg.a ? leg.b : leg.a) : null);
    });
    (data.challenges || []).forEach((c) => c.steps.forEach((st) => st.legs.forEach((leg) => {
      const ch = (c.challenger || {}).model;
      const inc = ((st.opponent) || {}).model;
      const w = leg.outcome === 'challenger' ? ch : leg.outcome === 'incumbent' ? inc : null;
      eat(leg, w, w ? (w === ch ? inc : ch) : null);
    })));

    perfByModel = {};
    for (const [model, a] of Object.entries(acc)) {
      perfByModel[model] = {
        usdPerMatch: a.matches ? a.usd / a.matches : null,
        thinkMs: a.thinkN ? a.thinkSum / a.thinkN : null,
        matches: a.matches,
        // More than one provider means the pin failed somewhere in the season.
        providers: [...a.providers],
        allReported: a.matches > 0 && a.reported === a.matches,
        illegal: a.illegal,
        fog: a.fog,
        illegalRate: (a.ok + a.illegal) ? a.illegal / (a.ok + a.illegal) : null,
        winTurns: a.winTurns.length
          ? a.winTurns.reduce((s, x) => s + x, 0) / a.winTurns.length : null,
        wins: a.winTurns.length,
        losses: a.lossTurns.length,
      };
    }
  }

  function perfCells(model) {
    const p = perfByModel[model];
    if (!p) return '';
    const lat = p.thinkMs != null
      ? `<span class="lad-stat" title="Mean thinking time per played turn, measured across ${p.matches} match(es) on a pinned provider">⏱ ${fmtMs(p.thinkMs)}</span>` : '';
    // Win-loss record over everything this model has played here. A ladder rank
    // says "nobody has beaten me at this rung", which on day one — when the
    // opening is the only thing that happened — tells the reader nothing about
    // how the four got there. The record does, and it links to the matches.
    const rec = (p.wins + p.losses)
      ? `<a class="lad-stat rec" href="#opening-history" title="Record across every match played on this ladder. Click to open the match list and the replays.">▤ ${p.wins}W–${p.losses}L</a>` : '';
    // Tempo. It settles the opening table when points, wins and head-to-head
    // are all level, and since site 0.17.1 it settles a level challenge too.
    const tempo = p.winTurns != null
      ? `<span class="lad-stat" title="Mean turns taken in the ${p.wins} match(es) this model won. Career figure, shown as information — a challenge is settled on the speed inside that duel, not on this average.">⚔ wins in ${p.winTurns.toFixed(0)}</span>` : '';
    const cost = p.usdPerMatch != null
      ? `<span class="lad-stat${p.allReported ? '' : ' estimated'}" title="${p.allReported
          ? 'Average USD per match, as charged by the provider'
          : 'Average USD per match — at least one match had no provider-reported cost and fell back to an estimate'}">💲 ${fmtUsd(p.usdPerMatch)}</span>` : '';
    const prov = p.providers.length === 1
      ? `<span class="lad-stat prov" title="Every call was served by this endpoint">${esc(p.providers[0])}</span>`
      : p.providers.length > 1
        ? `<span class="lad-stat prov warn" title="Served by more than one endpoint — the provider pin did not hold, so latency and cost mix backends">⚠ ${esc(p.providers.join(', '))}</span>`
        : '';
    // Two separate numbers on purpose. "illegal" is the rule-following signal:
    // actions the model had every element in its observation to get right.
    // "fog" is shown next to it, greyed, so the reader can see it exists and
    // that it is deliberately NOT held against the model.
    const ill = p.illegalRate != null
      ? `<span class="lad-stat" title="Share of submitted actions the engine rejected for a reason the model could have foreseen — ${p.illegal} action(s)">⚠ ${(p.illegalRate * 100).toFixed(1)}% illegal</span>` : '';
    const fog = p.fog
      ? `<span class="lad-stat muted" title="Actions rejected by something outside the model's field of view (a hidden unit on the destination, an undiscovered building on the line of fire). Not counted as illegal: bumping into the unknown is how a fog-of-war game reveals the board.">🌫 ${p.fog} fog-blocked</span>` : '';
    return rec + lat + tempo + cost + ill + fog + prov;
  }

  // Quantization is published because it is not equal across the field and
  // cannot be made equal: three of four models are closed and report "unknown".
  // Hiding that would let a reader assume a level playing field that does not
  // exist. "unknown" is rendered as a fact, not as a gap.
  function quantBadge(q) {
    if (!q) return '';
    const unknown = q === 'unknown';
    const title = unknown
      ? 'The provider does not publish the numeric precision it serves. Normal for a closed model — it can be neither chosen nor verified.'
      : `Numeric precision of the pinned endpoint. Lower precision costs capability, and this model plays at ${q} because that is what its own lab serves.`;
    return `<span class="lad-quant${unknown ? ' unknown' : ''}" title="${esc(title)}">${esc(q)}</span>`;
  }

  function fmtMs(ms) {
    const s = ms / 1000;
    return s >= 10 ? s.toFixed(0) + 's' : s.toFixed(1) + 's';
  }
  function fmtUsd(v) {
    return v >= 1 ? '$' + v.toFixed(2) : '$' + v.toFixed(v >= 0.01 ? 3 : 4);
  }

  // ── header bits ──────────────────────────────────────────────────────────

  function renderBanner() {
    if (!data.preview) return;
    document.getElementById('preview-banner').innerHTML =
      `<div class="preview-banner">
         <span class="pb-tag">PREVIEW</span>
         <span>${esc(data.note || 'Fabricated data — not a result.')}</span>
       </div>`;
  }

  function renderRules() {
    const r = data.rules || {};
    const bits = [
      `${r.rungs || 4} places`,
      'one pinned provider per model',
      `${r.legs_per_tie || 2} legs per rung, sides swapped`,
      'level on points → the faster win takes the rung',
      // Not "one defeat": run_ladder breaks on any result that is not a win, so
      // failing to take a rung ends the climb just as a defeat does. And not
      // "the first tie not won" either — "tie" means the two-leg duel here but
      // "level tie" in the chip above means a draw, and one word cannot do both
      // jobs in two neighbouring chips without misleading everyone.
      'a rung it does not take ends the climb',
    ];
    document.getElementById('lad-rules').innerHTML =
      bits.map((b) => `<span class="lad-rule">${esc(b)}</span>`).join('');
  }

  // ── the opening ──────────────────────────────────────────────────────────
  // The four places are played for, not decreed. Until that round-robin is
  // finished there is no standing to show, and the page says so rather than
  // rendering an empty board.

  function renderOpening() {
    // Pending, the opening IS the page — nothing else has happened yet, so it
    // sits at the top. Once played it becomes the ladder's origin story: it
    // moves to the bottom and collapses to one line. Six months and a dozen
    // challenges later, none of those four models may still be on the board,
    // and a full round-robin table from the first day would be the loudest
    // thing on a page about who is best today.
    const top = document.getElementById('opening-section');
    const hist = document.getElementById('opening-history');
    const op = data.opening;
    top.innerHTML = '';
    if (hist) hist.innerHTML = '';
    if (!op) return;
    const el = op.status === 'pending' ? top : (hist || top);

    if (op.status === 'pending') {
      el.innerHTML =
        `<div class="lb-section-title">Opening</div>
         <div class="opening pending">
           <div class="opening-lead">
             <b>${op.matches_to_play || 0} matches to play.</b>
             These four models meet each other home and away; the table they
             produce becomes the ladder. Nothing is placed by decree.
           </div>
           <div class="opening-models">
             ${(op.models || []).map((m) =>
               `<span class="opening-model">${flag(m.model)}${esc(m.display_name)} ${effortBadge(m.reasoning_effort)}${quantBadge(m.quantization)}${author(m.model)}</span>`).join('')}
           </div>
         </div>`;
      return;
    }

    const champion = (op.table || [])[0];
    // Collapsed once challenges exist — the opening is then provenance. Until
    // then it is the ONLY thing that has happened, and hiding it leaves a reader
    // with four names and no evidence, so it opens by default.
    const firstDay = !((data.challenges || []).length);
    el.innerHTML =
      `<div class="lb-section-title">Opening</div>
       <div class="opening done">
         <button class="opening-toggle" aria-expanded="${firstDay}">
           <span class="opening-chevron">${firstDay ? '▼' : '▶'}</span>
           <span>How the ladder started</span>
           <span class="opening-summary">${fmtDate(op.date)} · ${(op.legs || []).length} matches
             · ${champion ? esc(champion.display_name) + ' took #1' : ''}</span>
         </button>
         <div class="opening-detail${firstDay ? ' open' : ''}">
         <table class="lb opening-table">
           <thead><tr><th>#</th><th>Model</th><th class="num">Pts</th>
             <th class="num">W</th><th class="num">D</th><th class="num">L</th>
             <th class="num" title="Mean turns taken in the matches this model WON — shorter means it closed them out faster">Win in</th>
             <th class="num" title="Mean turns taken in the matches this model LOST — longer means it held out longer">Lost in</th>
             <th title="Only filled when points and wins were level: which criterion settled the order">Settled by</th></tr></thead>
           <tbody>${(op.table || []).map((r) =>
             `<tr><td>${r.rank}</td>
                  <td>${flag(r.model)}${esc(r.display_name)} ${effortBadge(r.reasoning_effort)}${quantBadge(r.quantization)}${author(r.model)}</td>
                  <td class="num">${fmtPts(r.pts)}</td>
                  <td class="num">${r.w}</td><td class="num">${r.d}</td><td class="num">${r.l}</td>
                  <td class="num">${r.avg_win_turns != null ? r.avg_win_turns : '—'}</td>
                  <td class="num">${r.avg_loss_turns != null ? r.avg_loss_turns : '—'}</td>
                  <td class="tiebreak${r.tiebreak && r.tiebreak.indexOf('unresolved') === 0 ? ' warn' : ''}">${r.tiebreak ? esc(r.tiebreak) : ''}</td>
              </tr>`).join('')}</tbody>
         </table>
         <div class="opening-legs">${(op.legs || []).map(openingLeg).join('')}</div>
         </div>
       </div>`;
    const btn = el.querySelector('.opening-toggle');
    if (btn) btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      btn.querySelector('.opening-chevron').textContent = open ? '▶' : '▼';
      el.querySelector('.opening-detail').classList.toggle('open', !open);
    });
  }

  function openingLeg(l) {
    const name = (m) => {
      const row = (data.opening.models || []).find((x) => x.model === m);
      return row ? row.display_name : m;
    };
    const label = l.outcome === 'draw'
      ? `${esc(name(l.a))} — ${esc(name(l.b))} drew`
      : `${esc(name(l.outcome === 'a' ? l.a : l.b))} beat ${esc(name(l.outcome === 'a' ? l.b : l.a))}`;
    const vt = `<span class="vt vt-${esc(l.victory_type)}">${VT_LABEL[l.victory_type] || esc(l.victory_type)}</span>`;
    if (!l.match_id) {
      return `<div class="leg sim" title="Fabricated for this preview — no such match was ever played">
                ${label} · ${vt}<span class="leg-sim">SIM</span></div>`;
    }
    return `<a class="leg" href="viewer.html?match=${encodeURIComponent(l.match_id)}"
               title="Watch the replay">${label} · ${vt}<span class="leg-play">▶</span></a>`;
  }

  // ── the throne ───────────────────────────────────────────────────────────

  function renderThrone() {
    const el = document.getElementById('throne');
    const top = (data.ladder || [])[0];
    if (!top) {
      el.innerHTML = '<div class="empty-state">No champion yet — the opening has not been played.</div>';
      return;
    }
    const reign = (data.reigns || []).filter((x) => x.to === null).pop()
      || (data.reigns || [])[data.reigns.length - 1];
    const since = reign ? reign.from : top.entered_at;
    const days = daysBetween(since, todayISO());

    el.innerHTML =
      `<div class="throne">
         <div class="throne-crown">👑</div>
         <div class="throne-main">
           <div class="throne-name">${flag(top.model)}${esc(top.display_name)} ${effortBadge(top.reasoning_effort)}${author(top.model)}</div>
           <div class="throne-sub">Champion since ${fmtDate(since)}</div>
         </div>
         <div class="throne-stats">
           <div class="ts"><b>${days}</b><span>days held</span></div>
           <div class="ts"><b>${reign ? reign.defences : 0}</b><span>defence${(reign && reign.defences) === 1 ? '' : 's'}</span></div>
           <div class="ts"><b>${top.seeded ? '—' : top.climbed}</b><span>rungs climbed</span></div>
         </div>
       </div>`;
  }

  // ── the standing ─────────────────────────────────────────────────────────

  function renderBoard() {
    const el = document.getElementById('lad-board');
    if (!(data.ladder || []).length) {
      el.innerHTML = '<div class="empty-state">The ladder is empty until the opening is played.</div>';
      return;
    }
    el.innerHTML = (data.ladder || []).map((e) => {
      const badge = e.via === 'opening'
        ? '<span class="lad-badge from-opening" title="Place won in the opening round-robin">OPENING</span>'
        : e.seeded
          ? '<span class="lad-badge seeded" title="Placed when the ladder was created — not won on the board">SEEDED</span>'
          : `<span class="lad-badge climbed" title="Rungs won on the way in">▲ ${e.climbed}</span>`;
      return `<div class="lad-row rank-${e.rank}">
                <div class="lad-rank">#${e.rank}</div>
                <div class="lad-model"><span class="lad-name">${flag(e.model)}${esc(e.display_name)}</span>${effortBadge(e.reasoning_effort)}${quantBadge(e.quantization)}${badge}</div>
                <div class="lad-meta">
                  ${perfCells(e.model)}
                  <span title="Date this model took the place">${e.seeded ? 'seeded ' : 'entered '}${fmtDate(e.entered_at)}</span>
                  <span title="Challenges survived at this rung">${e.holds} hold${e.holds === 1 ? '' : 's'}</span>
                </div>
              </div>`;
    }).join('');
  }

  // ── challenges ───────────────────────────────────────────────────────────

  function renderLatest() {
    const el = document.getElementById('latest-challenge');
    const c = (data.challenges || [])[0];
    if (!c) {
      el.innerHTML = '<div class="empty-state">No challenge yet — the queue starts once the ladder exists.</div>';
      return;
    }
    el.innerHTML = challengeCard(c, true);
  }

  function renderLog() {
    const el = document.getElementById('lad-log');
    const list = (data.challenges || []).filter((c) => {
      if (!logFilter) return true;
      const hay = (c.challenger.display_name + ' ' +
        c.steps.map((s) => s.opponent.display_name).join(' ')).toLowerCase();
      return hay.includes(logFilter);
    });
    if (!list.length) { el.innerHTML = '<div class="empty-state">No challenge matches.</div>'; return; }
    el.innerHTML = list.map((c) => challengeCard(c, false)).join('');
    el.querySelectorAll('.chal-head').forEach((h) => {
      h.addEventListener('click', () => {
        const card = h.closest('.chal');
        card.classList.toggle('open');
      });
    });
  }

  function challengeCard(c, expanded) {
    const rank = c.final_rank;
    const verdictClass = rank === 1 ? 'takes-throne' : rank ? 'enters' : 'fails';
    const verdict = rank === 1
      ? 'takes the throne'
      : rank ? `enters at #${rank}` : 'fails to enter';
    const displaced = c.displaced
      ? `<span class="chal-displaced">${esc(c.displaced)} drops off</span>` : '';
    const legs = c.steps.reduce((n, s) => n + s.legs.length, 0);

    return `<div class="chal ${expanded ? 'open' : ''}">
      <div class="chal-head">
        <span class="chal-date">${fmtDate(c.date)}</span>
        <span class="chal-name">${flag(c.challenger.model)}${esc(c.challenger.display_name)} ${effortBadge(c.challenger.reasoning_effort)}</span>
        <span class="chal-verdict ${verdictClass}">${verdict}</span>
        ${displaced}
        <span class="chal-count">${legs} match${legs === 1 ? '' : 'es'}</span>
        <span class="chal-chevron">▾</span>
      </div>
      <div class="chal-body">
        <div class="climb">${c.steps.map(stepCard).join('<div class="climb-arrow">→</div>')}</div>
      </div>
    </div>`;
  }

  function stepCard(s) {
    const won = s.result === 'win';
    const [pc, pi] = s.pts;
    // Why a rung changed hands, or did not. A 3-3 next to a challenger that
    // climbed is the one thing a reader cannot work out from the score alone,
    // so the engine records the reason and the card prints it verbatim.
    const note = s.decided_by && s.decided_by !== 'points'
      ? `<span class="step-note">${esc(s.decided_by)}</span>` : '';
    return `<div class="step ${won ? 'won' : 'lost'}">
      <div class="step-head">
        <span class="step-rank">#${s.rank}</span>
        <span class="step-opp">${flag(s.opponent.model)}${esc(s.opponent.display_name)}</span>
        <span class="step-score">${fmtPts(pc)}–${fmtPts(pi)}</span>
      </div>
      ${note}
      <div class="step-legs">${s.legs.map(legChip).join('')}</div>
    </div>`;
  }

  function legChip(l, i) {
    const side = l.challenger_side === 0
      ? '<span class="badge-p0" title="Challenger played player 1">P1</span>'
      : '<span class="badge-p1" title="Challenger played player 2">P2</span>';
    const res = l.outcome === 'challenger' ? '<span class="leg-w">won</span>'
      : l.outcome === 'incumbent' ? '<span class="leg-l">lost</span>'
        : '<span class="leg-d">drew</span>';
    const vt = `<span class="vt vt-${esc(l.victory_type)}">${VT_LABEL[l.victory_type] || esc(l.victory_type)}</span>`;
    const turns = l.turns ? `${l.turns}t` : '';
    const body = `${side} ${res} · ${vt} ${turns}`;
    if (l.source === 'simulated') {
      return `<div class="leg sim" title="Fabricated for this preview — no such match was ever played">
                ${body}<span class="leg-sim">SIM</span></div>`;
    }
    return `<a class="leg" href="viewer.html?match=${encodeURIComponent(l.match_id)}"
               title="Watch the replay">${body}<span class="leg-play">▶</span></a>`;
  }

  // ── reigns ───────────────────────────────────────────────────────────────

  function renderReigns() {
    const el = document.getElementById('lad-reigns');
    const rs = data.reigns || [];
    if (!rs.length) { el.innerHTML = '<div class="empty-state">No reign yet.</div>'; return; }

    // The track ends today, or later if a reign was closed with a date ahead of
    // the reader's clock — otherwise that bar would run off the end of it.
    const start = new Date(rs[0].from).getTime();
    const last = rs.reduce((m, r) => Math.max(m, new Date(r.to || 0).getTime() || 0), 0);
    const end = Math.max(new Date(todayISO()).getTime(), last, start + 86400000);
    const span = end - start;

    el.innerHTML = rs.map((r) => {
      const a = new Date(r.from).getTime();
      const b = r.to ? new Date(r.to).getTime() : end;
      const left = ((a - start) / span) * 100;
      const width = Math.max(2, ((b - a) / span) * 100);
      const days = daysBetween(r.from, r.to || todayISO());
      return `<div class="reign">
        <div class="reign-name">${flag(r.model)}${esc(r.display_name)}${r.seeded ? '<span class="lad-badge seeded">SEEDED</span>' : ''}</div>
        <div class="reign-track">
          <div class="reign-bar ${r.to ? '' : 'current'}" style="left:${left}%;width:${width}%"
               title="${fmtDate(r.from)} → ${r.to ? fmtDate(r.to) : 'now'}"></div>
        </div>
        <div class="reign-days">${days} d${r.defences ? ` · ${r.defences} def.` : ''}</div>
      </div>`;
    }).join('');
  }

  // ── plumbing ─────────────────────────────────────────────────────────────

  function bindFilter() {
    const inp = document.getElementById('f-chal');
    if (!inp) return;
    inp.addEventListener('input', () => {
      logFilter = inp.value.trim().toLowerCase();
      renderLog();
    });
  }

  function flag(id) {
    const m = META[id];
    return m && m.flag ? m.flag + ' ' : '';
  }
  function author(id) {
    const m = META[id];
    return m && m.author ? `<span class="model-author">${esc(m.author)}</span>` : '';
  }
  function fmtPts(v) { return Number(v).toFixed(v % 1 ? 1 : 0); }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function daysBetween(a, b) {
    const d = (new Date(b).getTime() - new Date(a).getTime()) / 86400000;
    return Number.isFinite(d) ? Math.max(0, Math.round(d)) : 0;
  }
  function fmtDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('en-GB',
        { day: '2-digit', month: 'short', year: 'numeric' });
    } catch { return iso; }
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  document.addEventListener('DOMContentLoaded', init);
})();
