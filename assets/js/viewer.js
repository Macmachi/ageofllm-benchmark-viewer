/*! Age of LLM · Copyright (C) 2026 Rymentz · AGPL-3.0-or-later · https://ageofllm.org */
(function() {
  "use strict";
  const VICTORY_LABEL = {
    nuclear: { ttl: "NUCLEAR VICTORY", bolt: "☢" },
    military: { ttl: "MILITARY VICTORY", bolt: "⚔" },
    ultimatum: { ttl: "ULTIMATUM VICTORY", bolt: "📜" },
    peace: { ttl: "DRAW · PEACE", bolt: "🕊" },
    mutual_destruction: { ttl: "MUTUAL DESTRUCTION", bolt: "☢" },
    timeout: { ttl: "DRAW · TIMEOUT", bolt: "⏳" }
  };
  const EFFORT_LABEL = { high: "HIGH", medium: "MED", low: "LOW", off: "OFF", na: "NA" };
  function effortLabel(effort) {
    const e = String(effort || "off").toLowerCase();
    return { label: EFFORT_LABEL[e] || e.toUpperCase(), cls: e };
  }
  const els = {};
  let replay = null;
  let playback = null;
  let ctx = null;
  let dims = null;
  let view = "spectator";
  let lastFrame = null;
  let bombCost = 25;
  function scrollPanelToBottom(id) {
    if (playback && !playback.playing) return;
    const panel = $(id);
    if (!panel || panel.style.display === "none") return;
    const body = panel.querySelector(".panel-body");
    if (body) body.scrollTop = body.scrollHeight;
  }
  const INITIAL_ZOOM = 1.35;
  const camera = { zoom: INITIAL_ZOOM, panX: 0, panY: 0 };
  const ZOOM_MIN = 0.4, ZOOM_MAX = 3, ZOOM_STEP = 1.15;
  function $(id) {
    return document.getElementById(id);
  }
  const MATCH_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
  function shownId(id) {
    return String(id ?? "").replace(/(\d{4}-\d\d)-\d\d(?:[_T]\d\d:?\d\d(?::?\d\d)?)?/g, "$1");
  }
  function getMatchId() {
    const p = new URLSearchParams(location.search);
    return p.get("match") || null;
  }
  function replayProblem(rep) {
    const obj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
    if (!obj(rep) || !obj(rep.meta) || !Array.isArray(rep.turns)) return "This file is not a match replay.";
    if (!rep.turns.length) return "This replay holds no turn.";
    const pl = rep.meta.players;
    if (!Array.isArray(pl) || pl.length < 2 || !obj(pl[0]) || !obj(pl[1])) return "This replay does not name its two players.";
    const bad = rep.turns.findIndex((t) => !obj(t) || !Array.isArray(t.players_state) || t.players_state.length < 2 || !obj(t.players_state[0]) || !obj(t.players_state[1]));
    if (bad >= 0) return `This replay is damaged (half-turn ${bad + 1}).`;
    return null;
  }
  async function init() {
    cacheEls();
    const matchId = getMatchId();
    if (!matchId) {
      showError("No match specified. Use viewer.html?match=ID");
      return;
    }
    if (!MATCH_ID.test(matchId) || matchId.includes("..")) {
      showError(`"${escapeHtml(shownId(matchId))}" is not the name of a replay.`);
      return;
    }
    try {
      const [rep] = await Promise.all([
        fetchJSON(`replays/${encodeURIComponent(matchId)}.json`),
        Sprites.preload()
      ]);
      const problem = replayProblem(rep);
      if (problem) throw new Error(problem);
      replay = rep;
    } catch (e) {
      showError(`Could not load replay "${escapeHtml(shownId(matchId))}".<br><span style="color:var(--text-faint)">${escapeHtml(e.message)}</span>`);
      return;
    }
    try {
      bombCost = Number(replay.meta.bomb_base_cost) || 25;
      setupCanvas();
      setupPlayback();
      bindUI();
      bindKeyboard();
      $("loading").classList.add("hidden");
      $("match-id").textContent = shownId(replay.meta.match_id ?? matchId);
      const verEl = document.querySelector(".ver");
      const ev = replay.engine_version || replay.meta.engine_version;
      if (verEl && ev) verEl.textContent = `Benchmark · v${ev}`;
      renderStaticHeader();
      playback.start();
    } catch (e) {
      if (playback) playback.pause();
      showError(`Could not show replay "${escapeHtml(shownId(matchId))}".<br><span style="color:var(--text-faint)">${escapeHtml(e.message)}</span>`);
    }
  }
  function cacheEls() {
    [
      "loading",
      "match-id",
      "turn-label",
      "scrubber",
      "t-play",
      "reason-text",
      "reason-actions",
      "reason-badge",
      "reason-discovered",
      "reason-launch",
      "diplo-log",
      "diplo-count",
      "victory",
      "vttl",
      "vsub",
      "vbolt"
    ].forEach((id) => els[id] = $(id));
  }
  function fetchJSON(url) {
    return fetch(url).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
  }
  function showError(html) {
    const l = $("loading");
    l.classList.remove("hidden");
    l.innerHTML = `<div class="error-box">⚠ ${html}</div>`;
  }
  function setupCanvas() {
    const canvas = $("board");
    ctx = canvas.getContext("2d");
    resize();
    window.addEventListener("resize", () => {
      resize();
      redraw();
    });
    bindCamera(canvas);
  }
  function resize() {
    dims = Renderer.resize($("board"));
  }
  function redraw() {
    if (lastFrame) drawFrame(lastFrame);
  }
  function setZoom(z, cx, cy) {
    const old = camera.zoom;
    const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    if (next === old) return;
    if (cx != null && cy != null && dims) {
      const ratio = next / old;
      const dx = cx - dims.cw / 2;
      const dy = cy - dims.ch / 2;
      camera.panX = dx * (1 - ratio) + camera.panX * ratio;
      camera.panY = dy * (1 - ratio) + camera.panY * ratio;
    }
    camera.zoom = next;
    redraw();
  }
  function resetCamera() {
    camera.zoom = INITIAL_ZOOM;
    camera.panX = 0;
    camera.panY = 0;
    redraw();
  }
  function bindCamera(canvas) {
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setZoom(camera.zoom * factor, cx, cy);
    }, { passive: false });
    let dragging = false, lastX = 0, lastY = 0, moved = false;
    canvas.addEventListener("pointerdown", (e) => {
      dragging = true;
      moved = false;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      camera.panX += dx;
      camera.panY += dy;
      lastX = e.clientX;
      lastY = e.clientY;
      redraw();
    });
    const endDrag = (e) => {
      dragging = false;
      canvas.style.cursor = "grab";
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (_) {
      }
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.style.cursor = "grab";
    let pinchDist = null;
    canvas.addEventListener("touchmove", (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const [t1, t2] = e.touches;
        const d = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const rect = canvas.getBoundingClientRect();
        const mx = (t1.clientX + t2.clientX) / 2 - rect.left;
        const my = (t1.clientY + t2.clientY) / 2 - rect.top;
        if (pinchDist != null && pinchDist > 0) {
          setZoom(camera.zoom * (d / pinchDist), mx, my);
        }
        pinchDist = d;
      }
    }, { passive: false });
    canvas.addEventListener("touchend", () => {
      pinchDist = null;
    });
    const zin = $("zoom-in"), zout = $("zoom-out"), zreset = $("zoom-reset");
    if (zin) zin.addEventListener("click", () => setZoom(camera.zoom * ZOOM_STEP, dims.cw / 2, dims.ch / 2));
    if (zout) zout.addEventListener("click", () => setZoom(camera.zoom / ZOOM_STEP, dims.cw / 2, dims.ch / 2));
    if (zreset) zreset.addEventListener("click", resetCamera);
  }
  function setupPlayback() {
    playback = new Player.Playback(replay, {
      actionMs: 900,
      launchActionMs: 2200,
      nukeMs: 2600,
      onFrame: drawFrame,
      onTurnChange,
      onEnd: () => {
        setPlayIcon(false);
      }
    });
    els.scrubber.max = String(playback.count - 1);
  }
  let drawFailed = false;
  function drawFrame(frame) {
    lastFrame = frame;
    try {
      Renderer.draw(ctx, replay, frame, { dims, view, camera });
      updateHud(frame);
    } catch (e) {
      if (!drawFailed) console.error("Replay frame:", e);
      drawFailed = true;
    }
    const isFinal = frame.turnIndex === playback.count - 1 && frame.animT >= 0.98;
    toggleVictory(isFinal);
  }
  function onTurnChange(idx, turn) {
    els.scrubber.value = String(idx);
    els["turn-label"].textContent = `Turn ${turn.turn}`;
    try {
      updatePanels(turn, idx);
    } catch (e) {
      console.error("Replay panels:", e);
    }
  }
  function playerDisplayName(player) {
    const flag = window.MODEL_META?.[player.model]?.flag;
    return `${flag ? flag + " " : ""}${player.name || player.model}`;
  }
  function renderStaticHeader() {
    const [a, b] = replay.meta.players;
    $("name0").textContent = playerDisplayName(a);
    $("model0").textContent = a.model;
    $("name1").textContent = playerDisplayName(b);
    $("model1").textContent = b.model;
    for (let i = 0; i < 2; i++) {
      const p = replay.meta.players[i];
      const el = $(`effort${i}`);
      if (!el) continue;
      if (p.decision_interface?.kind === "choice") {
        el.textContent = "CHOICE";
        el.className = "peffort effort-na";
        el.title = window.choiceInterfaceTitle(p.decision_interface);
        continue;
      }
      const { label, cls } = effortLabel(p.reasoning_effort);
      el.textContent = label;
      el.className = `peffort effort-${cls}`;
      el.title = "Reasoning effort";
    }
  }
  function updateHud(frame) {
    const turn = replay.turns[frame.turnIndex];
    const ps = turn.players_state;
    const showU = view === "spectator";
    const unitCount = [0, 0], bldgCount = [0, 0];
    for (const u of turn.units || []) if (u.owner === 0 || u.owner === 1) unitCount[u.owner]++;
    for (const b of turn.buildings || []) {
      if ((b.owner === 0 || b.owner === 1) && b.hp > 0) bldgCount[b.owner]++;
    }
    for (let i = 0; i < 2; i++) {
      $(`cred${i}`).textContent = `◆${ps[i].credits}`;
      const ura = $(`ura${i}`);
      const own = view === "p0" && i === 0 || view === "p1" && i === 1;
      if (showU || own) {
        ura.textContent = `☢${ps[i].uranium}`;
        ura.classList.remove("secret");
      } else {
        ura.textContent = "☢?";
        ura.classList.add("secret");
      }
      const uel = $(`units${i}`), bel = $(`blds${i}`);
      if (uel) uel.textContent = `⛬${unitCount[i]}`;
      if (bel) bel.textContent = `🏚${bldgCount[i]}`;
    }
    $("card0").classList.toggle("active-turn", frame.activePlayer === 0);
    $("card1").classList.toggle("active-turn", frame.activePlayer === 1);
    updateBombHud(turn, showU, view);
    updateDiploHud(frame.turnIndex);
    updatePerfHud(frame.turnIndex);
  }
  const PROPOSAL_KINDS = new Set(["ceasefire", "peace", "ultimatum"]);
  const LEGACY_CEASEFIRE_DURATION = 3;
  function diploStatus(turnIndex) {
    const frames = replay.turns || [];
    const now = frames[turnIndex];
    if (!now) return { ceasefireLeft: null, pending: [] };
    const nowTurn = now.turn;
    let until = null;
    if (Object.prototype.hasOwnProperty.call(now, "ceasefire_until")) {
      until = now.ceasefire_until;
    } else {
      for (let i = 0; i <= turnIndex; i++) {
        for (const e of frames[i].diplomacy || []) {
          if (e.kind === "ceasefire" && e.response === "accepted") {
            const end = frames[i].turn + LEGACY_CEASEFIRE_DURATION;
            if (until === null || end > until) until = end;
          }
        }
      }
    }
    const ceasefireLeft = until !== null && until !== void 0 && nowTurn <= until ? until - nowTurn + 1 : null;
    const key = (e) => `${e.from}|${e.to}|${e.kind}|${e.turn}`;
    const answered = new Set(), open = new Map();
    for (let i = 0; i <= turnIndex; i++) {
      for (const e of frames[i].diplomacy || []) {
        if (!PROPOSAL_KINDS.has(e.kind)) continue;
        const k = key(e);
        if (e.response) {
          answered.add(k);
          open.delete(k);
        } else if (!answered.has(k)) open.set(k, e);
      }
    }
    return { ceasefireLeft, pending: [...open.values()] };
  }
  function updateDiploHud(turnIndex) {
    const { ceasefireLeft, pending } = diploStatus(turnIndex);
    for (let i = 0; i < 2; i++) {
      const host = $(`diplo${i}`);
      if (!host) continue;
      host.innerHTML = "";
      if (ceasefireLeft !== null) {
        const b = document.createElement("span");
        b.className = "pdiplo-badge cf";
        b.textContent = `🕊 Ceasefire · ${ceasefireLeft} turn${ceasefireLeft > 1 ? "s" : ""} left`;
        b.title = "No attack allowed between the two players. Launching the bomb is still possible but costs extra.";
        host.appendChild(b);
      }
      for (const e of pending) {
        if (e.from !== i) continue;
        const b = document.createElement("span");
        b.className = "pdiplo-badge pending";
        const label = e.kind.charAt(0).toUpperCase() + e.kind.slice(1);
        b.textContent = `📨 ${label} offered · awaiting reply`;
        b.title = e.text || "";
        host.appendChild(b);
      }
    }
  }
  function updateBombHud(turn, showU, viewMode) {
    const ps = turn.players_state;
    for (let i = 0; i < 2; i++) {
      const p = ps[i];
      const cost = p.bomb_cost || bombCost;
      const hasSilo = p.has_silo !== void 0 ? !!p.has_silo : (turn.buildings || []).some((b) => b.type === "silo" && b.owner === i && b.hp > 0);
      const baseFound = !!(p.knowledge && p.knowledge.enemy_base_discovered);
      const uraOk = p.uranium >= cost;
      const ready = hasSilo && baseFound && uraOk;
      const frac = Math.max(0, Math.min(1, cost ? p.uranium / cost : 0));
      const fill = $(`bombfill${i}`);
      const pct = $(`bombpct${i}`);
      const own = viewMode === "p0" && i === 0 || viewMode === "p1" && i === 1;
      const reveal = showU || own;
      if (reveal) {
        fill.style.width = Math.round(frac * 100) + "%";
        pct.textContent = ready ? "READY" : `${Math.round(frac * 100)}%`;
      } else {
        fill.style.width = "0%";
        pct.textContent = "?";
      }
      fill.classList.toggle("ready", reveal && ready);
      pct.classList.toggle("ready", reveal && ready);
      setReq($(`req${i}-silo`), hasSilo);
      setReq($(`req${i}-ura`), reveal ? uraOk : null);
      setReq($(`req${i}-base`), baseFound);
    }
  }
  function setReq(el, ok) {
    if (!el) return;
    el.classList.remove("ok", "ko", "unknown");
    el.classList.add(ok === null ? "unknown" : ok ? "ok" : "ko");
  }
  function perfUpTo(turnIdx) {
    const acc = {
      0: { tokens: 0, lastMs: null, lastTok: null, hasTokens: false, msSum: 0, msCount: 0 },
      1: { tokens: 0, lastMs: null, lastTok: null, hasTokens: false, msSum: 0, msCount: 0 }
    };
    for (let i = 0; i <= turnIdx && i < replay.turns.length; i++) {
      const t = replay.turns[i];
      const p = t.perf;
      if (!p) continue;
      const who = t.active_player;
      if (typeof p.think_ms === "number") {
        acc[who].lastMs = p.think_ms;
        acc[who].msSum += p.think_ms;
        acc[who].msCount++;
      }
      if (p.tokens && typeof p.tokens.total === "number") {
        acc[who].tokens += p.tokens.total;
        acc[who].lastTok = p.tokens.total;
        acc[who].hasTokens = true;
      }
    }
    return acc;
  }
  function fmtTokens(n) {
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "k";
    return String(n);
  }
  function fmtMs(ms) {
    if (ms == null) return "";
    const s = ms / 1e3;
    return (s >= 10 ? s.toFixed(0) : s.toFixed(1)) + "s";
  }
  function updatePerfHud(turnIdx) {
    const acc = perfUpTo(turnIdx);
    for (let i = 0; i < 2; i++) {
      const tokEl = $(`tok${i}`), thkEl = $(`thk${i}`);
      if (!tokEl || !thkEl) continue;
      const a = acc[i];
      tokEl.textContent = a.hasTokens ? `▦ ${a.lastTok != null ? fmtTokens(a.lastTok) : "–"} tok (Σ${fmtTokens(a.tokens)})` : "";
      if (a.lastMs != null) {
        const avg = a.msCount ? a.msSum / a.msCount : null;
        thkEl.textContent = `⏱ ${fmtMs(a.lastMs)}` + (avg != null ? ` (avg ${fmtMs(Math.round(avg))})` : "");
      } else {
        thkEl.textContent = "";
      }
    }
  }
  function updatePanels(turn, idx) {
    const ap = turn.active_player === 1 ? 1 : 0;
    const ps = turn.players_state[ap];
    els["reason-text"].textContent = ps.reasoning || "–";
    const badge = els["reason-badge"];
    badge.textContent = String(ap + 1);
    badge.className = ap === 0 ? "badge-p0" : "badge-p1";
    scrollPanelToBottom("reason-panel");
    els["reason-actions"].innerHTML = "";
    for (const a of turn.actions || []) {
      const span = document.createElement("span");
      span.className = "chip";
      let label = a.type;
      if (a.unit_type) label += `:${a.unit_type}`;
      else if (a.target) label += `:${a.target}`;
      else if (a.unit) label += `:${String(a.unit).split("_").slice(1).join("")}`;
      span.textContent = label;
      els["reason-actions"].appendChild(span);
    }
    const disc = ps.knowledge && ps.knowledge.enemy_base_discovered;
    els["reason-discovered"].style.display = disc ? "flex" : "none";
    const warned = ps.knowledge && ps.knowledge.enemy_launch_detected;
    if (els["reason-launch"]) {
      els["reason-launch"].style.display = warned ? "flex" : "none";
    }
    renderDiplomacy(idx);
    const sp = $("stats-panel");
    if (sp && sp.style.display !== "none") {
      Stats.render(replay, idx, $("stats-host"));
    }
  }
  function renderDiplomacy(upto) {
    const log = [];
    let newThisTurn = 0;
    for (let i = 0; i <= upto && i < replay.turns.length; i++) {
      const t = replay.turns[i];
      for (const d of Array.isArray(t.diplomacy) ? t.diplomacy : []) {
        if (!d || typeof d !== "object") continue;
        log.push({ ...d, _turn: t.turn });
        if (i === upto) newThisTurn++;
      }
    }
    const box = els["diplo-log"];
    box.innerHTML = "";
    if (log.length === 0) {
      box.innerHTML = '<div class="diplo-empty">No diplomatic exchange.</div>';
    } else {
      for (let i = 0; i < log.length; i++) {
        const d = log[i];
        const div = document.createElement("div");
        const isNew = i >= log.length - newThisTurn;
        div.className = `diplo-item from${d.from === 1 ? 1 : 0}` + (isNew ? " diplo-new" : "");
        const respVal = d.response === "accepted" || d.response === "refused" ? d.response : null;
        const resp = respVal ? `<span class="resp-${respVal}">${respVal}</span>` : "";
        div.innerHTML = `<div class="dhead"><span class="diplo-turn">T${escapeHtml(d._turn)}</span><span>${escapeHtml(playerName(d.from))} → ${escapeHtml(playerName(d.to))}</span><span class="kind">${escapeHtml(String(d.kind || ""))}</span></div><div>${escapeHtml(d.text || "")}</div>` + (resp ? `<div style="margin-top:3px">${resp}</div>` : "");
        box.appendChild(div);
      }
    }
    const cnt = els["diplo-count"];
    if (log.length > 0) {
      cnt.style.display = "grid";
      cnt.textContent = String(log.length);
    } else cnt.style.display = "none";
    const panel = $("diplo-panel");
    if (panel && panel.style.display !== "none") {
      const body = panel.querySelector(".panel-body");
      if (body) body.scrollTop = body.scrollHeight;
    }
    notifyDiplomacy(newThisTurn, log[log.length - 1]);
  }
  function notifyDiplomacy(newCount, lastEntry) {
    const btn = $("btn-diplo");
    const panelOpen = $("diplo-panel").style.display !== "none";
    if (btn) btn.classList.toggle("notify", newCount > 0 && !panelOpen);
    if (newCount > 0 && !panelOpen && lastEntry) {
      const from = playerName(lastEntry.from);
      const kind = String(lastEntry.kind || "message");
      showDiploToast(`💬 ${escapeHtml(from)}: ${escapeHtml(kind)}`);
    }
  }
  let _toastTimer = null;
  function showDiploToast(html) {
    let toast = $("diplo-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "diplo-toast";
      toast.className = "diplo-toast";
      toast.addEventListener("click", () => {
        const btn = $("btn-diplo");
        if ($("diplo-panel").style.display === "none" && btn) btn.click();
        toast.classList.remove("show");
      });
      document.body.appendChild(toast);
    }
    toast.innerHTML = html;
    toast.classList.add("show");
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
  }
  function toggleVictory(show) {
    const v = els.victory;
    if (!show) {
      v.classList.add("hidden");
      return;
    }
    const meta = replay.meta;
    const info = Object.prototype.hasOwnProperty.call(VICTORY_LABEL, meta.victory_type) && VICTORY_LABEL[meta.victory_type] || { ttl: "GAME OVER", bolt: "⚑" };
    els.vttl.textContent = info.ttl;
    els.vbolt.textContent = info.bolt;
    if (meta.winner === 0 || meta.winner === 1) {
      const w = meta.players[meta.winner];
      els.vsub.textContent = `${playerDisplayName(w)} · ${w.model}`;
    } else {
      els.vsub.textContent = "No winner";
    }
    v.classList.remove("hidden");
  }
  function bindUI() {
    $("t-play").addEventListener("click", () => {
      playback.toggle();
      setPlayIcon(playback.playing);
    });
    $("t-first").addEventListener("click", () => {
      playback.first();
      setPlayIcon(false);
    });
    $("t-prev").addEventListener("click", () => {
      playback.prev();
      setPlayIcon(false);
    });
    $("t-next").addEventListener("click", () => {
      playback.next();
      setPlayIcon(false);
    });
    $("t-last").addEventListener("click", () => {
      playback.last();
      setPlayIcon(false);
    });
    els.scrubber.addEventListener("input", (e) => {
      playback.seek(Number(e.target.value));
      setPlayIcon(false);
    });
    document.querySelectorAll("#speeds .sp").forEach((b) => {
      b.addEventListener("click", () => {
        document.querySelectorAll("#speeds .sp").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        playback.setSpeed(Number(b.dataset.sp));
      });
    });
    document.querySelectorAll("#view-toggle .btn").forEach((b) => {
      b.addEventListener("click", () => {
        document.querySelectorAll("#view-toggle .btn").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        view = b.dataset.view;
        if (lastFrame) drawFrame(lastFrame);
      });
    });
    bindToggle("btn-reason", "reason-panel", false);
    bindToggle("btn-diplo", "diplo-panel", false, "amber", () => {
      $("btn-diplo").classList.remove("notify");
    });
    bindToggle("btn-stats", "stats-panel", false, null, () => {
      Stats.render(replay, playback.idx, $("stats-host"));
    });
    bindToggle("btn-legend", "legend-panel", false);
    document.querySelectorAll("[data-close]").forEach((x) => {
      x.addEventListener("click", () => {
        const id = x.dataset.close;
        $(id).style.display = "none";
        syncRailButtons();
        updateBackdrop();
      });
    });
    const bd = ensureBackdrop();
    bd.addEventListener("click", closeAllPanels);
  }
  const PANEL_IDS = ["reason-panel", "diplo-panel", "stats-panel", "legend-panel"];
  function ensureBackdrop() {
    let bd = $("panel-backdrop");
    if (!bd) {
      bd = document.createElement("div");
      bd.id = "panel-backdrop";
      bd.className = "panel-backdrop";
      document.body.appendChild(bd);
    }
    return bd;
  }
  function anyPanelOpen() {
    return PANEL_IDS.some((id) => {
      const p = $(id);
      return p && p.style.display !== "none";
    });
  }
  function updateBackdrop() {
    ensureBackdrop().classList.toggle("show", anyPanelOpen());
  }
  function closeAllPanels() {
    PANEL_IDS.forEach((id) => {
      const p = $(id);
      if (p) p.style.display = "none";
    });
    syncRailButtons();
    updateBackdrop();
  }
  function bindToggle(btnId, panelId, startOpen, cls, onOpen) {
    const btn = $(btnId), panel = $(panelId);
    panel.style.display = startOpen ? "flex" : "none";
    btn.addEventListener("click", () => {
      const open = panel.style.display !== "none";
      panel.style.display = open ? "none" : "flex";
      btn.classList.toggle("on", !open);
      if (cls) btn.classList.toggle(cls, !open);
      if (!open && typeof onOpen === "function") onOpen();
      updateBackdrop();
    });
    if (startOpen) {
      btn.classList.add("on");
      if (cls) btn.classList.add(cls);
    }
  }
  function syncRailButtons() {
    setOn("btn-reason", "reason-panel");
    setOn("btn-diplo", "diplo-panel", "amber");
    setOn("btn-stats", "stats-panel");
    setOn("btn-legend", "legend-panel");
  }
  function setOn(btnId, panelId, cls) {
    const open = $(panelId).style.display !== "none";
    $(btnId).classList.toggle("on", open);
    if (cls) $(btnId).classList.toggle(cls, open);
  }
  function setPlayIcon(playing) {
    els["t-play"].textContent = playing ? "⏸" : "▶";
  }
  function bindKeyboard() {
    window.addEventListener("keydown", (e) => {
      if (e.target === els.scrubber && /^Arrow|^(Home|End|PageUp|PageDown)$/.test(e.key)) return;
      if (e.code === "Space") {
        e.preventDefault();
        playback.toggle();
        setPlayIcon(playback.playing);
      } else if (e.code === "ArrowRight") {
        playback.next();
        setPlayIcon(false);
      } else if (e.code === "ArrowLeft") {
        playback.prev();
        setPlayIcon(false);
      } else if (e.key === "+" || e.key === "=") {
        setZoom(camera.zoom * ZOOM_STEP, dims.cw / 2, dims.ch / 2);
      } else if (e.key === "-" || e.key === "_") {
        setZoom(camera.zoom / ZOOM_STEP, dims.cw / 2, dims.ch / 2);
      } else if (e.key === "0") {
        resetCamera();
      } else if (e.key === "h" || e.key === "H") {
        ["reason-panel", "diplo-panel"].forEach((id) => {
          const p = $(id);
          p.style.display = p.style.display === "none" ? "flex" : "none";
        });
        syncRailButtons();
        updateBackdrop();
        if (lastFrame) drawFrame(lastFrame);
      } else if (e.code === "Escape") {
        closeAllPanels();
      }
    });
  }
  function playerName(i) {
    const p = Number.isInteger(i) ? replay.meta.players[i] : null;
    return p && (p.name || p.model) || `Player ${Number.isInteger(i) ? i + 1 : "?"}`;
  }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  document.addEventListener("DOMContentLoaded", init);
})();
