/*
 * iso.js — Isometric projection helpers.
 *
 * Pure math + z-order utilities. Knows NOTHING about the DOM, the replay
 * data, or rendering. Everything is driven by a small `view` object that the
 * renderer builds once per frame:
 *
 *   view = {
 *     tileW,        // diamond footprint width in px (on screen)
 *     tileH,        // diamond footprint height in px (== tileW / 2)
 *     originX,      // screen x of grid cell (0,0) diamond top
 *     originY,      // screen y of grid cell (0,0) diamond top
 *     scale,        // sprite scale factor (tileW / SPRITE_TILE_W)
 *   }
 *
 * Grid coordinates follow the replay convention: [col, row], origin top-left,
 * col grows to the screen-right-down, row grows to the screen-left-down.
 */

const Iso = (() => {
  // Native sprite footprint (the diamond the artist drew the tile on).
  const SPRITE_TILE_W = 90;   // px
  const SPRITE_TILE_H = 80;   // px (full image height, includes cube depth)
  const SPRITE_UNIT_H = 54;   // px

  // The "flat" diamond on top of a tile sprite. For a 90px-wide iso diamond the
  // visible top face is 90x45 (2:1). The remaining 35px of the 80px image is the
  // tile's vertical thickness drawn below the diamond.
  const DIAMOND_RATIO = 0.5;  // tileH = tileW * 0.5

  /**
   * Compute a `view` that fits a `cols x rows` grid inside `cw x ch` pixels,
   * leaving `pad` margin. Returns the view object consumed by every helper here.
   */
  function makeView(cols, rows, cw, ch, pad = 40) {
    // Bounding box of an isometric grid (in tile-width units):
    //   width  = (cols + rows) * tileW / 2
    //   height = (cols + rows) * tileH / 2   (+ extra for tile/sprite depth)
    // Solve tileW so the grid fits both dimensions.
    const spanTiles = cols + rows;
    // Reserve vertical room for sprite depth (buildings rise above the diamond).
    const depthAllowance = 1.6; // multiplier on tileH worth of extra height
    const maxTileW_byW = (cw - 2 * pad) / (spanTiles / 2);
    const maxTileW_byH =
      (ch - 2 * pad) / ((spanTiles / 2) * DIAMOND_RATIO + depthAllowance);
    let tileW = Math.min(maxTileW_byW, maxTileW_byH);
    tileW = Math.max(24, Math.min(tileW, 110)); // clamp for sanity
    const tileH = tileW * DIAMOND_RATIO;
    const scale = tileW / SPRITE_TILE_W;

    // Center the grid. Screen x of cell center = originX + (col - row) * tileW/2.
    // col-row ranges in [-(rows-1), (cols-1)], so its mid is (cols-1-(rows-1))/2.
    const midColMinusRow = (cols - 1 - (rows - 1)) / 2;
    const gridPixelHeight = (spanTiles - 2) * (tileH / 2);
    const originX = cw / 2 - midColMinusRow * (tileW / 2);
    const originY =
      ch / 2 - gridPixelHeight / 2 - tileH / 2 + (SPRITE_TILE_H - SPRITE_TILE_H * DIAMOND_RATIO) * scale * 0.2;

    return { tileW, tileH, originX, originY, scale, cols, rows };
  }

  /** Screen coordinates of the CENTER of a tile's top diamond face. */
  function cellToScreen(col, row, view) {
    const x = view.originX + (col - row) * (view.tileW / 2);
    const y = view.originY + (col + row) * (view.tileH / 2);
    return { x, y };
  }

  /** Fractional version (for smooth move interpolation between cells). */
  function cellToScreenF(colF, rowF, view) {
    const x = view.originX + (colF - rowF) * (view.tileW / 2);
    const y = view.originY + (colF + rowF) * (view.tileH / 2);
    return { x, y };
  }

  /** Inverse: screen px -> nearest grid cell (for hover/click, optional). */
  function screenToCell(px, py, view) {
    const dx = (px - view.originX) / (view.tileW / 2);
    const dy = (py - view.originY) / (view.tileH / 2);
    const col = Math.round((dx + dy) / 2);
    const row = Math.round((dy - dx) / 2);
    return { col, row };
  }

  /**
   * Painter's-order key. Smaller = drawn first (further back).
   * Tiles further "up-left" (low col+row) are behind. Air units share a cell's
   * depth with ground units but should paint after (on top of) them.
   */
  function depthKey(col, row, layer = 0) {
    // layer: 0 = terrain/building, 1 = ground unit, 2 = air unit, 3 = overlay
    return (col + row) * 10 + layer;
  }

  /**
   * Pick a sprite facing (ne/nw/se/sw) from a movement / attack vector.
   *
   * The 4 facings are aligned with the GRID axes (not screen diagonals):
   *   se = +col (east)   ·  nw = -col (west)
   *   sw = +row (south)  ·  ne = -row (north)
   * (Confirmed by the idle facing: a base on the left looks 'se' toward the
   * enemy on the +col side.) We therefore pick based on the dominant GRID axis
   * directly — using screen-space deltas here mismaps row-axis moves.
   */
  function facingFromDelta(dCol, dRow) {
    if (dCol === 0 && dRow === 0) return null;
    if (Math.abs(dCol) >= Math.abs(dRow)) {
      return dCol >= 0 ? 'se' : 'nw';
    }
    return dRow >= 0 ? 'sw' : 'ne';
  }

  return {
    SPRITE_TILE_W, SPRITE_TILE_H, SPRITE_UNIT_H, DIAMOND_RATIO,
    makeView, cellToScreen, cellToScreenF, screenToCell,
    depthKey, facingFromDelta,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Iso;
