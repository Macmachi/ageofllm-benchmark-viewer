/*
 * ladder.js — renders data/ladder.json: the champion, every model ever tested
 * with its matches, every challenge played for the throne, and the succession
 * of reigns. The frozen V1 corpus joins the model list read-only, from
 * data/leaderboard_v1.json and replays/index_v1.json.
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
  let v1 = null;             // { lb, idx } once the frozen V1 corpus has loaded
  let logFilter = '';
  let modelFilter = '';
  const openModels = new Set();   // model ids whose match list is unfolded

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
      boardTitle: 'Every model tested',
      boardNote: 'The champion, then every former champion by time on the '
        + 'throne, then every other model, most recently tested first. '
        + '<strong>Not a ranking</strong> — only the throne is played for. '
        + '<strong>Open a model to see each of its matches and watch the '
        + 'replays.</strong>',
      boardNoteTitle: 'Models did not play the same number of matches: the '
        + 'opening four played each other, a challenger plays the champion '
        + 'twice. Their records are shown for what they are, and none of them '
        + 'is compared with another. The V1 models at the end were played on an '
        + 'older game engine and are kept frozen.',
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

    // Fetched alongside the rest: the V1 rows join the model list once they
    // arrive, and a missing archive leaves the list complete for the ladder.
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
    if (v1) { renderBoard(); renderReigns(); }
  }

  async function loadV1() {
    try {
      const get = (url) => fetch(url).then((r) => {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      });
      const [lb, idx] = await Promise.all([
        get('data/leaderboard_v1.json'), get('replays/index_v1.json')]);
      return { lb, idx };
    } catch (e) {
      return null;
    }
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

  // `record: false` where the caller prints the record itself — the model list
  // shows it as a tile and lists the matches right under it.
  function perfCells(model, opts) {
    const p = perfByModel[model];
    if (!p) return '';
    const lat = p.thinkMs != null
      ? `<span class="lad-stat" title="Mean thinking time per played turn, measured across ${p.matches} match(es) on a pinned provider">⏱ ${fmtMs(p.thinkMs)}</span>` : '';
    // Win-loss record over everything this model has played here. A ladder rank
    // says "nobody has beaten me at this rung", which on day one — when the
    // opening is the only thing that happened — tells the reader nothing about
    // how the four got there. The record does, and it links to the matches.
    const rec = (opts && opts.record === false) ? ''
      : (p.wins + p.losses + p.draws)
      ? `<a class="lad-stat rec" href="#board-title" data-model="${esc(model)}" title="Record across every match played on this ladder — W–L–D, and it always sums to the ${p.matches} match(es) played. A mutual destruction counts as a loss for both sides, not a draw. Click to open its matches and replays in the model list.">▤ ${p.wins}W–${p.losses}L${p.draws ? `–${p.draws}D` : ''}</a>` : '';
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
  const PAGE_WIDE = { legs: 12, log: 8, models: 10 };
  const PAGE_NARROW = { legs: 6, log: 3, models: 6 };
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

    // Under the throne a played opening has nothing left to show: each of its
    // matches is under its two models in the model list, marked "Opening", and
    // the first champion's row says how it won it. A second home for the same
    // twelve matches, speaking of "#1", only blurred which seat is played for.
    if (isThrone()) return;

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
    // Under the throne every one of these is a row of the model list, with its
    // matches; a second list of the same names would only repeat it.
    if (!list.length || isThrone()) { el.innerHTML = ''; return; }
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
    if (isThrone()) return renderModels(el);
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

  // ── every model tested ───────────────────────────────────────────────────
  // One list for every model this site has played, each row unfolding into its
  // own matches. It replaces the line of succession and the list of models that
  // fell off it: neither seat was ever played for, and together they hid every
  // challenger that lost to the champion inside the challenge log.
  //
  // The order is the only claim the list makes, and the note above it says
  // what it is: the champion, former champions by time on the throne, then
  // everyone else by the date they were tested. Records are printed, never
  // compared — the opening four played each other, a challenger plays twice.
  //
  // The frozen V1 corpus closes the list. It keeps its own published order
  // (points per match, at least three matches) because V1 WAS a ranking, and
  // never gets a time on the throne, because no throne existed then.

  const V1_ENGINES = '0.9.2 – 0.15.0';

  function nameOf(model) {
    const hit = [].concat(
      (data.opening || {}).models || [], data.ladder || [], data.dropped || [],
      ...(data.challenges || []).map((c) =>
        [c.challenger].concat(c.steps.map((s) => s.opponent))),
    ).find((m) => m && m.model === model);
    return hit ? hit.display_name : model;
  }

  function resultFor(me, winner, vt) {
    if (vt === 'mutual_destruction') return 'md';   // a loss for both sides
    if (!winner) return 'd';
    return winner === me ? 'w' : 'l';
  }

  // Seat 1 of a gauntlet climb was the throne too, so it is named the same way.
  function ctxLabel(rank, role, throne) {
    if (throne || rank === 1) return role === 'challenger' ? 'Throne challenge' : 'Throne defence';
    return role === 'challenger' ? `Climb · #${rank}` : `Defence · #${rank}`;
  }

  function ladderMatches() {
    const by = {};
    const push = (model, m) => (by[model] = by[model] || []).push(m);
    const op = data.opening || {};
    (op.legs || []).forEach((l) => {
      const winner = l.outcome === 'a' ? l.a : l.outcome === 'b' ? l.b : null;
      const base = { id: l.match_id, date: l.date || op.date, vt: l.victory_type,
        turns: l.turns, sim: !l.match_id, ctx: 'Opening' };
      push(l.a, { ...base, opp: l.b, side: l.a_side, res: resultFor(l.a, winner, l.victory_type) });
      push(l.b, { ...base, opp: l.a, side: 1 - l.a_side, res: resultFor(l.b, winner, l.victory_type) });
    });
    (data.challenges || []).forEach((c) => {
      const throne = chalThrone(c);
      c.steps.forEach((st) => st.legs.forEach((l) => {
        const ch = c.challenger.model, inc = st.opponent.model;
        const winner = l.outcome === 'challenger' ? ch : l.outcome === 'incumbent' ? inc : null;
        const base = { id: l.match_id, date: l.date || c.date, vt: l.victory_type,
          turns: l.turns, sim: l.source === 'simulated' };
        push(ch, { ...base, ctx: ctxLabel(st.rank, 'challenger', throne), opp: inc,
          side: l.challenger_side, res: resultFor(ch, winner, l.victory_type) });
        push(inc, { ...base, ctx: ctxLabel(st.rank, 'incumbent', throne), opp: ch,
          side: 1 - l.challenger_side, res: resultFor(inc, winner, l.victory_type) });
      }));
    });
    return by;
  }

  // The moment a crown changed hands: when the deciding match of the tie
  // finished. Dates alone cannot tell a two-hour reign from a one-day one, and
  // GPT-6 Astra's lasted from 08:57 to 11:19 UTC on the same day.
  function crowning(r) {
    const c = (data.challenges || []).find((x) =>
      x.challenger.model === r.model && x.final_rank === 1 && x.date === r.from);
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
    if (s.days >= 1) return `${s.days} day${s.days === 1 ? '' : 's'}`;
    const h = s.ms / 3600000;
    return h >= 1 ? `${Math.round(h)} h` : '< 1 h';
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
      const firstTested = opRow ? op.date
        : asChallenger.map((c) => c.date).sort()[0] || list[list.length - 1].date;
      const chal = asChallenger[0];
      return {
        id: model, era: 'ladder', name: nameOf(model), list,
        effort: (opRow || (chal && chal.challenger) || {}).reasoning_effort
          || ((data.ladder || []).concat(data.dropped || []).find((e) => e.model === model) || {}).reasoning_effort,
        quant: ((chal && chal.challenger) || (op.models || []).find((m) => m.model === model) || {}).quantization,
        decision: chal && chal.challenger.decision_interface,
        current, reigns, spans,
        throneMs: spans.reduce((s, x) => s + x.ms, 0),
        throneDays: spans.reduce((s, x) => s + x.days, 0),
        firstTested: String(firstTested).slice(0, 10),
        status: ladderStatus(model, reigns, spans, chal, opRow),
      };
    });
  }

  function ladderStatus(model, reigns, spans, chal, opRow) {
    const last = reigns[reigns.length - 1];
    if (last && last.to === null) {
      return `<span class="mdl-what king">Champion since ${fmtDate(last.from)}` +
        ` · ${last.defences} defence${last.defences === 1 ? '' : 's'}</span>`;
    }
    if (last) {
      const s = spans[spans.length - 1];
      const when = last.from === last.to
        ? `for ${fmtSpan(s)} on ${fmtDate(last.from)}`
        : `${fmtDay(last.from)} → ${fmtDate(last.to)}`;
      const opened = crowning(last).opening ? 'Won the opening · c' : 'C';
      return `<span class="mdl-what held"${crowning(last).opening ? ` title="${esc(openingWin(model))}"` : ''}>${opened}hampion ${when}` +
        `${s.next ? `, dethroned by ${esc(s.next.display_name)}` : ''}</span>`;
    }
    if (chal) {
      const st = chal.steps[chal.steps.length - 1];
      if (chalThrone(chal)) {
        const [pc, pi] = st.pts;
        const speed = st.decided_by && /faster/.test(st.decided_by) ? ' on speed' : '';
        return `<span class="mdl-what">Challenged ${esc(st.opponent.display_name)} on ` +
          `${fmtDate(chal.date)} · lost the tie ${fmtPts(pc)}–${fmtPts(pi)}${speed}</span>`;
      }
      const how = 'The first season\'s gauntlet: a challenger entered at #4 and '
        + 'climbed one two-leg tie at a time, before the throne format';
      return chal.final_rank
        ? `<span class="mdl-what" title="${how}">Gauntlet, ${fmtDate(chal.date)} · ` +
          `climbed to #${chal.final_rank}</span>`
        : `<span class="mdl-what" title="${how}">Gauntlet, ${fmtDate(chal.date)} · ` +
          `lost its tie at #${st.rank}</span>`;
    }
    if (opRow) {
      return `<span class="mdl-what">Opening round-robin, ${fmtDate((data.opening || {}).date)}` +
        ` · finished #${opRow.rank} of ${(data.opening.table || []).length}</span>`;
    }
    return '';
  }

  // How the first champion won the opening round-robin, in one sentence: it
  // took the throne without a duel, so this is the only evidence for its reign.
  function openingWin(model) {
    const t = ((data.opening || {}).table || []);
    const me = t.find((r) => r.model === model);
    if (!me) return '';
    const level = t.filter((r) => r !== me && r.pts === me.pts);
    return `Finished first of the opening round-robin on ${fmtDate(data.opening.date)}: ` +
      `${fmtPts(me.pts)} points, ${me.w}W–${me.l}L` +
      (level.length && me.tiebreak
        ? `, level on points with ${level.map((r) => r.display_name).join(', ')} and ahead on ${me.tiebreak}.`
        : '.');
  }

  function v1Models() {
    if (!v1) return [];
    const reps = (v1.idx && v1.idx.replays) || [];
    const lb = (v1.lb && v1.lb.models) || [];
    const min = (v1.lb && v1.lb.min_matches_ranked) || 0;
    // The published V1 order, recomputed the way v1.html computes it: archived
    // models out, qualified first, points per match. Rank numbers belong to the
    // qualified rows only, as they do on that page.
    const byPpm = (a, b) => (b.points_per_match || 0) - (a.points_per_match || 0);
    const active = lb.filter((m) => !m.archived);
    const ordered = active.filter((m) => m.total >= min).sort(byPpm)
      .concat(active.filter((m) => m.total < min).sort(byPpm))
      .concat(lb.filter((m) => m.archived).sort(byPpm));
    return ordered.map((m, i) => {
      const ranked = !m.archived && m.total >= min;
      const list = reps.filter((r) => r.p1_model === m.model || r.p2_model === m.model)
        .map((r) => {
          const me = r.p1_model === m.model ? 0 : 1;
          const winner = r.winner === 0 ? r.p1_model : r.winner === 1 ? r.p2_model : null;
          return { id: r.match_id, date: r.date, ctx: 'V1', side: me,
            opp: me === 0 ? r.p2_model : r.p1_model,
            oppName: me === 0 ? r.p2_display_name : r.p1_display_name,
            res: resultFor(m.model, winner, r.victory_type), vt: r.victory_type,
            turns: r.total_turns };
        })
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const dates = list.map((x) => String(x.date).slice(0, 10)).sort();
      return {
        id: 'v1:' + m.model, model: m.model, era: 'v1', name: m.display_name, list,
        effort: m.reasoning_effort, v1Rank: ranked ? i + 1 : null,
        v1: m, firstTested: dates[0] || '',
        status: `<span class="mdl-what" title="Played on game engine ${V1_ENGINES}, before the throne existed. Frozen on 14 Aug 2026 and still published unchanged on the V1 page.">` +
          `V1 · ${list.length} matches, ${fmtDay(dates[0])} → ${fmtDate(dates[dates.length - 1])}` +
          `${m.archived ? ' · archived' : ''}</span>`,
      };
    });
  }

  function allModels() {
    const lad = ladderModels();
    const kings = lad.filter((m) => m.reigns.length)
      .sort((a, b) => (b.current - a.current) || (b.throneMs - a.throneMs));
    const others = lad.filter((m) => !m.reigns.length)
      .sort((a, b) => b.firstTested.localeCompare(a.firstTested)
        || String(b.list[0].date).localeCompare(String(a.list[0].date))
        || a.name.localeCompare(b.name));
    return kings.concat(others, v1Models());
  }

  function renderModels(el) {
    const all = allModels();
    const list = modelFilter
      ? all.filter((m) => m.name.toLowerCase().includes(modelFilter)) : all;
    if (!list.length) {
      el.innerHTML = '<div class="empty-state">No model matches.</div>';
      return;
    }
    const page = pageSlice('models', list);
    el.innerHTML = page.map((m, i) => {
      const divider = m.era === 'v1' && (i === 0 || page[i - 1].era !== 'v1')
        ? `<div class="mdl-divider">
             <b>V1 archive — frozen.</b> Played on game engine ${V1_ENGINES}, under
             rules and a system prompt the current engine no longer uses, and before
             the throne existed. Shown in the order the
             <a href="v1.html">V1 leaderboard</a> still publishes.
           </div>` : '';
      return divider + modelRow(m);
    }).join('') + pagerBar('models', list.length);
    bindPager(el, () => renderModels(el));
    el.querySelectorAll('.mdl-head').forEach((h) => {
      h.addEventListener('click', () => {
        const row = h.closest('.mdl');
        const id = row.getAttribute('data-id');
        const open = !row.classList.contains('open');
        if (open) openModels.add(id); else openModels.delete(id);
        row.classList.toggle('open', open);
        h.setAttribute('aria-expanded', String(open));
        const label = row.querySelector('.mdl-toggle-label');
        if (label) label.textContent = toggleLabel(row.getAttribute('data-n'), open);
      });
    });
  }

  // Opens one model's row wherever it sits in the paged list, and scrolls to
  // it. Reached from a record chip in a challenge card.
  function openModel(id) {
    modelFilter = '';
    const fm = document.getElementById('f-model');
    if (fm) fm.value = '';
    const i = allModels().findIndex((m) => m.id === id);
    if (i < 0) return;
    pageAt.models = Math.floor(i / pageSize('models'));
    openModels.add(id);
    renderBoard();
    const row = [...document.querySelectorAll('.mdl')].find((r) => r.getAttribute('data-id') === id);
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function toggleLabel(n, open) {
    return open ? 'Hide matches' : `Show its ${n} match${Number(n) === 1 ? '' : 'es'}`;
  }

  function modelRow(m) {
    const open = openModels.has(m.id);
    const n = m.list.length;
    const w = m.list.filter((x) => x.res === 'w').length;
    const l = m.list.filter((x) => x.res === 'l' || x.res === 'md').length;
    const d = m.list.filter((x) => x.res === 'd').length;
    const mark = m.current ? '👑' : m.era === 'ladder' && m.reigns.length ? '★' : '·';
    const badge = m.era === 'v1'
      ? (m.v1Rank === 1
        ? '<span class="lad-badge v1-top" title="#1 of the frozen V1 leaderboard, on points per match">👑 V1 #1</span>'
        : m.v1Rank
          ? `<span class="lad-badge v1" title="Rank on the frozen V1 leaderboard, on points per match">V1 #${m.v1Rank}</span>`
          : '<span class="lad-badge v1" title="Not ranked on the V1 leaderboard">V1</span>')
      : '';
    const decision = m.decision && m.decision.kind === 'choice'
      ? `<span class="effort effort-na" title="${esc(window.choiceInterfaceTitle(m.decision))}">CHOICE</span>`
      : effortBadge(m.effort);
    const throne = m.era === 'v1'
      ? '<div class="mdl-tile muted" title="V1 was played before the throne existed"><b>—</b><span>before the throne</span></div>'
      : m.reigns.length
        ? `<div class="mdl-tile gold" title="${m.spans.map((s, i) => `${fmtDate(m.reigns[i].from)} → ${m.reigns[i].to ? fmtDate(m.reigns[i].to) : 'today'}`).join(', ')}"><b>${fmtSpan({ days: m.throneDays, ms: m.throneMs })}</b><span>on the throne</span></div>`
        : '<div class="mdl-tile muted"><b>—</b><span>never champion</span></div>';
    const rec = `<div class="mdl-tile" title="Wins–losses${d ? '–draws' : ''} over its ${n} match${n === 1 ? '' : 'es'}. A mutual destruction counts as a loss for both sides."><b>${w}W–${l}L${d ? `–${d}D` : ''}</b><span>${n} match${n === 1 ? '' : 'es'}</span></div>`;
    const perf = m.era === 'v1' ? v1Perf(m.v1) : perfCells(m.id, { record: false });
    const cls = m.current ? ' king' : m.era === 'ladder' && m.reigns.length ? ' held' : '';
    return `<div class="mdl${cls}${m.era === 'v1' ? ' v1' : ''}${open ? ' open' : ''}" data-id="${esc(m.id)}" data-n="${n}">
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
        ${perf ? `<div class="chal-perf">${perf}</div>` : ''}
        <div class="mdl-legs">${m.list.map(modelLeg).join('')}</div>
      </div>
    </div>`;
  }

  function v1Perf(m) {
    const cells = [];
    if (m.avg_think_ms) cells.push(`<span class="lad-stat" title="Mean thinking time per turn, V1 corpus">⏱ ${fmtMs(m.avg_think_ms)}</span>`);
    if (m.avg_cost_per_match) cells.push(`<span class="lad-stat estimated" title="Average USD per match in the V1 corpus, at the prices of the day">💲 ${fmtUsd(m.avg_cost_per_match)}</span>`);
    if (m.invalid_action_rate != null) cells.push(`<span class="lad-stat" title="Share of submitted actions the V1 engine rejected">⚠ ${(m.invalid_action_rate * 100).toFixed(1)}% invalid</span>`);
    return cells.join('');
  }

  function modelLeg(x) {
    const opp = x.oppName || nameOf(x.opp);
    const side = x.side === 0
      ? '<span class="badge-p0" title="Played player 1">P1</span>'
      : '<span class="badge-p1" title="Played player 2">P2</span>';
    const res = x.res === 'w' ? '<span class="leg-w">won</span>'
      : x.res === 'l' ? '<span class="leg-l">lost</span>'
        : x.res === 'md'
          ? '<span class="leg-l" title="Mutual destruction scores 0 for both, like a loss — it is not a draw">both lost</span>'
          : '<span class="leg-d">drew</span>';
    const vt = `<span class="vt vt-${esc(x.vt)}">${VT_LABEL[x.vt] || esc(x.vt)}</span>`;
    const body = `<span class="mleg-date">${fmtDay(x.date)}</span>
      <span class="mleg-ctx">${esc(x.ctx)}</span>
      <span class="mleg-opp">vs ${flag(x.opp)}${esc(opp)}</span>
      <span class="mleg-res">${side} ${res} · ${vt} ${x.turns ? `<span class="mleg-turns">T${x.turns}</span>` : ''}</span>`;
    if (x.sim) {
      return `<div class="leg mleg sim" title="Fabricated for this preview — no such match was ever played">${body}<span class="leg-sim">SIM</span></div>`;
    }
    return `<a class="leg mleg" href="viewer.html?match=${encodeURIComponent(x.id)}" title="Watch the replay">${body}<span class="leg-play">▶ replay</span></a>`;
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
    const decisionBadge = c.challenger.decision_interface?.kind === 'choice'
      ? `<span class="effort effort-na" title="${esc(window.choiceInterfaceTitle(c.challenger.decision_interface))}">CHOICE</span>`
      : effortBadge(c.challenger.reasoning_effort);

    return `<div class="chal ${expanded ? 'open' : ''}">
      <div class="chal-head">
        <span class="chal-date">${fmtDate(c.date)}</span>
        <span class="chal-name">${flag(c.challenger.model)}${esc(c.challenger.display_name)} ${decisionBadge}${quantBadge(c.challenger.quantization)}</span>
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

    el.innerHTML = v1Reign() + rs.map((r) => {
      const a = new Date(r.from).getTime();
      const b = r.to ? new Date(r.to).getTime() : end;
      const left = ((a - start) / span) * 100;
      const width = Math.max(2, ((b - a) / span) * 100);
      const cr = crowning(r);
      // Where the crown was won: the deciding match, or the opening table for
      // the first champion, which took it without beating anyone for it.
      const how = cr.leg && cr.leg.match_id
        ? `<a class="reign-how" href="viewer.html?match=${encodeURIComponent(cr.leg.match_id)}" title="Watch the match that won the crown">▶</a>`
        : cr.opening ? `<a class="reign-how" href="#board-title" data-open-model="${esc(r.model)}" title="${esc(openingWin(r.model))} Open its matches.">⚑</a>` : '';
      return `<div class="reign">
        <div class="reign-name">${flag(r.model)}${esc(r.display_name)}${r.seeded ? '<span class="lad-badge seeded">SEEDED</span>' : ''}${how}</div>
        <div class="reign-track">
          <div class="reign-bar ${r.to ? '' : 'current'}" style="left:${left}%;width:${width}%"
               title="${fmtDate(r.from)} → ${r.to ? fmtDate(r.to) : 'now'}"></div>
        </div>
        <div class="reign-days">${fmtSpan(reignSpan(r))}${r.defences ? ` · ${r.defences} def.` : ''}</div>
      </div>`;
    }).join('');
  }

  // What came before the first reign. V1 had no throne, so its leader gets a
  // line above the timeline rather than a bar on it: a bar would claim days
  // on a throne nobody played for. Filled once the V1 archive has loaded.
  function v1Reign() {
    const top = v1Models().find((m) => m.v1Rank === 1);
    if (!top) return '';
    const d = top.list.map((x) => String(x.date).slice(0, 10)).sort();
    return `<div class="reign-before">
      <span class="reign-before-tag">Before the throne</span>
      ${flag(top.model)}<b>${esc(top.name)}</b> led the frozen
      <a href="v1.html">V1 leaderboard</a> — ${top.v1.wins}W–${top.v1.losses}L,
      ${fmtPts(top.v1.points_per_match)} points per match, ${fmtDay(d[0])} → ${fmtDate(d[d.length - 1])},
      game engine ${V1_ENGINES}
    </div>`;
  }

  // ── plumbing ─────────────────────────────────────────────────────────────

  function bindFilter() {
    const inp = document.getElementById('f-chal');
    if (inp) inp.addEventListener('input', () => {
      logFilter = inp.value.trim().toLowerCase();
      renderLog();
    });
    const fm = document.getElementById('f-model');
    if (fm) fm.addEventListener('input', () => {
      modelFilter = fm.value.trim().toLowerCase();
      pageAt.models = 0;
      renderBoard();
    });
    document.addEventListener('click', (e) => {
      const rec = e.target.closest && e.target.closest('a.rec[data-model]');
      if (rec && isThrone()) { e.preventDefault(); openModel(rec.getAttribute('data-model')); return; }
      const first = e.target.closest && e.target.closest('a[data-open-model]');
      if (first) { e.preventDefault(); openModel(first.getAttribute('data-open-model')); }
    });
    // The model rows unfold on Enter and Space as well as on a click.
    const board = document.getElementById('lad-board');
    if (board) board.addEventListener('keydown', (e) => {
      const h = e.target.closest && e.target.closest('.mdl-head');
      if (h && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); h.click(); }
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
  function fmtDay(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    } catch { return iso; }
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
