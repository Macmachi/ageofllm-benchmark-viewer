/*! Age of LLM · Copyright (C) 2026 Rymentz · AGPL-3.0-or-later · https://ageofllm.org */
const Sprites = (() => {
  const BASE = "assets/sprites/";
  const EXT = ".webp";
  const cache = new Map();
  let _ready = null;
  const UNIT_STEM = {
    drone: "drone",
    fighter: "plane",
    sam: "sam",
    tank: "tank"
  };
  const BLDG_STEM = {
    base: "base",
    credit_mine: "credit",
    uranium_mine: "uranium",
    uranium_mine_central: "uranium",
    silo: "silo"
  };
  const HAS_CONSTRUCT = new Set(["credit", "uranium", "silo"]);
  const HAS_DESTROY = new Set(["silo"]);
  function manifest() {
    const files = new Set();
    const dirs = ["ne", "nw", "se", "sw"];
    for (const s of ["drone", "plane", "sam", "tank"]) {
      for (const d of dirs) {
        files.add(`unit_${s}_${d}`);
        files.add(`unit_${s}_destroy_${d}`);
        if (s !== "drone") files.add(`unit_${s}_attack_${d}`);
      }
    }
    for (const b of ["credit", "uranium", "silo"]) {
      for (const v of [1, 2]) {
        files.add(`building_${b}_var${v}`);
        files.add(`building_${b}_damage_var${v}`);
        if (HAS_CONSTRUCT.has(b)) files.add(`building_${b}_construct_var${v}`);
        if (HAS_DESTROY.has(b)) files.add(`building_${b}_destroy_var${v}`);
      }
    }
    for (const p of [1, 2]) {
      files.add(`building_base_player${p}`);
      files.add(`building_base_damage_player${p}`);
    }
    for (const v of [1, 2]) {
      files.add(`building_destroy_var${v}`);
      files.add(`decor_mountain_var${v}`);
    }
    files.add("building_silo_launch_var1");
    files.add("building_silo_launch_var2");
    files.add("resource_credit");
    files.add("resource_uranium");
    files.add("decor_atomic_explosion");
    files.add("decor_nuclear-missile_launch");
    return [...files];
  }
  function load(name) {
    if (cache.has(name)) return Promise.resolve(cache.get(name));
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        cache.set(name, img);
        resolve(img);
      };
      img.onerror = () => {
        cache.set(name, null);
        resolve(null);
      };
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
  function variantFor(key) {
    const s = String(key);
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = h * 31 + s.charCodeAt(i) | 0;
    }
    return Math.abs(h) % 2 + 1;
  }
  function unit(type, facing, state = "idle") {
    const stem = UNIT_STEM[type] || "tank";
    const f = facing || "se";
    let name;
    if (state === "attack" && stem !== "drone") name = `unit_${stem}_attack_${f}`;
    else if (state === "destroy") name = `unit_${stem}_destroy_${f}`;
    else name = `unit_${stem}_${f}`;
    return get(name) || get(`unit_${stem}_${f}`);
  }
  function building(type, state, variant, owner = 0) {
    const stem = BLDG_STEM[type] || "base";
    const v = variant === 2 ? 2 : 1;
    if (stem === "base") {
      const p = owner === 1 ? 2 : 1;
      if (state === "destroy") {
        return get(`building_destroy_var${v}`) || get(`building_base_player${p}`);
      }
      if (state === "damage") {
        return get(`building_base_damage_player${p}`) || get(`building_base_player${p}`);
      }
      return get(`building_base_player${p}`);
    }
    if (state === "launch" && stem === "silo") {
      return get(`building_silo_launch_var${v}`) || get(`building_silo_var${v}`);
    }
    if (state === "destroy") {
      if (HAS_DESTROY.has(stem)) {
        return get(`building_${stem}_destroy_var${v}`) || get(`building_destroy_var${v}`);
      }
      return get(`building_destroy_var${v}`) || get(`building_${stem}_var${v}`);
    }
    if (state === "construct" && HAS_CONSTRUCT.has(stem)) {
      return get(`building_${stem}_construct_var${v}`) || get(`building_${stem}_var${v}`);
    }
    if (state === "damage") {
      return get(`building_${stem}_damage_var${v}`) || get(`building_${stem}_var${v}`);
    }
    return get(`building_${stem}_var${v}`);
  }
  function mountain(variant = 1) {
    return get(`decor_mountain_var${variant}`);
  }
  function deposit(kind) {
    if (kind === "credits") return get("resource_credit");
    return get("resource_uranium");
  }
  function atomicExplosion() {
    return get("decor_atomic_explosion");
  }
  function nuclearMissile() {
    return get("decor_nuclear-missile_launch");
  }
  return {
    preload,
    get,
    unit,
    building,
    mountain,
    deposit,
    variantFor,
    atomicExplosion,
    nuclearMissile,
    UNIT_STEM,
    BLDG_STEM
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = Sprites;
