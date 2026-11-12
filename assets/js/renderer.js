/*! Age of LLM · Copyright (C) 2026 Rymentz · AGPL-3.0-or-later · https://ageofllm.org */
const Renderer = (() => {
  const C = {
    bg: "#0a0e14",
    tileA: "#16202b",
    tileB: "#241a26",
    passage: "#15301f",
    edge: "#33414f",
    edgeSoft: "#2a3540",
    depA: "#0f1820",
    depB: "#1a1018",
    depPass: "#0d2317",
    p0: "#4da6ff",
    p1: "#ff5d6c",
    credit: "#d4af37",
    uranium: "#5fd95f",
    uraniumCentral: "#39ff77",
    fog: "#05080c",
    fogTile: "#0a0f15",
    fogMemory: "#161d27",
    hpGood: "#5fd95f",
    hpMid: "#e0b020",
    hpBad: "#e0503a",
    hpBack: "#10161d",
    text: "#e8eef5",
    shadow: "rgba(0,0,0,0.38)"
  };
  const MAXHP = {
    base: 4,
    silo: 3,
    credit_mine: 2,
    uranium_mine: 2,
    uranium_mine_central: 3
  };
  const UNIT_SCALE = 0.52;
  const BLDG_SCALE = 0.66;
  const FOOT_HALF = 90 * 0.5 / 2;
  function resize(canvas) {
    const wrap = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const cw = wrap.clientWidth, ch = wrap.clientHeight;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    canvas.style.width = cw + "px";
    canvas.style.height = ch + "px";
    return { cw, ch, dpr };
  }
  const tkey = (c, r) => c + "," + r;
  function buildTerrainIndex(replay) {
    const t = replay.terrain || {};
    const mtn = new Set((t.mountains || []).map(([c, r]) => tkey(c, r)));
    const pass = new Set((t.passages || []).map(([c, r]) => tkey(c, r)));
    return { mtn, pass, key: tkey };
  }
  let _terrainCache = null, _terrainFor = null;
  function terrain(replay) {
    if (_terrainFor !== replay) {
      _terrainCache = buildTerrainIndex(replay);
      _terrainFor = replay;
    }
    return _terrainCache;
  }
  let _depCache = null, _depForReplay = null, _depForTurn = null;
  function depositsFor(replay, turn) {
    if (_depForReplay === replay && _depForTurn === turn && _depCache) return _depCache;
    const src = turn && turn.deposits ? turn.deposits : replay.terrain && replay.terrain.deposits || {};
    const dep = new Map();
    for (const [c, r] of src.credits || []) dep.set(tkey(c, r), "credits");
    for (const [c, r] of src.uranium || []) dep.set(tkey(c, r), "uranium");
    for (const [c, r] of src.uranium_central || []) dep.set(tkey(c, r), "uranium_central");
    _depCache = dep;
    _depForReplay = replay;
    _depForTurn = turn;
    return dep;
  }
  function fogFor(view, replay, turn) {
    if (view !== "p0" && view !== "p1") return null;
    const side = view === "p0" ? 0 : 1;
    const ps = turn && turn.players_state && turn.players_state[side];
    const set = new Set();
    if (ps && Array.isArray(ps.visible_cells)) {
      for (const [c, r] of ps.visible_cells) set.add(c + "," + r);
    }
    const remembered = new Set();
    const rb = ps && ps.knowledge && ps.knowledge.remembered_enemy_buildings;
    if (Array.isArray(rb)) {
      for (const m of rb) {
        if (m && Array.isArray(m.pos)) remembered.add(m.pos[0] + "," + m.pos[1]);
      }
    }
    return { side, visible: set, remembered };
  }
  function isFoggedCell(col, row, fog) {
    if (!fog) return false;
    return !fog.visible.has(col + "," + row);
  }
  function isRememberedCell(col, row, fog) {
    if (!fog) return false;
    return fog.remembered.has(col + "," + row);
  }
  function diamond(ctx, x, y, tw, th) {
    ctx.beginPath();
    ctx.moveTo(x, y - th / 2);
    ctx.lineTo(x + tw / 2, y);
    ctx.lineTo(x, y + th / 2);
    ctx.lineTo(x - tw / 2, y);
    ctx.closePath();
  }
  function drawSpriteCentered(ctx, img, cx, baseY, scale, alpha = 1) {
    if (!img) return;
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, cx - w / 2, baseY - h, w, h);
    ctx.globalAlpha = 1;
  }
  function applyCamera(v, cam, cw, ch) {
    const z = cam.zoom || 1;
    v.tileW *= z;
    v.tileH *= z;
    v.scale *= z;
    v.originX = cw / 2 + (v.originX - cw / 2) * z + (cam.panX || 0);
    v.originY = ch / 2 + (v.originY - ch / 2) * z + (cam.panY || 0);
  }
  function draw(ctx, replay, frame, opts) {
    const { cw, ch, dpr } = opts.dims;
    const view = opts.view || "spectator";
    const cam = opts.camera || { zoom: 1, panX: 0, panY: 0 };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, cw, ch);
    const W = replay.meta.grid_width, H = replay.meta.grid_height;
    const v = Iso.makeView(W, H, cw, ch, 36);
    applyCamera(v, cam, cw, ch);
    const T = terrain(replay);
    const turn = replay.turns[frame.turnIndex];
    const dep = depositsFor(replay, turn);
    const fog = fogFor(view, replay, turn);
    for (let s = 0; s <= W - 1 + (H - 1); s++) {
      for (let c = 0; c < W; c++) {
        const r = s - c;
        if (r < 0 || r >= H) continue;
        drawTile(ctx, c, r, v, T, dep, fog);
      }
    }
    const drawList = [];
    for (const b of frame.buildings) {
      const [c, r] = b.pos;
      if (isFoggedCell(c, r, fog)) {
        if (!isRememberedCell(c, r, fog)) continue;
        drawList.push({ z: Iso.depthKey(c, r, 0.5), kind: "building", e: b, _memory: true });
        continue;
      }
      drawList.push({ z: Iso.depthKey(c, r, 0.5), kind: "building", e: b });
    }
    for (const u of frame.units) {
      const c = Math.round(u.drawCol), r = Math.round(u.drawRow);
      if (isFoggedCell(c, r, fog)) continue;
      const layer = u.altitude === "air" ? 2 : 1;
      drawList.push({ z: Iso.depthKey(u.drawCol, u.drawRow, layer), kind: "unit", e: u });
    }
    drawList.sort((a, b) => a.z - b.z);
    for (const item of drawList) {
      if (item.kind === "building") drawBuilding(ctx, item.e, v, item._memory);
      else drawUnit(ctx, item.e, v);
    }
    for (const ov of frame.overlays || []) {
      if (fog) {
        const pts = [ov.from, ov.to].filter(Boolean);
        const allFog = pts.length && pts.every(([c, r]) => isFoggedCell(c, r, fog));
        if (allFog) continue;
      }
      drawOverlay(ctx, ov, v, replay);
    }
  }
  function drawTile(ctx, c, r, v, T, depMap, fog) {
    const { x, y } = Iso.cellToScreen(c, r, v);
    const k = T.key(c, r);
    const isPass = T.pass.has(k);
    const isMtn = T.mtn.has(k);
    const dep = depMap.get(k);
    const fogged = isFoggedCell(c, r, fog);
    const remembered = fogged && isRememberedCell(c, r, fog);
    diamond(ctx, x, y, v.tileW, v.tileH);
    let fill = c < v.cols / 2 - 0.5 ? C.tileA : c > v.cols / 2 - 0.5 ? C.tileB : C.passage;
    if (isPass) fill = C.passage;
    if (fogged) fill = remembered ? C.fogMemory : C.fogTile;
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = fogged ? C.edgeSoft : C.edge;
    ctx.lineWidth = 1;
    ctx.stroke();
    if (fogged) return;
    if (dep) {
      const img = Sprites.deposit(dep === "uranium_central" ? "uranium" : dep);
      if (img) {
        drawSpriteCentered(ctx, img, x, y + v.tileH * 0.5, v.scale * 0.62, 0.95);
      } else {
        ctx.beginPath();
        ctx.arc(x, y, v.tileW * 0.12, 0, Math.PI * 2);
        ctx.fillStyle = dep === "credits" ? C.credit : dep === "uranium" ? C.uranium : C.uraniumCentral;
        ctx.fill();
      }
      if (dep === "uranium_central") {
        ctx.strokeStyle = C.uraniumCentral;
        ctx.lineWidth = 2;
        diamond(ctx, x, y, v.tileW * 0.92, v.tileH * 0.92);
        ctx.stroke();
      }
    }
    if (isMtn) {
      const img = Sprites.mountain((c + r) % 2 + 1);
      if (img) drawSpriteCentered(ctx, img, x, y + v.tileH * 0.5, v.scale);
      else {
        const mh = v.tileH * 1.4;
        ctx.fillStyle = "#4a5568";
        ctx.beginPath();
        ctx.moveTo(x - v.tileW / 2, y);
        ctx.lineTo(x, y - mh);
        ctx.lineTo(x + v.tileW / 2, y);
        ctx.lineTo(x, y + v.tileH / 2);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  function drawBuilding(ctx, b, v, memory = false) {
    const [c, r] = b.pos;
    const { x, y } = Iso.cellToScreen(c, r, v);
    const maxhp = MAXHP[b.type] || 10;
    const state = memory ? "normal" : b._state || (b.hp <= 0 ? "destroy" : "normal");
    const variant = b._variant || Sprites.variantFor(b.id);
    const img = Sprites.building(b.type, state, variant, b.owner);
    const bscale = v.scale * BLDG_SCALE;
    const baseY = y + FOOT_HALF * bscale;
    ctx.fillStyle = C.shadow;
    ctx.beginPath();
    ctx.ellipse(x, y, v.tileW * 0.26, v.tileH * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
    const alpha = memory ? 0.42 : b.hp <= 0 ? 0.9 : 1;
    drawSpriteCentered(ctx, img, x, baseY, bscale, alpha);
    if (memory) return;
    const topY = baseY - (img ? img.height * bscale : v.tileH) - 6;
    if (b.hp > 0) {
      const col = b.owner === 0 ? C.p0 : C.p1;
      drawOwnerChip(ctx, x, topY, col);
    }
    if (b.hp > 0 && b.hp < maxhp) {
      drawHpBar(ctx, x, topY - 10, Math.max(34, v.tileW * 0.7), b.hp, maxhp);
    }
  }
  function drawUnit(ctx, u, v) {
    const { x, y } = Iso.cellToScreenF(u.drawCol, u.drawRow, v);
    const col = u.owner === 0 ? C.p0 : C.p1;
    const img = Sprites.unit(u.type, u.facing, u.state);
    const uscale = v.scale * UNIT_SCALE;
    const baseY = y + FOOT_HALF * uscale;
    const spriteH = img ? img.height * uscale : v.tileH;
    if (u._ghost) u._alpha = u.state === "destroy" ? 0.85 : 0.4;
    const showChip = !u._ghost;
    if (u.altitude === "air") {
      const lift = v.tileH * 1.25;
      ctx.fillStyle = C.shadow;
      ctx.beginPath();
      ctx.ellipse(x, y, v.tileW * 0.14, v.tileH * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
      drawSpriteCentered(ctx, img, x, baseY - lift, uscale, u._alpha ?? 1);
      if (showChip) drawOwnerChip(ctx, x, baseY - lift - spriteH - 4, col);
    } else {
      ctx.fillStyle = C.shadow;
      ctx.beginPath();
      ctx.ellipse(x, y, v.tileW * 0.16, v.tileH * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      drawSpriteCentered(ctx, img, x, baseY, uscale, u._alpha ?? 1);
      if (showChip) drawOwnerChip(ctx, x, baseY - spriteH - 2, col);
    }
  }
  function drawOwnerChip(ctx, x, y, col) {
    const rad = 3.6;
    ctx.beginPath();
    ctx.arc(x, y + rad, rad, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.stroke();
  }
  function drawHpBar(ctx, cx, y, w, hp, maxhp) {
    const ratio = Math.max(0, Math.min(1, hp / maxhp));
    const h = 4;
    ctx.fillStyle = C.hpBack;
    ctx.fillRect(cx - w / 2 - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = ratio > 0.6 ? C.hpGood : ratio > 0.3 ? C.hpMid : C.hpBad;
    ctx.fillRect(cx - w / 2, y, w * ratio, h);
  }
  function drawOverlay(ctx, ov, v, replay) {
    if (ov.kind === "move") {
      const a = Iso.cellToScreen(ov.from[0], ov.from[1], v);
      const b = Iso.cellToScreen(ov.to[0], ov.to[1], v);
      const col = ov.owner === 0 ? C.p0 : C.p1;
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const ah = Math.max(9, v.tileW * 0.16);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - ah * Math.cos(ang - 0.42), b.y - ah * Math.sin(ang - 0.42));
      ctx.lineTo(b.x - ah * Math.cos(ang + 0.42), b.y - ah * Math.sin(ang + 0.42));
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }
    if (ov.kind === "attack") {
      const a = Iso.cellToScreen(ov.from[0], ov.from[1], v);
      const b = Iso.cellToScreen(ov.to[0], ov.to[1], v);
      const t = ov.t ?? 1;
      ctx.strokeStyle = `rgba(255,90,60,${0.85 * (1 - Math.abs(0.5 - t) * 0.6)})`;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      const ix = a.x + (b.x - a.x) * Math.min(1, t * 1.2);
      const iy = a.y + (b.y - a.y) * Math.min(1, t * 1.2);
      ctx.fillStyle = `rgba(255,180,80,${0.7 * (1 - t)})`;
      ctx.beginPath();
      ctx.arc(ix, iy, v.tileW * 0.18 * (0.4 + t), 0, Math.PI * 2);
      ctx.fill();
    } else if (ov.kind === "missile") {
      const img = Sprites.nuclearMissile();
      const p = Iso.cellToScreen(ov.at[0], ov.at[1], v);
      const t = ov.t ?? 0;
      const rise = v.tileH * (1 + t * 4.2);
      const cx = p.x, cy = p.y - rise;
      if (img) {
        const scale = v.tileW / 90 * 0.72;
        const w = img.width * scale, h = img.height * scale;
        ctx.globalAlpha = Math.max(0, 1 - t * 0.4);
        ctx.drawImage(img, cx - w / 2, cy - h, w, h);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = "#e8eef5";
        ctx.fillRect(cx - 2, cy - 14, 4, 14);
      }
      ctx.fillStyle = `rgba(255,180,80,${0.5 * (1 - t)})`;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, v.tileW * 0.18, v.tileH * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (ov.kind === "nuke") {
      const img = Sprites.atomicExplosion();
      const p = Iso.cellToScreen(ov.to[0], ov.to[1], v);
      const t = clamp(ov.t ?? 1, 0, 1);
      const fade = Math.min(1, t * 3);
      const grow = 0.86 + 0.14 * Math.min(1, t * 1.6);
      if (img) {
        const targetW = v.tileW * 4.6 * grow;
        const scale = targetW / img.width;
        const w = img.width * scale, h = img.height * scale;
        ctx.globalAlpha = fade;
        ctx.drawImage(img, p.x - w / 2, p.y + v.tileH * 2.05 - h, w, h);
        ctx.globalAlpha = 1;
      }
      const R = v.tileW * (0.6 + (1 - Math.abs(0.5 - t) * 2) * 1.4);
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, Math.max(1, R));
      grad.addColorStop(0, `rgba(255,240,180,${0.5 * fade})`);
      grad.addColorStop(0.45, `rgba(255,140,40,${0.35 * fade})`);
      grad.addColorStop(1, "rgba(255,60,20,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(1, R), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }
  return { resize, draw, MAXHP };
})();
if (typeof module !== "undefined" && module.exports) module.exports = Renderer;
