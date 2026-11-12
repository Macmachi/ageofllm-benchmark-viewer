/*! Age of LLM · Copyright (C) 2026 Rymentz · AGPL-3.0-or-later · https://ageofllm.org */
const Player = (() => {
  const MOVE_END = 0.55;
  function clamp01(t) {
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }
  function smooth(t) {
    return t * t * (3 - 2 * t);
  }
  class Playback {
    constructor(replay, opts = {}) {
      this.replay = replay;
      this.turns = replay.turns;
      this.idx = 0;
      this.playing = false;
      this.speed = 1;
      this.actionMs = opts.actionMs || opts.turnMs || 900;
      this.launchActionMs = opts.launchActionMs || 2200;
      this.nukeMs = opts.nukeMs || 2600;
      this.animT = 1;
      this._raf = null;
      this._lastTs = 0;
      this._turnStart = 0;
      this.onFrame = opts.onFrame || (() => {
      });
      this.onTurnChange = opts.onTurnChange || (() => {
      });
      this.onEnd = opts.onEnd || (() => {
      });
      this._loop = this._loop.bind(this);
    }
    get current() {
      return this.turns[this.idx];
    }
    get count() {
      return this.turns.length;
    }
    _turnDuration(i = this.idx) {
      const t = this.turns[i];
      if (this._isNukeTurn(t)) return this.nukeMs;
      const acts = (t && t.actions ? t.actions : []).filter((a) => a.type !== "wait");
      const perAction = this._hasLaunch(t) ? this.launchActionMs : this.actionMs;
      return Math.max(1, acts.length) * perAction;
    }
    _isNukeTurn(t) {
      return !!(t && (t.events || []).some(
        (e) => e.type === "building_destroyed" && e.by === "nuke" && e.unit_type === "base"
      ));
    }
    _hasLaunch(t) {
      return !!(t && (t.actions || []).some((a) => a.type === "launch")) && !this._isNukeTurn(t);
    }
    play() {
      if (this.playing) return;
      if (this.idx >= this.count - 1 && this.animT >= 1 || this.idx === 0 && this.animT >= 1) {
        this.idx = 0;
        this.animT = 0;
        this.onTurnChange(this.idx, this.current);
      }
      this.playing = true;
      const part = this.animT > 0 && this.animT < 1 ? this.animT : 0;
      this._turnStart = performance.now() - part * (this._turnDuration() / this.speed);
      this._lastTs = performance.now();
      this._raf = requestAnimationFrame(this._loop);
    }
    pause() {
      this.playing = false;
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = null;
    }
    toggle() {
      this.playing ? this.pause() : this.play();
    }
    setSpeed(s) {
      this.speed = s;
      this._turnStart = performance.now() - this.animT * (this._turnDuration() / this.speed);
    }
    next() {
      this.pause();
      this._goto(Math.min(this.count - 1, this.idx + 1), 1);
    }
    prev() {
      this.pause();
      this._goto(Math.max(0, this.idx - 1), 1);
    }
    first() {
      this.pause();
      this._goto(0, 1);
    }
    last() {
      this.pause();
      this._goto(this.count - 1, 1);
    }
    seek(i) {
      this.pause();
      this._goto(clampInt(i, 0, this.count - 1), 1);
    }
    start() {
      this.pause();
      this.idx = 0;
      this.animT = 0;
      this.onTurnChange(this.idx, this.current);
      this._emit();
    }
    _goto(i, animT) {
      const changed = i !== this.idx;
      this.idx = i;
      this.animT = animT;
      if (changed) this.onTurnChange(this.idx, this.current);
      this._emit();
    }
    _loop(ts) {
      if (!this.playing) return;
      const dur = this._turnDuration() / this.speed;
      this.animT = clamp01((ts - this._turnStart) / dur);
      this._emit();
      if (this.animT >= 1) {
        if (this.idx >= this.count - 1) {
          this.playing = false;
          this.onEnd();
          return;
        }
        this.idx += 1;
        this.animT = 0;
        this._turnStart = ts;
        this.onTurnChange(this.idx, this.current);
      }
      this._raf = requestAnimationFrame(this._loop);
    }
    _emit() {
      this.onFrame(this.buildFrame());
    }
    buildFrame() {
      const turn = this.current;
      const animT = this.animT;
      const faceFor = this._idleFacing();
      const acts = (turn.actions || []).filter((a) => a.type !== "wait");
      const n = Math.max(1, acts.length);
      const scaled = clamp01(animT) * n;
      let activeI = Math.min(n - 1, Math.floor(scaled));
      let localT = acts.length ? clamp01(scaled - activeI) : 1;
      if (acts.length === 0) {
        activeI = -1;
        localT = 1;
      }
      const inMove = localT < MOVE_END;
      const moveE = smooth(clamp01(localT / MOVE_END));
      const actT = clamp01((localT - MOVE_END) / (1 - MOVE_END));
      const moveByUnit = {};
      const attackByIdx = {};
      const produceByUnit = {};
      const buildByBldg = {};
      let launchIdx = -1, launchAction = null;
      acts.forEach((a, i) => {
        if (a.type === "move" && a.unit) moveByUnit[a.unit] = { idx: i, from: a.from, to: a.to };
        else if (a.type === "attack" && a.unit) attackByIdx[i] = a;
        else if (a.type === "produce" && a.unit) produceByUnit[a.unit] = i;
        else if (a.type === "build" && a.building) buildByBldg[a.building] = i;
        else if (a.type === "launch") {
          launchIdx = i;
          launchAction = a;
        }
      });
      const destroyedUnits = new Map();
      const destroyedBldgs = new Map();
      const damagedBldgs = new Map();
      const nukedBases = [];
      const nukedOwners = new Set();
      for (const e of turn.events || []) {
        if (e.type === "unit_destroyed") destroyedUnits.set(e.unit, e);
        else if (e.type === "building_destroyed" && e.by === "nuke" && e.unit_type === "base") {
          nukedBases.push(e);
          if (e.owner === 0 || e.owner === 1) nukedOwners.add(e.owner);
        } else if (e.type === "building_destroyed" && e.by !== "nuke") {
          destroyedBldgs.set(e.unit, e);
        } else if (e.type === "building_damaged") {
          damagedBldgs.set(e.unit, e);
        }
      }
      const nukeWipe = nukedOwners.size > 0 && clamp01(animT) >= 0.18;
      const destroyIdxByUnit = {};
      for (const [uid, ev] of destroyedUnits) {
        let di = n - 1;
        acts.forEach((a, i) => {
          if (a.type === "attack" && a.unit === ev.by) di = i;
          else if (a.type === "launch" && ev.by === "nuke") di = i;
        });
        destroyIdxByUnit[uid] = di;
      }
      const units = [];
      for (const u of turn.units || []) {
        const pIdx = produceByUnit[u.id];
        if (pIdx !== void 0 && (activeI < pIdx || activeI === pIdx && localT < 0.25)) continue;
        const mv = moveByUnit[u.id];
        let drawCol = u.pos[0], drawRow = u.pos[1];
        let facing = faceFor(u);
        if (mv) {
          const [fc, fr] = mv.from, [tc, tr] = mv.to;
          if (activeI < mv.idx) {
            drawCol = fc;
            drawRow = fr;
          } else if (activeI > mv.idx) {
            drawCol = tc;
            drawRow = tr;
          } else {
            drawCol = fc + (tc - fc) * moveE;
            drawRow = fr + (tr - fr) * moveE;
            facing = Iso.facingFromDelta(tc - fc, tr - fr) || facing;
          }
        }
        let state = "idle";
        const atk = attackByIdx[activeI];
        if (nukeWipe && nukedOwners.has(u.owner)) {
          state = "destroy";
        } else if (atk && atk.unit === u.id && !inMove) {
          state = "attack";
          const dc = atk.target_pos[0] - Math.round(drawCol);
          const dr = atk.target_pos[1] - Math.round(drawRow);
          facing = Iso.facingFromDelta(dc, dr) || facing;
        }
        units.push({ ...u, drawCol, drawRow, facing, state });
      }
      const liveIds = new Set(units.map((u) => u.id));
      for (const [uid, ev] of destroyedUnits) {
        if (liveIds.has(uid)) continue;
        const di = destroyIdxByUnit[uid];
        if (activeI > di) continue;
        const pos = this._lastKnownUnitPos(uid);
        if (!pos) continue;
        const dying = activeI === di && !inMove;
        units.push({
          id: uid,
          owner: ev.owner,
          type: ev.unit_type,
          pos,
          drawCol: pos[0],
          drawRow: pos[1],
          altitude: this._unitAltitude(ev.unit_type),
          facing: faceFor({ owner: ev.owner }),
          state: dying ? "destroy" : "idle",
          _ghost: true
        });
      }
      const buildings = [];
      for (const b of turn.buildings || []) {
        const variant = Sprites.variantFor(b.id);
        const bIdx = buildByBldg[b.id];
        if (bIdx !== void 0 && activeI < bIdx) continue;
        let bstate;
        const siloFired = launchAction && b.type === "silo" && b.owner === turn.active_player && activeI >= launchIdx;
        if (nukeWipe && nukedOwners.has(b.owner)) {
          bstate = "destroy";
        } else if (siloFired) {
          bstate = "launch";
        } else if (b.hp <= 0) {
          bstate = "destroy";
        } else if (b.under_construction || bIdx !== void 0) {
          bstate = "construct";
        } else if (this._isDamaged(b)) {
          const dmgEv = damagedBldgs.get(b.id);
          if (dmgEv) {
            let di = n - 1;
            acts.forEach((a, i) => {
              if (a.type === "attack" && a.unit === dmgEv.by) di = i;
            });
            bstate = activeI > di || activeI === di && !inMove ? "damage" : "normal";
          } else {
            bstate = "damage";
          }
        } else {
          bstate = "normal";
        }
        buildings.push({ ...b, _variant: variant, _state: bstate });
      }
      const liveBldgIds = new Set(buildings.map((b) => b.id));
      for (const [bid, ev] of destroyedBldgs) {
        if (liveBldgIds.has(bid)) continue;
        const info = this._lastKnownBuilding(bid);
        if (!info) continue;
        let di = n - 1;
        acts.forEach((a, i) => {
          if (a.type === "attack" && a.unit === ev.by) di = i;
        });
        if (activeI > di) continue;
        const dying = activeI === di && !inMove;
        buildings.push({
          id: bid,
          owner: ev.owner,
          type: ev.unit_type,
          pos: info.pos,
          hp: dying ? 0 : info.hp || 1,
          _variant: Sprites.variantFor(bid),
          _state: dying ? "destroy" : info.under_construction ? "construct" : "normal",
          _ghost: true
        });
      }
      const overlays = [];
      if (activeI >= 0) {
        const curAct = acts[activeI];
        if (inMove && curAct && curAct.type === "move" && curAct.from && curAct.to) {
          overlays.push({
            kind: "move",
            from: curAct.from,
            to: curAct.to,
            owner: turn.active_player,
            t: moveE
          });
        }
        if (activeI === launchIdx && launchAction && nukedBases.length === 0) {
          const silo = (turn.buildings || []).find(
            (b) => b.type === "silo" && b.owner === turn.active_player
          );
          if (silo) overlays.push({ kind: "missile", at: silo.pos, t: localT });
        }
        if (!inMove) {
          const atk = attackByIdx[activeI];
          if (atk) {
            const u = units.find((x) => x.id === atk.unit);
            const from = u ? [Math.round(u.drawCol), Math.round(u.drawRow)] : atk.from || atk.target_pos;
            overlays.push({ kind: "attack", from, to: atk.target_pos, t: actT });
          }
        }
      }
      for (const nb of nukedBases) {
        const b = (turn.buildings || []).find((x) => x.id === nb.unit);
        const pos = b ? b.pos : null;
        if (pos) overlays.push({ kind: "nuke", to: pos, t: clamp01(animT) });
      }
      return {
        turnIndex: this.idx,
        turn: turn.turn,
        activePlayer: turn.active_player,
        animT,
        actionIndex: activeI,
        actionCount: n,
        units,
        buildings,
        overlays
      };
    }
    _idleFacing() {
      if (!this._faceForFn) {
        const players = this.replay.meta.players || [];
        const W = this.replay.meta.grid_width;
        const mid = (W - 1) / 2;
        const map = {};
        for (const p of players) {
          const baseCol = p.base ? p.base[0] : p.slot === 0 ? 0 : W - 1;
          map[p.slot] = baseCol < mid ? "se" : "nw";
        }
        this._faceForFn = (u) => map[u.owner] ?? (u.owner === 0 ? "se" : "nw");
      }
      return this._faceForFn;
    }
    _maxHp(type) {
      return {
        base: 4,
        silo: 3,
        credit_mine: 2,
        uranium_mine: 2,
        uranium_mine_central: 3
      }[type] || 4;
    }
    _isDamaged(b) {
      if (b.hp <= 0) return false;
      return b.hp <= this._maxHp(b.type) * 0.5;
    }
    _unitAltitude(type) {
      return type === "drone" || type === "fighter" ? "air" : "ground";
    }
    _lastKnownBuilding(bid) {
      for (let i = this.idx; i >= 0; i--) {
        const t = this.turns[i];
        const b = (t.buildings || []).find((x) => x.id === bid);
        if (b) return {
          pos: [b.pos[0], b.pos[1]],
          hp: b.hp,
          under_construction: !!b.under_construction
        };
      }
      return null;
    }
    _lastKnownUnitPos(uid) {
      for (let i = this.idx; i >= 0; i--) {
        const t = this.turns[i];
        const u = (t.units || []).find((x) => x.id === uid);
        if (u) return [u.pos[0], u.pos[1]];
        for (const a of t.actions || []) {
          if (a.unit === uid && a.to) return [a.to[0], a.to[1]];
          if (a.unit === uid && a.from) return [a.from[0], a.from[1]];
        }
      }
      return null;
    }
  }
  function clampInt(v, lo, hi) {
    v = Math.round(v);
    return v < lo ? lo : v > hi ? hi : v;
  }
  return { Playback, MOVE_END };
})();
if (typeof module !== "undefined" && module.exports) module.exports = Player;
