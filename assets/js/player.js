/*
 * player.js — Playback state machine.
 *
 * Owns: current turn index, play/pause, speed, and the per-turn animation clock.
 * Knows NOTHING about Canvas — it only produces an interpolated `frame` object
 * that renderer.js consumes. The viewer wires callbacks (onFrame / onTurnChange).
 *
 * Animation model per turn (SEQUENTIAL — one action at a time):
 *   A half-turn lasts `actionMs * nbActions / speed`. The normalized clock
 *   animT 0..1 is sliced into N equal parts, one per non-wait action. Within a
 *   slice, a local clock localT 0..1 runs:
 *   - 0.00 .. 0.55 : MOVE phase  — the acting unit glides from .from to .to.
 *   - 0.55 .. 1.00 : ACTION phase — that action's attack line / launch flash /
 *                    target destroy sprite play out.
 *   The end-of-turn snapshot (turn.units/buildings) is the source of truth for
 *   final positions; intermediate positions are reconstructed from actions[].
 */

const Player = (() => {
  const MOVE_END = 0.55;

  function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
  function smooth(t) { return t * t * (3 - 2 * t); }

  class Playback {
    constructor(replay, opts = {}) {
      this.replay = replay;
      this.turns = replay.turns;
      this.idx = 0;
      this.playing = false;
      this.speed = 1;
      // Per-ACTION duration: a half-turn now plays its actions one after another,
      // so the total time for a turn scales with how many actions it contains.
      this.actionMs = opts.actionMs || opts.turnMs || 900;
      // Nuclear moments are slowed down for drama: the missile rise (launch
      // turn) and the mushroom explosion (resolution turn) each get >= ~2s.
      this.launchActionMs = opts.launchActionMs || 2200;  // per-action on a launch turn
      this.nukeMs = opts.nukeMs || 2600;                  // explosion resolution turn
      this.animT = 1;            // start fully resolved on turn 0
      this._raf = null;
      this._lastTs = 0;
      this._turnStart = 0;
      this.onFrame = opts.onFrame || (() => {});
      this.onTurnChange = opts.onTurnChange || (() => {});
      this.onEnd = opts.onEnd || (() => {});
      this._loop = this._loop.bind(this);
    }

    get current() { return this.turns[this.idx]; }
    get count() { return this.turns.length; }

    /**
     * Visible duration of a turn = (number of non-wait actions) * actionMs, with
     * the nuclear moments slowed down: a turn that RESOLVES the bomb (mushroom
     * cloud over a base) lasts `nukeMs`; a turn that LAUNCHES uses the slower
     * `launchActionMs` per action so the rising missile reads clearly.
     */
    _turnDuration(i = this.idx) {
      const t = this.turns[i];
      if (this._isNukeTurn(t)) return this.nukeMs;
      const acts = (t && t.actions ? t.actions : []).filter((a) => a.type !== 'wait');
      const perAction = this._hasLaunch(t) ? this.launchActionMs : this.actionMs;
      return Math.max(1, acts.length) * perAction;
    }

    /** True if this turn resolves the bomb: a base destroyed by 'nuke'. */
    _isNukeTurn(t) {
      return !!(t && (t.events || []).some(
        (e) => e.type === 'building_destroyed' && e.by === 'nuke'
               && e.unit_type === 'base'));
    }

    /** True if this turn contains a (non-resolving) launch action. */
    _hasLaunch(t) {
      return !!(t && (t.actions || []).some((a) => a.type === 'launch'))
             && !this._isNukeTurn(t);
    }

    // ---- transport ----
    play() {
      if (this.playing) return;
      // Restart from the beginning if: at the end, OR at turn 0 not yet started
      // (animT === 1 means the turn snapshot is shown fully resolved — clicking
      // Play from the initial state should animate from turn 0, not skip it).
      if ((this.idx >= this.count - 1 && this.animT >= 1) ||
          (this.idx === 0 && this.animT >= 1)) {
        this.idx = 0;
        this.animT = 0;
        this.onTurnChange(this.idx, this.current);
      }
      this.playing = true;
      this._turnStart = performance.now();
      this._lastTs = this._turnStart;
      this._raf = requestAnimationFrame(this._loop);
    }
    pause() {
      this.playing = false;
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = null;
    }
    toggle() { this.playing ? this.pause() : this.play(); }

    setSpeed(s) {
      // preserve current progress in real time
      this.speed = s;
      this._turnStart = performance.now() - this.animT * (this._turnDuration() / this.speed);
    }

    next() { this.pause(); this._goto(Math.min(this.count - 1, this.idx + 1), 1); }
    prev() { this.pause(); this._goto(Math.max(0, this.idx - 1), 1); }
    first() { this.pause(); this._goto(0, 1); }
    last() { this.pause(); this._goto(this.count - 1, 1); }

    seek(i) { this.pause(); this._goto(clampInt(i, 0, this.count - 1), 1); }

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

    // ---- frame construction ----
    _emit() { this.onFrame(this.buildFrame()); }

    /**
     * Build the interpolated frame for the current (idx, animT).
     *
     * SEQUENTIAL MODEL: the half-turn's actions are played ONE AFTER ANOTHER,
     * not simultaneously. The animation clock animT (0..1) is split into N equal
     * slices, one per meaningful action (wait/produce-less are skipped). Within
     * each slice a local clock localT (0..1) drives that single action; the
     * MOVE_END split inside a slice separates glide (move) from the action FX
     * (attack line / launch flash / destroy).
     */
    buildFrame() {
      const turn = this.current;
      const animT = this.animT;
      const faceFor = this._idleFacing();

      // Ordered list of actions that take visible time (skip pure waits).
      const acts = (turn.actions || []).filter((a) => a.type !== 'wait');
      const n = Math.max(1, acts.length);
      // Which action slice are we in, and the local progress within it.
      const scaled = clamp01(animT) * n;
      let activeI = Math.min(n - 1, Math.floor(scaled));
      let localT = acts.length ? clamp01(scaled - activeI) : 1;
      if (acts.length === 0) { activeI = -1; localT = 1; }
      // Phase split inside the active slice.
      const inMove = localT < MOVE_END;
      const moveE = smooth(clamp01(localT / MOVE_END));
      const actT = clamp01((localT - MOVE_END) / (1 - MOVE_END));

      // Map each action to its slice index for quick lookup.
      const moveByUnit = {};     // unitId -> {idx, from, to}
      const attackByIdx = {};    // sliceIdx -> attack action
      const produceByUnit = {};  // produced unitId -> sliceIdx
      const buildByBldg = {};    // building id -> sliceIdx
      let launchIdx = -1, launchAction = null;
      acts.forEach((a, i) => {
        if (a.type === 'move' && a.unit) moveByUnit[a.unit] = { idx: i, from: a.from, to: a.to };
        else if (a.type === 'attack' && a.unit) attackByIdx[i] = a;
        else if (a.type === 'produce' && a.unit) produceByUnit[a.unit] = i;
        else if (a.type === 'build' && a.building) buildByBldg[a.building] = i;
        else if (a.type === 'launch') { launchIdx = i; launchAction = a; }
      });

      // events this turn: which entities were destroyed (for ghost rendering)
      const destroyedUnits = new Map();
      const destroyedBldgs = new Map();  // building id -> event (non-base, by a tank)
      const damagedBldgs = new Map();    // building id -> event (hit but survived)
      const nukedBases = [];           // base buildings destroyed by the bomb
      const nukedOwners = new Set();   // players whose base was nuked this turn
      for (const e of turn.events || []) {
        if (e.type === 'unit_destroyed') destroyedUnits.set(e.unit, e);
        else if (e.type === 'building_destroyed' && e.by === 'nuke'
                 && e.unit_type === 'base') {
          nukedBases.push(e);
          if (e.owner === 0 || e.owner === 1) nukedOwners.add(e.owner);
        } else if (e.type === 'building_destroyed' && e.by !== 'nuke') {
          // A non-base building (mine/silo) blown up by a tank is REMOVED from
          // the end-of-turn snapshot, so we must synthesize a ghost to play its
          // destruction in sync with the attack (otherwise the tank seems to
          // fire at an empty cell).
          destroyedBldgs.set(e.unit, e);
        } else if (e.type === 'building_damaged') {
          // A building HIT this turn but NOT destroyed: the end-of-turn snapshot
          // already shows its reduced HP, so naively it would look 'damaged' from
          // the very start of the turn. Record the event (with the attacker) so we
          // can delay the damaged sprite until the attack slice that caused it.
          damagedBldgs.set(e.unit, e);
        }
      }
      // On the resolution frame, once the mushroom is blooming (animT past the
      // initial flash), everything belonging to a nuked player is shown as
      // 'destroy' (wiped out by the blast) — buildings and units alike.
      const nukeWipe = nukedOwners.size > 0 && clamp01(animT) >= 0.18;
      // Tie each destruction to the slice of the attack/launch that caused it,
      // so the victim only disappears once that action plays.
      const destroyIdxByUnit = {};
      for (const [uid, ev] of destroyedUnits) {
        let di = n - 1;
        acts.forEach((a, i) => {
          if (a.type === 'attack' && a.unit === ev.by) di = i;
          else if (a.type === 'launch' && ev.by === 'nuke') di = i;
        });
        destroyIdxByUnit[uid] = di;
      }

      // ---- units ----
      const units = [];
      for (const u of (turn.units || [])) {
        // A unit produced THIS turn must not appear before its produce slice.
        const pIdx = produceByUnit[u.id];
        if (pIdx !== undefined && (activeI < pIdx || (activeI === pIdx && localT < 0.25))) continue;

        const mv = moveByUnit[u.id];
        let drawCol = u.pos[0], drawRow = u.pos[1];
        let facing = faceFor(u);
        if (mv) {
          const [fc, fr] = mv.from, [tc, tr] = mv.to;
          if (activeI < mv.idx) { drawCol = fc; drawRow = fr; }          // before its move
          else if (activeI > mv.idx) { drawCol = tc; drawRow = tr; }      // already moved
          else {                                                         // moving now
            drawCol = fc + (tc - fc) * moveE;
            drawRow = fr + (tr - fr) * moveE;
            facing = Iso.facingFromDelta(tc - fc, tr - fr) || facing;
          }
        }

        // attack facing/state only during this unit's attack slice (FX phase).
        let state = 'idle';
        const atk = attackByIdx[activeI];
        if (nukeWipe && nukedOwners.has(u.owner)) {
          // units of a nuked player are destroyed by the blast
          state = 'destroy';
        } else if (atk && atk.unit === u.id && !inMove) {
          state = 'attack';
          const dc = atk.target_pos[0] - Math.round(drawCol);
          const dr = atk.target_pos[1] - Math.round(drawRow);
          facing = Iso.facingFromDelta(dc, dr) || facing;
        }
        units.push({ ...u, drawCol, drawRow, facing, state });
      }

      // Ghost units: synthesize destroyed units at their last position, playing
      // a destroy sprite during the FX phase of the slice that killed them.
      const liveIds = new Set(units.map((u) => u.id));
      for (const [uid, ev] of destroyedUnits) {
        if (liveIds.has(uid)) continue;
        const di = destroyIdxByUnit[uid];
        // hide once its killing slice has fully passed
        if (activeI > di) continue;
        const pos = this._lastKnownUnitPos(uid);
        if (!pos) continue;
        const dying = activeI === di && !inMove;
        units.push({
          id: uid, owner: ev.owner, type: ev.unit_type,
          pos, drawCol: pos[0], drawRow: pos[1],
          altitude: this._unitAltitude(ev.unit_type),
          facing: faceFor({ owner: ev.owner }),
          state: dying ? 'destroy' : 'idle',
          _ghost: true,
        });
      }

      // ---- buildings ----
      const buildings = [];
      for (const b of (turn.buildings || [])) {
        const variant = Sprites.variantFor(b.id);
        const bIdx = buildByBldg[b.id];
        // A building placed this turn appears only from its build slice.
        if (bIdx !== undefined && activeI < bIdx) continue;
        let bstate;
        // Once a silo fires this turn it shows the 'launch' sprite from the very
        // start of the launch slice (the missile is rising) and KEEPS it for the
        // rest of the turn — it never reverts to its idle sprite.
        const siloFired = launchAction && b.type === 'silo'
          && b.owner === turn.active_player
          && activeI >= launchIdx;
        if (nukeWipe && nukedOwners.has(b.owner)) {
          // base + every building of a nuked player are flattened by the blast
          bstate = 'destroy';
        } else if (siloFired) {
          bstate = 'launch';
        } else if (b.hp <= 0) {
          bstate = 'destroy';
        } else if (b.under_construction || (bIdx !== undefined)) {
          // under construction until the owner's next turn (schema flag), and
          // always shown as 'construct' on the very turn it was placed.
          bstate = 'construct';
        } else if (this._isDamaged(b)) {
          // If this building was DAMAGED by an attack THIS turn, hold its pre-hit
          // (normal) look until the attack slice resolves, so the damage sprite
          // appears in sync with the shot rather than from the turn's first frame.
          const dmgEv = damagedBldgs.get(b.id);
          if (dmgEv) {
            let di = n - 1;
            acts.forEach((a, i) => {
              if (a.type === 'attack' && a.unit === dmgEv.by) di = i;
            });
            bstate = (activeI > di || (activeI === di && !inMove)) ? 'damage' : 'normal';
          } else {
            bstate = 'damage';
          }
        } else {
          bstate = 'normal';
        }
        buildings.push({ ...b, _variant: variant, _state: bstate });
      }

      // Ghost buildings: a mine/silo destroyed by a TANK this turn is gone from
      // the end-of-turn snapshot. Re-inject it so it stands intact until the
      // attack slice that destroys it, then plays its 'destroy' sprite during
      // that slice's FX phase — keeping the tank's shot synced with the wreck
      // (no more "firing at an empty cell").
      const liveBldgIds = new Set(buildings.map((b) => b.id));
      for (const [bid, ev] of destroyedBldgs) {
        if (liveBldgIds.has(bid)) continue;
        const info = this._lastKnownBuilding(bid);
        if (!info) continue;
        // Which slice destroyed it: the attack whose attacker == ev.by.
        let di = n - 1;
        acts.forEach((a, i) => { if (a.type === 'attack' && a.unit === ev.by) di = i; });
        if (activeI > di) continue;                 // already gone after its slice
        const dying = activeI === di && !inMove;     // play 'destroy' during FX
        buildings.push({
          id: bid, owner: ev.owner, type: ev.unit_type,
          pos: info.pos, hp: dying ? 0 : (info.hp || 1),
          _variant: Sprites.variantFor(bid),
          _state: dying ? 'destroy' : (info.under_construction ? 'construct' : 'normal'),
          _ghost: true,
        });
      }

      // ---- overlays ----
      const overlays = [];
      if (activeI >= 0) {
        // Movement arrow: show the from->to path while the unit glides (MOVE phase).
        const curAct = acts[activeI];
        if (inMove && curAct && curAct.type === 'move' && curAct.from && curAct.to) {
          overlays.push({
            kind: 'move', from: curAct.from, to: curAct.to,
            owner: turn.active_player, t: moveE,
          });
        }
        if (activeI === launchIdx && launchAction && nukedBases.length === 0) {
          // Bomb is "in flight" (resolves at end of turn): show the missile
          // rising above the launching silo across the WHOLE slice (localT) so
          // the climb is slow and readable. The mushroom cloud + flash appear
          // later, on the resolution frame (kind 'nuke').
          const silo = (turn.buildings || []).find(
            (b) => b.type === 'silo' && b.owner === turn.active_player);
          if (silo) overlays.push({ kind: 'missile', at: silo.pos, t: localT });
        }
        if (!inMove) {
          const atk = attackByIdx[activeI];
          if (atk) {
            const u = units.find((x) => x.id === atk.unit);
            const from = u ? [Math.round(u.drawCol), Math.round(u.drawRow)]
                           : atk.from || atk.target_pos;
            overlays.push({ kind: 'attack', from, to: atk.target_pos, t: actT });
          }
        }
      }

      // Nuclear mushroom cloud over each base destroyed by the bomb. This is the
      // resolution half-turn (a synthetic 'launch' action with player set), so
      // show it through the whole frame. Atomic blast only for nuke deaths.
      for (const nb of nukedBases) {
        const b = (turn.buildings || []).find((x) => x.id === nb.unit);
        const pos = b ? b.pos : null;
        if (pos) overlays.push({ kind: 'nuke', to: pos, t: clamp01(animT) });
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
        overlays,
      };
    }

    /**
     * Returns a function owner -> idle facing, derived from each player's real
     * base column relative to the board center. A unit looks toward the half of
     * the board where the OPPONENT's base sits. Falls back to SE/NW if bases are
     * missing. Memoized per replay.
     */
    _idleFacing() {
      if (!this._faceForFn) {
        const players = this.replay.meta.players || [];
        const W = this.replay.meta.grid_width;
        const mid = (W - 1) / 2;
        const map = {};
        for (const p of players) {
          const baseCol = p.base ? p.base[0] : (p.slot === 0 ? 0 : W - 1);
          // enemy is on the opposite side of this player's base:
          // base left of center => face right (se); base right => face left (nw)
          map[p.slot] = baseCol < mid ? 'se' : 'nw';
        }
        this._faceForFn = (u) => map[u.owner] ?? (u.owner === 0 ? 'se' : 'nw');
      }
      return this._faceForFn;
    }

    /** Max HP per building type (mirrors engine BUILDING_STATS). */
    _maxHp(type) {
      return { base: 4, silo: 3, credit_mine: 2, uranium_mine: 2,
               uranium_mine_central: 3 }[type] || 4;
    }

    _isDamaged(b) {
      if (b.hp <= 0) return false;
      return b.hp <= this._maxHp(b.type) * 0.5;
    }

    _unitAltitude(type) {
      return (type === 'drone' || type === 'fighter') ? 'air' : 'ground';
    }

    /** Last full snapshot of a building id, scanning prior turns backward. */
    _lastKnownBuilding(bid) {
      for (let i = this.idx; i >= 0; i--) {
        const t = this.turns[i];
        const b = (t.buildings || []).find((x) => x.id === bid);
        if (b) return { pos: [b.pos[0], b.pos[1]], hp: b.hp,
                        under_construction: !!b.under_construction };
      }
      return null;
    }

    /** Last position a unit id was seen at, scanning prior turns backward. */
    _lastKnownUnitPos(uid) {
      for (let i = this.idx; i >= 0; i--) {
        const t = this.turns[i];
        const u = (t.units || []).find((x) => x.id === uid);
        if (u) return [u.pos[0], u.pos[1]];
        // also check this turn's move actions (unit may have moved then died)
        for (const a of t.actions || []) {
          if (a.unit === uid && a.to) return [a.to[0], a.to[1]];
          if (a.unit === uid && a.from) return [a.from[0], a.from[1]];
        }
      }
      return null;
    }
  }

  function clampInt(v, lo, hi) { v = Math.round(v); return v < lo ? lo : v > hi ? hi : v; }

  return { Playback, MOVE_END };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Player;
