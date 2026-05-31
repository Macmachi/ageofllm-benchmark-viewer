/*
 * sprites.js — Loads every WebP once and resolves replay entities to images.
 *
 * Sprite footprint conventions (from the supplied asset pack, now WebP):
 *   - terrain / buildings : 90 x 80  (diamond 90x45 + vertical depth)
 *   - units               : 90 x 54  (some attack frames up to 90x57)
 *   - 4 isometric facings  : ne / nw / se / sw
 *   Every sprite is anchored on the 90x45 ground diamond at the image bottom,
 *   so the renderer can center its footprint on a tile at any scale.
 *
 * BUILDING states (per type):
 *   credit : construct / normal / damage / (destroy -> generic)
 *   uranium: construct / normal / damage / (destroy -> generic)
 *   base   : normal / damage / (destroy -> generic)   [no construct sprite]
 *            The base sprite is PER PLAYER (not a random variant):
 *            building_base_player1 / building_base_player2 and their _damage_.
 *   silo   : construct / normal / damage / destroy(dedicated) / launch(special)
 *   generic destroy : building_destroy_varN  (base/credit/uranium wreck)
 *
 * VARIANT rule: each non-base building/resource keeps ONE variant (1 or 2) for
 * the whole game, derived from a stable hash of its id (buildings) or position
 * (deposits). Resolved here via variantFor(key). The BASE ignores the variant
 * and is chosen by owner instead.
 *
 * UNIT states:
 *   idle (4 dirs) / attack (4 dirs, NOT drone) / destroy (4 dirs)
 *   sprite stems: drone, plane(=fighter), sam, tank
 */

const Sprites = (() => {
  const BASE = 'assets/sprites/';
  const EXT = '.webp';
  const cache = new Map();   // filename(no ext) -> HTMLImageElement | null
  let _ready = null;

  const UNIT_STEM = {
    drone: 'drone',
    fighter: 'plane',
    sam: 'sam',
    tank: 'tank',
  };

  const BLDG_STEM = {
    base: 'base',
    credit_mine: 'credit',
    uranium_mine: 'uranium',
    uranium_mine_central: 'uranium',
    silo: 'silo',
  };

  // Which building stems actually ship a "construct" sprite.
  const HAS_CONSTRUCT = new Set(['credit', 'uranium', 'silo']);
  // Which building stems ship a dedicated "destroy" sprite (else generic).
  const HAS_DESTROY = new Set(['silo']);

  // ---- manifest (names WITHOUT extension) ----
  function manifest() {
    const files = new Set();
    const dirs = ['ne', 'nw', 'se', 'sw'];
    for (const s of ['drone', 'plane', 'sam', 'tank']) {
      for (const d of dirs) {
        files.add(`unit_${s}_${d}`);
        files.add(`unit_${s}_destroy_${d}`);
        if (s !== 'drone') files.add(`unit_${s}_attack_${d}`);
      }
    }
    for (const b of ['credit', 'uranium', 'silo']) {
      for (const v of [1, 2]) {
        files.add(`building_${b}_var${v}`);
        files.add(`building_${b}_damage_var${v}`);
        if (HAS_CONSTRUCT.has(b)) files.add(`building_${b}_construct_var${v}`);
        if (HAS_DESTROY.has(b)) files.add(`building_${b}_destroy_var${v}`);
      }
    }
    // Base is per-player (not a random variant): normal + damage for each side.
    for (const p of [1, 2]) {
      files.add(`building_base_player${p}`);
      files.add(`building_base_damage_player${p}`);
    }
    for (const v of [1, 2]) {
      files.add(`building_destroy_var${v}`);
      files.add(`decor_mountain_var${v}`);
    }
    files.add('building_silo_launch_var1');
    files.add('building_silo_launch_var2');
    files.add('resource_credit');
    files.add('resource_uranium');
    // Nuclear effects: mushroom cloud + launching missile.
    files.add('decor_atomic_explosion');
    files.add('decor_nuclear-missile_launch');
    return [...files];
  }

  function load(name) {
    if (cache.has(name)) return Promise.resolve(cache.get(name));
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { cache.set(name, img); resolve(img); };
      img.onerror = () => { cache.set(name, null); resolve(null); };
      img.src = BASE + name + EXT;
    });
  }

  function preload() {
    if (_ready) return _ready;
    _ready = Promise.all(manifest().map(load)).then(() => true);
    return _ready;
  }

  function get(name) {
    return cache.get(name) || null;
  }

  // ---- stable variant (1 or 2) from a key string ----
  function variantFor(key) {
    const s = String(key);
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) | 0;
    }
    return (Math.abs(h) % 2) + 1;
  }

  // ---- units ----
  function unit(type, facing, state = 'idle') {
    const stem = UNIT_STEM[type] || 'tank';
    const f = facing || 'se';
    let name;
    if (state === 'attack' && stem !== 'drone') name = `unit_${stem}_attack_${f}`;
    else if (state === 'destroy') name = `unit_${stem}_destroy_${f}`;
    else name = `unit_${stem}_${f}`;
    return get(name) || get(`unit_${stem}_${f}`);
  }

  // ---- buildings ----
  // state: 'construct' | 'normal' | 'damage' | 'destroy' | 'launch'
  // owner: 0 | 1 — only used by the base, which has a dedicated per-player sprite.
  function building(type, state, variant, owner = 0) {
    const stem = BLDG_STEM[type] || 'base';
    const v = variant === 2 ? 2 : 1;

    // Base: per-player sprite (player1 / player2), no random variant.
    if (stem === 'base') {
      const p = owner === 1 ? 2 : 1;
      if (state === 'destroy') {
        return get(`building_destroy_var${v}`) || get(`building_base_player${p}`);
      }
      if (state === 'damage') {
        return get(`building_base_damage_player${p}`) || get(`building_base_player${p}`);
      }
      return get(`building_base_player${p}`);
    }

    if (state === 'launch' && stem === 'silo') {
      return get(`building_silo_launch_var${v}`) || get(`building_silo_var${v}`);
    }
    if (state === 'destroy') {
      if (HAS_DESTROY.has(stem)) {
        return get(`building_${stem}_destroy_var${v}`)
            || get(`building_destroy_var${v}`);
      }
      return get(`building_destroy_var${v}`) || get(`building_${stem}_var${v}`);
    }
    if (state === 'construct' && HAS_CONSTRUCT.has(stem)) {
      return get(`building_${stem}_construct_var${v}`) || get(`building_${stem}_var${v}`);
    }
    if (state === 'damage') {
      return get(`building_${stem}_damage_var${v}`) || get(`building_${stem}_var${v}`);
    }
    return get(`building_${stem}_var${v}`);
  }

  function mountain(variant = 1) { return get(`decor_mountain_var${variant}`); }

  function deposit(kind) {
    if (kind === 'credits') return get('resource_credit');
    return get('resource_uranium');
  }

  // ---- nuclear effects ----
  function atomicExplosion() { return get('decor_atomic_explosion'); }
  function nuclearMissile() { return get('decor_nuclear-missile_launch'); }

  return {
    preload, get, unit, building, mountain, deposit, variantFor,
    atomicExplosion, nuclearMissile,
    UNIT_STEM, BLDG_STEM,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Sprites;
