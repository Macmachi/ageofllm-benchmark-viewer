/*
 * ladder.js — renders data/ladder.json: the champion, the line behind it, every
 * challenge played for the throne, and the succession of reigns.
 *
 * TWO FORMATS, and `rules.format` in the JSON is what says which. Under
 * `throne` a challenger plays the champion and only the champion, so the seats
 * below the first were never played for and this page must NOT draw them as a
 * ranking: no rank numbers, no podium colours, no "climbed" badge. They are a
 * line of succession. Under `gauntlet` — the first season, and every challenge
 * record written before site 0.18.0 — the challenger climbed rung by rung and
 * the standing IS an order, so that wording is kept for those.
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

  // The season's format. Read, never inferred: a gauntlet season in which every
  // challenger lost its opening tie leaves a challenge log shaped exactly like
  // a throne season's, and guessing wrong relabels history.
  const isThrone = () => (((data || {}).rules) || {}).format === 'throne';

  // Per CHALLENGE, because the log outlives the format it was played under. No
  // `format` key means it predates site 0.18.0, and everything before that was
  // a gauntlet climb.
  const chalThrone = (c) => (c.format || 'gauntlet') === 'throne';
  // null until the first render, then whatever the reader last chose. Kept out
  // of the DOM so paging the legs can re-render without closing the panel.
  let openingOpen = null;
  let droppedOpen = false;   // collapsed: the board is the news, this is its past
  let perfByModel = {};      // model -> aggregated cost / latency / provider

  // The reign this model held, if it ever held one. Under `throne` this is the
  // only thing a seat below the first can honestly be labelled with.
  function reignOf(model) {
    return (data.reigns || []).filter((r) => r.model === model).pop() || null;
  }

  // Whoever the current champion took the crown from, or null if it won the
  // opening and there was nobody to take it from.
  function predecessor() {
    const rs = data.reigns || [];
    return rs.length > 1 ? rs[rs.length - 2].display_name : null;
  }

  // The page explains its own format in three places. Both variants live here
  // rather than in index.html so that a preview built with --format gauntlet,
  // or the archived first season, describes itself correctly instead of
  // inheriting whatever the static page happened to be written for.
  const COPY = {
    throne: {
      tagline: 'One champion. Beat it over two matches and the crown is yours.',
      sub: 'There is one thing to win here: <strong>the throne</strong>. A new '
        + 'model does not join a standing and it does not climb — it plays the '
        + 'reigning champion, <strong>two matches, one from each side of the '
        + 'map</strong>, and either takes the crown or goes home. '
        + '<span class="lb-sub-tie"><strong>One win each</strong> — the crown '
        + 'goes to whichever model won in fewer turns. <strong>Two draws</strong> '
        + '— the champion keeps it.</span>',
      boardTitle: 'The line',
      boardNote: 'Not a ranking, and not a top 4. Only the first seat is ever '
        + 'played for, so nothing here means "better than the name under it" — '
        + 'this is who came before the champion, most recent first.',
      boardNoteTitle: 'Under the throne format a challenger meets the champion '
        + 'and nobody else. A model that loses that tie earns no seat at all, '
        + 'and no seat below the first has ever been contested. Ordering these '
        + 'names by strength would be a claim no match on this site supports.',
    },
    gauntlet: {
      tagline: 'The current standing — four places, held until someone takes them',
      sub: 'Four places. A new model does not join the ladder — it challenges in '
        + 'at the bottom: <strong>two matches against #4, one from each side of '
        + 'the map</strong>. Win both and it moves up to face #3, then #2, then '
        + '#1. As soon as it fails to take a place, the climb stops there and it '
        + 'keeps the last place it won. <span class="lb-sub-tie"><strong>One win '
        + 'each</strong> — the place goes to whichever model won in fewer turns. '
        + '<strong>Two draws</strong> — the model already there keeps its place.'
        + '</span>',
      boardTitle: 'Standing',
      boardNote: 'Seeded once by the opening table, then held until a challenger '
        + 'wins the tie for it.',
      boardNoteTitle: 'Points set this order once and do not touch it again. The '
        + 'opening round-robin was scored on points and its top 4 became these '
        + 'places; from then on a place changes hands only when a challenger '
        + 'wins the two-leg tie played for it.',
    },
  };

  function renderCopy() {
    const c = COPY[isThrone() ? 'throne' : 'gauntlet'];
    const set = (id, html, title) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = html;
      if (title) el.setAttribute('title', title);
    };
    set('lb-tagline', c.tagline);
    set('lb-sub', c.sub);
    set('board-title', c.boardTitle);
    set('board-note', c.boardNote, c.boardNoteTitle);
  }

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
          usd: 0, usdToday: 0, usdTodayN: 0,
          matches: 0, thinkSum: 0, thinkN: 0, providers: new Set(),
          reported: 0, ok: 0, illegal: 0, fog: 0, winTurns: [], lossTurns: [],
          w: 0, l: 0, d: 0,
        });
        if (typeof p.usd === 'number') { a.usd += p.usd; a.matches += 1; }
        // The same match at today's prices. Counted separately so a partial
        // set never averages into a figure that looks complete.
        if (typeof p.usd_today === 'number') { a.usdToday += p.usd_today; a.usdTodayN += 1; }
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
      // THE RECORD. Counted separately from the turns below, because the two
      // ask different questions and used to share one answer: wins and losses
      // were read off the LENGTH of the turn arrays, so any match without a
      // winner counted for neither side and a model that had played two matches
      // could show "0W-1L".
      //
      // Mutual destruction is a LOSS FOR BOTH — the same rule ladder_core.py
      // and generate_stats.py apply. It is the one outcome with no winner that
      // is nonetheless nobody's draw.
      const mutual = leg.victory_type === 'mutual_destruction';
      for (const model of Object.keys(leg.perf || {})) {
        const a = acc[model];
        if (!a) continue;
        if (mutual) a.l += 1;
        else if (model === win) a.w += 1;
        else if (model === lose) a.l += 1;
        else a.d += 1;
      }
      // Turns to win / to lose, for the tempo tiebreak only. A match nobody
      // closed out has no time to contribute — including a mutual destruction,
      // where "how fast was it annihilated" measures nothing.
      if (typeof leg.turns === 'number' && win && lose && !mutual) {
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
        // Only when EVERY match could be re-priced. A mix of re-priced and
        // as-played legs would be a third number meaning neither thing.
        usdPerMatchToday: (a.matches && a.usdTodayN === a.matches)
          ? a.usdToday / a.matches : null,
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
        wonMatches: a.winTurns.length,      // decisive wins, for the tempo label
        wins: a.w,
        losses: a.l,
        draws: a.d,
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
    const rec = (p.wins + p.losses + p.draws)
      ? `<a class="lad-stat rec" href="#opening-history" title="Record across every match played on this ladder — W–L–D, and it always sums to the ${p.matches} match(es) played. A mutual destruction counts as a loss for both sides, not a draw. Click to open the match list and the replays.">▤ ${p.wins}W–${p.losses}L${p.draws ? `–${p.draws}D` : ''}</a>` : '';
    // Tempo. It settles the opening table when points, wins and head-to-head
    // are all level, and since site 0.17.1 it settles a level challenge too.
    const tempo = p.winTurns != null
      ? `<span class="lad-stat" title="Mean turns taken in the ${p.wonMatches} match(es) this model won. Career figure, shown as information — a challenge is settled on the speed inside that duel, not on this average.">⚔ wins in ${p.winTurns.toFixed(0)}</span>` : '';
    // Cost is a PRICE EPOCH, not a constant. A model that played before a price
    // cut carries the old rate in its average for ever, and comparing it to one
    // benchmarked this week compares two eras. So when re-pricing the same
    // matches at today's rates moves the figure by more than 5%, both are
    // shown: what it cost, then what it would cost now.
    const today = p.usdPerMatchToday;
    const drift = (today != null && p.usdPerMatch)
      ? Math.abs(today - p.usdPerMatch) / p.usdPerMatch : 0;
    const nowCell = drift > 0.05
      ? ` <span class="lad-now" title="The same matches re-priced at the rates in force today, keeping the discount each match actually received (prompt caching included). The provider moved its price after these matches were played; the figure on the left is what was really paid.">→ ${fmtUsd(today)} today</span>` : '';
    // A launch discount is a date, not a price. OpenRouter publishes it, so the
    // page can say so instead of presenting a sale as what a model costs:
    // Gemini 3.7 Flash arrived at -75%, which is the difference between
    // cheapest on the board and fourth cheapest.
    const pt = (data.pricing_today || {})[model] || {};
    const listPerMatch = (pt.discount && (today != null || p.usdPerMatch != null))
      ? (today != null ? today : p.usdPerMatch) / (1 - pt.discount) : null;
    const promo = pt.discount
      ? ` <span class="lad-promo" title="This model's pinned endpoint is on a promotion right now: $${pt.input}/$${pt.output} per 1M against a list price of $${pt.list_input}/$${pt.list_output}. At list price these same matches average ${fmtUsd(listPerMatch)}. The discount is a date, not a price — it expires.">PROMO −${Math.round(pt.discount * 100)}%</span>` : '';
    const cost = p.usdPerMatch != null
      ? `<span class="lad-stat${p.allReported ? '' : ' estimated'}" title="${p.allReported
          ? 'Average USD per match, as charged by the provider on the day it was played'
          : 'Average USD per match — at least one match had no provider-reported cost and fell back to an estimate'}">💲 ${fmtUsd(p.usdPerMatch)}${nowCell}${promo}</span>` : '';
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
  // cannot be made equal: the closed models report "unknown". Hiding that would
  // let a reader assume a level playing field that does not exist. "unknown" is
  // rendered as a fact, not as a gap.
  //
  // The tooltip says "the endpoint it is pinned to", never "its own lab": the
  // pin is first-party only when the lab serves one, and Qwen3.8 27B is served
  // by no first-party endpoint at all. The endpoint that answered is published
  // next to the model, so the reader can see which case this is.
  function quantBadge(q) {
    if (!q) return '';
    const unknown = q === 'unknown';
    const title = unknown
      ? 'The provider does not publish the numeric precision it serves. Normal for a closed model — it can be neither chosen nor verified.'
      : `Numeric precision of the pinned endpoint. Lower precision costs capability, and this model plays at ${q} because that is what the endpoint it is pinned to serves — shown next to its record.`;
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

  // ── the opening ──────────────────────────────────────────────────────────
  // The four places are played for, not decreed. Until that round-robin is
  // finished there is no standing to show, and the page says so rather than
  // rendering an empty board.

  // ── paging ────────────────────────────────────────────────────────────────
  // The opening grows as n(n-1) legs and the challenge log never stops growing,
  // so both get pages. Below the threshold nothing is drawn: a pager under nine
  // items is chrome for its own sake. Reigns stay whole on purpose — that list
  // is a timeline whose bars are positioned against a shared start and end, and
  // slicing it would silently rescale the axis.
  // Halved on a narrow screen: a page that takes four thumb-scrolls to reach its
  // own pager is not a page. Read at call time, so a rotation re-pages.
  const PAGE_WIDE = { legs: 12, log: 8 };
  const PAGE_NARROW = { legs: 6, log: 3 };
  const narrow = () => (typeof window !== 'undefined' && window.innerWidth
    ? window.innerWidth <= 640 : false);
  const pageSize = (key) => (narrow() ? PAGE_NARROW : PAGE_WIDE)[key];
  const pageAt = {};                                  // key -> current page

  function pageSlice(key, items) {
    const size = pageSize(key);
    if (!size || items.length <= size) { pageAt[key] = 0; return items; }
    const pages = Math.ceil(items.length / size);
    const p = Math.min(Math.max(0, pageAt[key] || 0), pages - 1);
    pageAt[key] = p;
    return items.slice(p * size, (p + 1) * size);
  }

  function pagerBar(key, total) {
    const size = pageSize(key);
    if (!size || total <= size) return '';
    const pages = Math.ceil(total / size);
    const p = Math.min(Math.max(0, pageAt[key] || 0), pages - 1);
    const from = p * size + 1, to = Math.min(total, (p + 1) * size);
    return `<div class="pager" data-pager="${key}">
              <button class="pg-btn" data-pg="prev"${p === 0 ? ' disabled' : ''}
                      aria-label="Previous page">‹</button>
              <span class="pg-info">${from}–${to} of ${total}</span>
              <button class="pg-btn" data-pg="next"${p >= pages - 1 ? ' disabled' : ''}
                      aria-label="Next page">›</button>
            </div>`;
  }

  function bindPager(root, rerender) {
    root.querySelectorAll('[data-pager]').forEach((bar) => {
      const key = bar.getAttribute('data-pager');
      bar.querySelectorAll('.pg-btn').forEach((b) => {
        b.addEventListener('click', (e) => {
          // The opening pager sits inside a <button>-toggled panel; without this
          // a page change would also collapse the panel it lives in.
          e.preventDefault(); e.stopPropagation();
          if (b.disabled) return;
          pageAt[key] = (pageAt[key] || 0) + (b.getAttribute('data-pg') === 'next' ? 1 : -1);
          rerender();
        });
      });
    });
  }

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
             These four models play each other twice, once from each side of the
             map; the table they produce becomes the ladder. Nothing is placed by
             decree.
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
    // Re-rendering for a page change must not close the panel.
    if (openingOpen === null) openingOpen = firstDay;
    el.innerHTML =
      `<div class="lb-section-title">Opening</div>
       <div class="opening done">
         <button class="opening-toggle" aria-expanded="${openingOpen}">
           <span class="opening-chevron">${openingOpen ? '▼' : '▶'}</span>
           <span>How the ladder started</span>
           <span class="opening-summary">${fmtDate(op.date)} · ${(op.legs || []).length} matches
             · ${champion ? esc(champion.display_name) + ' took #1' : ''}</span>
         </button>
         <div class="opening-detail${openingOpen ? ' open' : ''}">
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
         <div class="opening-legs">${pageSlice('legs', op.legs || []).map(openingLeg).join('')}</div>
         ${pagerBar('legs', (op.legs || []).length)}
         </div>
       </div>`;
    const btn = el.querySelector('.opening-toggle');
    if (btn) btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      openingOpen = !open;
      btn.setAttribute('aria-expanded', String(!open));
      btn.querySelector('.opening-chevron').textContent = open ? '▶' : '▼';
      el.querySelector('.opening-detail').classList.toggle('open', !open);
    });
    bindPager(el, renderOpening);
  }


  // ── models pushed off the board ──────────────────────────────────────────
  // A ladder that renders only its current four erases every model that earned
  // a place and then lost it, which is most of what a standing is a record OF.
  // Kimi K3 held #4 from the opening, survived one challenge, and vanished from
  // the page entirely the moment GLM 5.3 pushed it off.
  function renderDropped() {
    const el = document.getElementById('dropped-history');
    if (!el) return;
    const list = data.dropped || [];
    if (!list.length) { el.innerHTML = ''; return; }   // nothing to explain yet
    const title = isThrone() ? 'Fell off the end of the line'
      : 'Dropped off the ladder';
    const blurb = isThrone()
      ? 'Held a seat, then a new champion pushed it past the last one'
      : 'Held a place, then lost it';
    el.innerHTML =
      `<div class="lb-section-title">${title}</div>
       <div class="opening done">
         <button class="opening-toggle" aria-expanded="${droppedOpen}">
           <span class="opening-chevron">${droppedOpen ? '▼' : '▶'}</span>
           <span>${blurb}</span>
           <span class="opening-summary">${list.length} model${list.length === 1 ? '' : 's'}
             · most recent first</span>
         </button>
         <div class="opening-detail${droppedOpen ? ' open' : ''}">
           ${list.map(droppedRow).join('')}
         </div>
       </div>`;
    const btn = el.querySelector('.opening-toggle');
    if (btn) btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      droppedOpen = !open;
      btn.setAttribute('aria-expanded', String(!open));
      btn.querySelector('.opening-chevron').textContent = open ? '▶' : '▼';
      el.querySelector('.opening-detail').classList.toggle('open', !open);
    });
  }

  function droppedRow(e) {
    const held = e.entered_at && e.left_at
      ? `<span title="How long it held a place">${esc(e.entered_at)} → ${esc(e.left_at)}</span>` : '';
    const by = e.displaced_by
      ? `<span title="The challenger that pushed it off">pushed off by ${esc(e.displaced_by)}</span>` : '';
    // The rung number is a gauntlet fact. Under the throne format the seat it
    // fell from was never contested, so printing "#4" would revive exactly the
    // ranking the line of succession stopped claiming.
    const from = (e.left_from_rank && !isThrone())
      ? `<span class="lad-rank" title="The rung it was holding when it left">#${e.left_from_rank}</span>`
      : '<span class="line-dot" aria-hidden="true">·</span>';
    return `<div class="lad-row dropped-row">
              ${from}
              <div class="lad-model"><span class="lad-name">${flag(e.model)}${esc(e.display_name)}</span>${effortBadge(e.reasoning_effort)}${quantBadge(e.quantization)}${originBadge(e)}</div>
              <div class="lad-meta">
                ${perfCells(e.model)}
                ${held}
                <span title="Challenges survived before it left">${e.holds} hold${e.holds === 1 ? '' : 's'}</span>
                ${by}
              </div>
            </div>`;
  }

  function openingLeg(l) {
    const name = (m) => {
      const row = (data.opening.models || []).find((x) => x.model === m);
      return row ? row.display_name : m;
    };
    // "drew" is wrong for mutual destruction, which scores 0 a side like a
    // double loss. The page publishes that scale, so it must not describe the
    // one leg type where the reader is most likely to assume a draw as a draw.
    const label = l.outcome === 'draw'
      ? (l.victory_type === 'mutual_destruction'
        ? `${esc(name(l.a))} and ${esc(name(l.b))} destroyed each other`
        : `${esc(name(l.a))} — ${esc(name(l.b))} drew`)
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
           ${thirdTile(top)}
         </div>
       </div>`;
  }

  // "places climbed" is a gauntlet fact: under the throne format every champion
  // climbed exactly one place, so the tile would print 1 for everyone forever.
  // What a reader wants there instead is who it took the crown FROM.
  function thirdTile(top) {
    if (!isThrone()) {
      return `<div class="ts"><b>${top.seeded ? '—' : top.climbed}</b>` +
             `<span>places climbed</span></div>`;
    }
    const prev = predecessor();
    return prev
      ? `<div class="ts wide" title="The champion this model beat to take the crown">` +
        `<b>${esc(prev)}</b><span>dethroned</span></div>`
      : `<div class="ts wide" title="No predecessor — this model won the opening round-robin">` +
        `<b>—</b><span>won the opening</span></div>`;
  }

  // ── the standing ─────────────────────────────────────────────────────────

  // How a model got its place. Shared by the standing and by the dropped list:
  // the two printed different things for the same entry, so a model that won
  // its place in the opening lost that fact the moment it was pushed off — and
  // "came in through the opening" is the most interesting thing about it.
  function originBadge(e) {
    if (e.via === 'opening') {
      return '<span class="lad-badge from-opening" title="Place won in the opening round-robin, not by challenging in">OPENING</span>';
    }
    if (e.seeded) {
      return '<span class="lad-badge seeded" title="Placed when the ladder was created — not won on the board">SEEDED</span>';
    }
    if (e.via === 'throne') {
      return '<span class="lad-badge throne" title="Won the crown by beating the ' +
        'reigning champion over two matches — the only way onto this page">👑 TOOK THE THRONE</span>';
    }
    return `<span class="lad-badge climbed" title="Rungs won on the way in">▲ ${e.climbed}</span>`;
  }

  function renderBoard() {
    const el = document.getElementById('lad-board');
    if (!(data.ladder || []).length) {
      el.innerHTML = '<div class="empty-state">The board is empty until the opening is played.</div>';
      return;
    }
    if (isThrone()) return renderLine(el);
    el.innerHTML = (data.ladder || []).map((e) => {
      return `<div class="lad-row rank-${e.rank}">
                <div class="lad-rank">#${e.rank}</div>
                <div class="lad-model"><span class="lad-name">${flag(e.model)}${esc(e.display_name)}</span>${effortBadge(e.reasoning_effort)}${quantBadge(e.quantization)}${originBadge(e)}</div>
                <div class="lad-meta">
                  ${perfCells(e.model)}
                  <span title="Date this model took the place">${e.seeded ? 'seeded ' : 'entered '}${fmtDate(e.entered_at)}</span>
                  <span title="Challenges survived at this place">${e.holds} hold${e.holds === 1 ? '' : 's'}</span>
                </div>
              </div>`;
    }).join('');
  }

  // ── the line of succession ───────────────────────────────────────────────
  // Everything the standing used to draw and this must not: no rank number, no
  // gold/silver/bronze border, no ordering claim. The champion is skipped — it
  // has its own card directly above, and printing it twice, once at the top of
  // a list, is exactly the ranking this section exists to stop implying.

  function renderLine(el) {
    const rest = (data.ladder || []).slice(1);
    if (!rest.length) {
      el.innerHTML = '<div class="empty-state">Nobody has come before the ' +
        'current champion yet.</div>';
      return;
    }
    el.innerHTML = rest.map(lineRow).join('');
  }

  function lineRow(e) {
    const r = reignOf(e.model);
    // What the seat MEANS. A held reign is the strong statement and the only
    // one the throne format can produce on its own; the others are inherited
    // from the season played before it and say so.
    const what = r
      ? `<span class="line-what held" title="It held the throne — the one thing on this page that has to be won">` +
        `held the throne ${fmtDate(r.from)} → ${r.to ? fmtDate(r.to) : 'today'}</span>`
      : e.via === 'opening'
        ? `<span class="line-what" title="Took a seat in the opening round-robin, before the throne format. It never played for the crown.">` +
          `seat won in the opening</span>`
        : e.seeded
          ? `<span class="line-what" title="Placed when the board was created — not won on the board">seeded onto the board</span>`
          : `<span class="line-what" title="Won a seat under the gauntlet format, by climbing. It never played the champion.">` +
            `climbed in ${fmtDate(e.entered_at)}</span>`;
    const holds = e.holds
      ? `<span title="Challenges survived while it held a seat">${e.holds} hold${e.holds === 1 ? '' : 's'}</span>` : '';
    return `<div class="lad-row line-row">
              <div class="line-dot" aria-hidden="true">·</div>
              <!-- No originBadge here. It prints OPENING / SEEDED / "▲ 2 rungs
                   won on the way in", which the sentence below already says in
                   words — and "▲ 2" in particular re-poses this list as a climb
                   with a score attached, which is the reading the section is
                   built to prevent. -->
              <div class="lad-model"><span class="lad-name">${flag(e.model)}${esc(e.display_name)}</span>${effortBadge(e.reasoning_effort)}${quantBadge(e.quantization)}</div>
              <div class="lad-meta">
                ${perfCells(e.model)}
                ${what}
                ${holds}
              </div>
            </div>`;
  }

  // ── challenges ───────────────────────────────────────────────────────────

  function renderLatest() {
    const el = document.getElementById('latest-challenge');
    const c = (data.challenges || [])[0];
    if (!c) {
      el.innerHTML = '<div class="empty-state">No challenge yet — the queue starts once there is a champion to play.</div>';
      return;
    }
    el.innerHTML = challengeCard(c, true);
    // Open by default — it is the headline — but still closable. This card
    // draws the same .chal-chevron as the log's, so leaving it inert made the
    // page show an affordance that did nothing.
    bindChalToggle(el);
  }

  // Shared by the latest-challenge card and the log. One function on purpose:
  // the two used to bind separately, and only one of them ever did.
  function bindChalToggle(root) {
    root.querySelectorAll('.chal-head').forEach((h) => {
      h.addEventListener('click', () => h.closest('.chal').classList.toggle('open'));
    });
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
    el.innerHTML = pageSlice('log', list).map((c) => challengeCard(c, false)).join('')
      + pagerBar('log', list.length);
    bindPager(el, renderLog);
    bindChalToggle(el);
  }

  function challengeCard(c, expanded) {
    const rank = c.final_rank;
    const throne = chalThrone(c);
    // "fails to enter" is a gauntlet verdict: it means the challenger could not
    // beat the bottom rung. Under the throne format the same word would be
    // applied to a model that lost to the CHAMPION, which is a different result
    // and a much harder one — there is no lower bar it also failed.
    const verdictClass = rank === 1 ? 'takes-throne'
      : rank ? 'enters' : throne ? 'held' : 'fails';
    const verdict = rank === 1
      ? 'takes the throne'
      : rank ? `enters at #${rank}` : throne ? 'the champion holds' : 'fails to enter';
    const displaced = c.displaced
      ? `<span class="chal-displaced">${esc(c.displaced)} drops off</span>` : '';
    // Count both: the body draws one card per TIE, each holding its two legs.
    // Printing only "6 matches" above three cards read as three missing ones.
    // Under the throne format there is only ever one tie, so the tie count adds
    // nothing and the line says what the two matches ARE instead.
    const rungs = c.steps.length;
    const legs = c.steps.reduce((n, s) => n + s.legs.length, 0);
    const count = throne
      ? `<span class="chal-count" title="A throne challenge is one two-leg tie against the champion — the same pair, sides swapped. Win it and the crown changes hands; lose it and nothing on the board moves.">${legs} match${legs === 1 ? '' : 'es'} · one from each side</span>`
      : `<span class="chal-count" title="One card per rung challenged. Every rung is a two-leg tie — the same pair, sides swapped — so ${rungs} rungs means ${legs} matches.">${rungs} rung${rungs === 1 ? '' : 's'} · ${legs} match${legs === 1 ? '' : 'es'}</span>`;

    return `<div class="chal ${expanded ? 'open' : ''}">
      <div class="chal-head">
        <span class="chal-date">${fmtDate(c.date)}</span>
        <span class="chal-name">${flag(c.challenger.model)}${esc(c.challenger.display_name)} ${effortBadge(c.challenger.reasoning_effort)}${quantBadge(c.challenger.quantization)}</span>
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
    const won = s.result === 'win';
    const [pc, pi] = s.pts;
    // Why a rung changed hands, or did not. A 3-3 next to a challenger that
    // climbed is the one thing a reader cannot work out from the score alone,
    // so the engine records the reason and the card prints it verbatim.
    const note = s.decided_by && s.decided_by !== 'points'
      ? `<span class="step-note">${esc(s.decided_by)}</span>` : '';
    return `<div class="step ${won ? 'won' : 'lost'}">
      <div class="step-head">
        <span class="step-rank${throne ? ' crown' : ''}" title="${throne ? 'The reigning champion — the only seat a challenger plays for' : 'The rung this tie was played for'}">${throne ? '👑' : '#' + s.rank}</span>
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
        : l.victory_type === 'mutual_destruction'
          ? '<span class="leg-l" title="Mutual destruction scores 0 for both, like a loss — it is not a draw">both lost</span>'
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
