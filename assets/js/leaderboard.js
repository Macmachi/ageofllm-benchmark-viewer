/*
 * leaderboard.js — Builds the ranking table + recent matches list.
 *
 * Reads data/leaderboard.json (per-model aggregates) and replays/index.json
 * (lightweight match list). No dependency on the viewer modules.
 */

(function () {
  'use strict';

  // Per-model metadata: flag (country emoji) + author (company name) + optional new badge.
  // Add a single entry here when a new model is benchmarked.
  const MODEL_META = {
    // 🇺🇸 United States
    'gpt-5.5':                           { flag: '🇺🇸', author: 'OpenAI' },
    'claude-opus-4.8':                   { flag: '🇺🇸', author: 'Anthropic' },
    'gemini-3.5-flash':                  { flag: '🇺🇸', author: 'Google', isNew: true },
    'gemini-3.1-pro':                    { flag: '🇺🇸', author: 'Google' },
    'grok-4.3':                          { flag: '🇺🇸', author: 'xAI' },
    'nvidia-nemotron-3-ultra-550b-a55b': { flag: '🇺🇸', author: 'Nvidia' },
    // 🇨🇳 China
    'deepseek-v4-pro-e':                 { flag: '🇨🇳', author: 'DeepSeek' },
    'mimo-v2.5-pro':                     { flag: '🇨🇳', author: 'Xiaomi' },
    'qwen3.7-max':                       { flag: '🇨🇳', author: 'Alibaba' },
    'minimax-m3':                        { flag: '🇨🇳', author: 'MiniMax' },
    'kimi-k2.6':                         { flag: '🇨🇳', author: 'Moonshot' },
    'kimi-k2-6':                         { flag: '🇨🇳', author: 'Moonshot' },
    'zai-org-glm-5-1':                   { flag: '🇨🇳', author: 'Zhipu' },
    'glm-5.1-fw':                        { flag: '🇨🇳', author: 'Zhipu' },
  };

  function modelDisplayName(m) {
    return m.display_name || m.model;
  }

  function modelFlag(modelId) {
    const meta = MODEL_META[modelId];
    return meta && meta.flag ? meta.flag + ' ' : '';
  }

  function modelAuthorTag(modelId) {
    const meta = MODEL_META[modelId];
    return meta && meta.author ? `<span class="model-author">${esc(meta.author)}</span>` : '';
  }

  function modelNewBadge(modelId) {
    const meta = MODEL_META[modelId];
    return meta && meta.isNew ? `<span class="new-badge" title="New model">NEW</span>` : '';
  }

  const VT_LABEL = {
    nuclear: 'Nuclear', military: 'Military', ultimatum: 'Ultimatum',
    peace: 'Peace', mutual_destruction: 'Mutual destr.', timeout: 'Timeout',
  };

  // Reasoning-effort badge label. Extendable in the future.
  const EFFORT_LABEL = {
    high: 'HIGH', medium: 'MED', low: 'LOW', off: 'OFF', na: 'NA',
  };
  function effortBadge(effort) {
    const e = String(effort || 'off').toLowerCase();
    const label = EFFORT_LABEL[e] || e.toUpperCase();
    return `<span class="effort effort-${esc(e)}" title="Reasoning effort">${esc(label)}</span>`;
  }

  const PAGE_SIZE = 20;   // matches per page

  let models = [];
  let allMatches = [];     // all matches, newest first
  let filteredMatches = []; // current search result (all pages)
  let matchPage = 1;       // current page (1-based)
  // Default ranking: points per match (fair across different match counts).
  let sortKey = 'points_per_match';
  let sortDir = -1;
  // Models with fewer than this many matches are listed AFTER ranked ones and
  // flagged "provisional" (kept in sync with the #f-min input default).
  let minMatches = 3;

  async function init() {
    const [lb, idx] = await Promise.all([
      fetchJSON('data/leaderboard.json').catch(() => ({ models: [] })),
      fetchJSON('replays/index.json').catch(() => ({ models: [], replays: [] })),
    ]);
    models = lb.models || [];
    // Show engine version from leaderboard.json in the header badge.
    const verEl = document.querySelector('.lb-ver');
    if (verEl && lb.engine_version) verEl.textContent = `v${lb.engine_version}`;
    // index.json is sorted oldest->newest; show newest first (by date, then id).
    allMatches = (idx.replays || []).slice().sort((a, b) => {
      const d = String(b.date || '').localeCompare(String(a.date || ''));
      return d !== 0 ? d : String(b.match_id || '').localeCompare(String(a.match_id || ''));
    });
    filteredMatches = allMatches;
    renderTable();
    renderMatches();
    bindFilters();
    bindSort();
  }

  function fetchJSON(url) {
    return fetch(url).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
  }

  function bindSort() {
    document.querySelectorAll('#lb-table thead th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const k = th.dataset.sort;
        if (k === 'rank') return;
        if (sortKey === k) sortDir *= -1;
        else { sortKey = k; sortDir = (k === 'model') ? 1 : -1; }
        renderTable();
      });
    });
  }

  function bindFilters() {
    document.getElementById('f-model').addEventListener('input', renderTable);
    document.getElementById('f-min').addEventListener('input', renderTable);
    const fm = document.getElementById('f-match');
    if (fm) fm.addEventListener('input', () => {
      // The search always runs over ALL matches (every page), then resets to
      // page 1 of the result set.
      const q = fm.value.trim().toLowerCase();
      filteredMatches = !q ? allMatches : allMatches.filter((r) => {
        const vt = (r.victory_type || '').toLowerCase();
        const vtl = (VT_LABEL[vt] || vt).toLowerCase();
        return [r.match_id, r.p1_model, r.p2_model, vt, vtl]
          .filter(Boolean).some((s) => String(s).toLowerCase().includes(q));
      });
      matchPage = 1;
      renderMatches();
    });
  }

  function renderTable() {
    const body = document.getElementById('lb-body');
    const fModel = document.getElementById('f-model').value.trim().toLowerCase();
    minMatches = Math.max(0, Number(document.getElementById('f-min').value) || 0);

    // Separate active vs archived first, then apply text filter.
    const active   = models.filter((m) => !m.archived);
    const archived = models.filter((m) =>  m.archived);

    let activeRows   = active.filter((m) => !fModel || m.model.toLowerCase().includes(fModel) || (m.display_name || '').toLowerCase().includes(fModel));
    let archivedRows = archived.filter((m) => !fModel || m.model.toLowerCase().includes(fModel) || (m.display_name || '').toLowerCase().includes(fModel));

    const cmp = (a, b) => {
      let va = a[sortKey], vb = b[sortKey];
      if (typeof va === 'string') return va.localeCompare(vb) * sortDir;
      return ((va || 0) - (vb || 0)) * sortDir;
    };

    // Qualified models (>= minMatches) are ranked first; provisional ones follow.
    const qualified   = activeRows.filter((m) => m.total >= minMatches).sort(cmp);
    const provisional = activeRows.filter((m) => m.total < minMatches).sort(cmp);

    body.innerHTML = '';
    if (activeRows.length === 0 && archivedRows.length === 0) {
      body.innerHTML = '<tr><td colspan="18" class="empty-state">No model matches.</td></tr>';
      return;
    }

    let rank = 0;
    const buildRow = (m, isProvisional, isArchived) => {
      const tr = document.createElement('tr');
      const wr = (m.win_rate * 100).toFixed(1);
      const ppm = (m.points_per_match != null ? m.points_per_match : 0).toFixed(2);
      let rankCell;
      if (isArchived) {
        tr.className = 'archived';
        rankCell = `<td class="rank" title="Archived model">—</td>`;
      } else if (isProvisional) {
        tr.className = 'provisional';
        rankCell = `<td class="rank" title="Provisional — fewer than ${minMatches} matches played">—</td>`;
      } else {
        rank += 1;
        rankCell = `<td class="${rank === 1 ? 'rank gold' : 'rank'}">${rank}</td>`;
      }
      const tag = isArchived
        ? ` <span class="archived-badge" title="Archived — no longer active">archived</span>`
        : isProvisional
          ? ` <span class="prov-badge" title="Fewer than ${minMatches} matches — not yet ranked">prov.</span>`
          : '';
      tr.innerHTML =
        rankCell +
        `<td><div class="model-name">${modelFlag(m.model)}${esc(modelDisplayName(m))} ${effortBadge(m.reasoning_effort)}${modelNewBadge(m.model)}${tag}</div>` +
        `<div class="model-sub">${modelAuthorTag(m.model)}</div>` +
        `<div class="wr-bar"><span style="width:${wr}%"></span></div></td>` +
        `<td class="num"><strong>${ppm}</strong></td>` +
        `<td class="num">${wr}%</td>` +
        `<td class="num">${m.wins}</td>` +
        `<td class="num">${m.losses}</td>` +
        `<td class="num">${m.draws}</td>` +
        `<td class="num">${m.total}</td>` +
        `<td class="num">${m.points || 0}</td>` +
        `<td class="num">${m.nuclear_wins}</td>` +
        `<td class="num">${m.military_wins}</td>` +
        `<td class="num">${m.diplomatic_wins || 0}</td>` +
        `<td class="num">${m.mutual_destructions}</td>` +
        `<td class="num">${fmtMs(m.avg_think_ms)}</td>` +
        `<td class="num">${fmtTok(m.avg_tokens_per_turn)}</td>` +
        `<td class="num">${fmtUsd(m.avg_cost_per_match)}</td>` +
        `<td class="num">${fmtRate(m.invalid_action_rate)}</td>`;
      return tr;
    };

    // ── Active models ──────────────────────────────────────────────────────
    qualified.forEach((m) => body.appendChild(buildRow(m, false, false)));
    if (provisional.length && minMatches > 0) {
      const sep = document.createElement('tr');
      sep.className = 'lb-separator';
      sep.innerHTML = `<td colspan="18">Provisional — fewer than ${minMatches} matches played</td>`;
      body.appendChild(sep);
    }
    provisional.forEach((m) => body.appendChild(buildRow(m, true, false)));

    // ── Archived models (collapsible section) ──────────────────────────────
    if (archivedRows.length > 0) {
      const archSorted = archivedRows.slice().sort(cmp);
      // Toggle row (acts as the section header)
      const toggleRow = document.createElement('tr');
      toggleRow.className = 'lb-archive-toggle';
      toggleRow.innerHTML =
        `<td colspan="18">` +
        `<button class="archive-toggle-btn" aria-expanded="false">` +
        `<span class="archive-toggle-icon">▶</span> ` +
        `Archived models (${archSorted.length})` +
        `</button></td>`;
      body.appendChild(toggleRow);

      // Archived rows — hidden by default
      const archRows = archSorted.map((m) => {
        const tr = buildRow(m, false, true);
        tr.classList.add('archived-hidden');
        return tr;
      });
      archRows.forEach((tr) => body.appendChild(tr));

      // Wire up toggle
      const btn = toggleRow.querySelector('.archive-toggle-btn');
      btn.addEventListener('click', () => {
        const open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!open));
        btn.querySelector('.archive-toggle-icon').textContent = open ? '▶' : '▼';
        archRows.forEach((tr) => tr.classList.toggle('archived-hidden', open));
      });
    }
  }

  // Render only the current page of `filteredMatches`. Changing page re-renders
  // just this block (the rest of the page is untouched).
  function renderMatches() {
    const wrap = document.getElementById('matches');
    const pager = document.getElementById('matches-pager');
    wrap.innerHTML = '';
    if (pager) pager.innerHTML = '';

    const list = filteredMatches;
    if (!list || list.length === 0) {
      wrap.innerHTML = '<div class="empty-state">No replay available.</div>';
      return;
    }

    const pageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (matchPage > pageCount) matchPage = pageCount;
    const start = (matchPage - 1) * PAGE_SIZE;
    const pageItems = list.slice(start, start + PAGE_SIZE);

    for (const r of pageItems) {
      const a = document.createElement('a');
      a.className = 'match-card';
      a.href = `viewer.html?match=${encodeURIComponent(r.match_id)}`;
      const vt = r.victory_type || 'timeout';
      const winLabel = r.winner === 0 ? (r.p1_display_name || r.p1_model) : r.winner === 1 ? (r.p2_display_name || r.p2_model) : 'Draw';
      a.innerHTML =
        `<div class="mc-top"><span class="mc-id">${esc(r.match_id)}</span></div>` +
        `<div class="mc-vs"><span class="tag-p0">${modelFlag(r.p1_model)}${esc(r.p1_display_name || r.p1_model)} ${effortBadge(r.p1_reasoning_effort)}${modelAuthorTag(r.p1_model)}</span>` +
        `<span class="vs">vs</span><span class="tag-p1">${modelFlag(r.p2_model)}${esc(r.p2_display_name || r.p2_model)} ${effortBadge(r.p2_reasoning_effort)}${modelAuthorTag(r.p2_model)}</span></div>` +
        `<div class="mc-foot"><span>${formatDate(r.date)}</span>` +
        `<span>🏆 ${esc(winLabel)} · <span class="vt vt-${vt}">${VT_LABEL[vt] || vt}</span> · ${r.total_turns} turns</span></div>`;
      wrap.appendChild(a);
    }

    renderPager(pageCount, list.length);
  }

  // Pagination controls; shown only when there is more than one page.
  function renderPager(pageCount, total) {
    const pager = document.getElementById('matches-pager');
    if (!pager) return;
    pager.innerHTML = '';
    if (pageCount <= 1) return;

    const mkBtn = (label, page, opts = {}) => {
      const b = document.createElement('button');
      b.className = 'pg-btn' + (opts.active ? ' active' : '');
      b.textContent = label;
      if (opts.disabled) { b.disabled = true; }
      else b.addEventListener('click', () => { matchPage = page; renderMatches(); });
      return b;
    };

    pager.appendChild(mkBtn('‹', matchPage - 1, { disabled: matchPage <= 1 }));

    // windowed page numbers (max ~7 buttons)
    const win = 2;
    let lo = Math.max(1, matchPage - win), hi = Math.min(pageCount, matchPage + win);
    if (lo > 1) { pager.appendChild(mkBtn('1', 1, { active: matchPage === 1 })); if (lo > 2) pager.appendChild(ellipsis()); }
    for (let p = lo; p <= hi; p++) pager.appendChild(mkBtn(String(p), p, { active: p === matchPage }));
    if (hi < pageCount) { if (hi < pageCount - 1) pager.appendChild(ellipsis()); pager.appendChild(mkBtn(String(pageCount), pageCount, { active: matchPage === pageCount })); }

    pager.appendChild(mkBtn('›', matchPage + 1, { disabled: matchPage >= pageCount }));

    const info = document.createElement('span');
    info.className = 'pg-info';
    info.textContent = `${total} match${total > 1 ? 'es' : ''}`;
    pager.appendChild(info);
  }

  function ellipsis() {
    const s = document.createElement('span');
    s.className = 'pg-ellipsis';
    s.textContent = '…';
    return s;
  }

  // Think time is shown in SECONDS (models routinely take several seconds).
  function fmtMs(ms) {
    if (!ms) return '—';
    const s = ms / 1000;
    return (s >= 10 ? s.toFixed(0) : s.toFixed(1)) + 's';
  }
  function fmtTok(n) {
    if (!n) return '—';
    return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : Math.round(n);
  }
  function fmtRate(r) {
    if (r == null) return '—';
    return (r * 100).toFixed(1) + '%';
  }
  function fmtUsd(v) {
    if (!v) return '—';
    return v >= 1 ? '$' + v.toFixed(2) : '$' + v.toFixed(v >= 0.01 ? 3 : 4);
  }

  function formatDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('en-US', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return iso; }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── Snapshot / share ──────────────────────────────────────────────────────
  // Captures the leaderboard table as a PNG with a branded footer stamp:
  //   Age of LLM™ — Benchmark  |  ageofllm.com  |  <date>
  function bindSnapshot() {
    const btn = document.getElementById('btn-snapshot');
    if (!btn) return;

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const origText = btn.textContent;
      btn.textContent = '⏳ Capturing…';

      try {
        // 1. Build an off-screen wrapper that contains only the table section.
        const wrapper = document.createElement('div');
        wrapper.style.cssText = [
          'position:fixed', 'top:-9999px', 'left:-9999px',
          'background:#0a0e14', 'padding:28px 28px 20px',
          'font-family:Inter,system-ui,sans-serif',
          'min-width:900px',
        ].join(';');

        // Header clone: logo + title
        const hdr = document.createElement('div');
        hdr.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:14px;';
        const logoEl = document.querySelector('.lb-header .header-logo');
        if (logoEl) {
          const logoClone = logoEl.cloneNode(true);
          logoClone.style.width = '28px';
          logoClone.style.height = '28px';
          hdr.appendChild(logoClone);
        }
        const titleEl = document.createElement('span');
        titleEl.style.cssText = 'color:#e8eef5;font-size:20px;font-weight:800;letter-spacing:.4px;';
        titleEl.textContent = 'Age of LLM\u2122 \u2014 Benchmark';
        hdr.appendChild(titleEl);
        wrapper.appendChild(hdr);

        // Table clone (only the qualified / provisional rows — no archived toggle)
        const tableClone = document.getElementById('lb-table').cloneNode(true);
        // Remove hidden archived rows from clone
        tableClone.querySelectorAll('.archived-hidden, .lb-archive-toggle').forEach((r) => r.remove());
        tableClone.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px;';
        wrapper.appendChild(tableClone);

        // Branded footer stamp
        const stamp = document.createElement('div');
        const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        stamp.style.cssText = [
          'margin-top:14px', 'padding-top:10px',
          'border-top:1px solid #28323f',
          'display:flex', 'justify-content:space-between', 'align-items:center',
          'font-size:11px', 'color:#8a97a6',
        ].join(';');
        stamp.innerHTML =
          '<span>Age of LLM\u2122 \u2014 Benchmark</span>' +
          '<a style="color:#4da6ff;text-decoration:none" href="https://ageofllm.org">ageofllm.org</a>' +
          `<span>${today}</span>`;
        wrapper.appendChild(stamp);

        document.body.appendChild(wrapper);

        let canvas;
        try {
          // 2. html2canvas capture
          canvas = await window.html2canvas(wrapper, {
            backgroundColor: '#0a0e14',
            scale: 2,
            useCORS: true,
            logging: false,
          });
        } finally {
          // Always remove the off-screen clone to avoid a DOM leak on error.
          if (document.body.contains(wrapper)) document.body.removeChild(wrapper);
        }

        // 3. Trigger download
        const link = document.createElement('a');
        const dateStr = new Date().toISOString().slice(0, 10);
        link.download = `age-of-llm-benchmark-${dateStr}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
      } catch (err) {
        console.error('Snapshot failed', err);
        alert('Snapshot failed — see browser console for details.');
      } finally {
        btn.disabled = false;
        btn.textContent = origText;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => { init(); bindSnapshot(); });
})();
