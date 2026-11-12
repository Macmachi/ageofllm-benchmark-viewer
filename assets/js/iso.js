/*! Age of LLM · Copyright (C) 2026 Rymentz · AGPL-3.0-or-later · https://ageofllm.org */
const Iso = (() => {
  const SPRITE_TILE_W = 90;
  const SPRITE_TILE_H = 80;
  const SPRITE_UNIT_H = 54;
  const DIAMOND_RATIO = 0.5;
  function makeView(cols, rows, cw, ch, pad = 40) {
    const spanTiles = cols + rows;
    const depthAllowance = 1.6;
    const maxTileW_byW = (cw - 2 * pad) / (spanTiles / 2);
    const maxTileW_byH = (ch - 2 * pad) / (spanTiles / 2 * DIAMOND_RATIO + depthAllowance);
    let tileW = Math.min(maxTileW_byW, maxTileW_byH);
    tileW = Math.max(24, Math.min(tileW, 110));
    const tileH = tileW * DIAMOND_RATIO;
    const scale = tileW / SPRITE_TILE_W;
    const midColMinusRow = (cols - 1 - (rows - 1)) / 2;
    const gridPixelHeight = (spanTiles - 2) * (tileH / 2);
    const originX = cw / 2 - midColMinusRow * (tileW / 2);
    const originY = ch / 2 - gridPixelHeight / 2 - tileH / 2 + (SPRITE_TILE_H - SPRITE_TILE_H * DIAMOND_RATIO) * scale * 0.2;
    return { tileW, tileH, originX, originY, scale, cols, rows };
  }
  function cellToScreen(col, row, view) {
    const x = view.originX + (col - row) * (view.tileW / 2);
    const y = view.originY + (col + row) * (view.tileH / 2);
    return { x, y };
  }
  function cellToScreenF(colF, rowF, view) {
    const x = view.originX + (colF - rowF) * (view.tileW / 2);
    const y = view.originY + (colF + rowF) * (view.tileH / 2);
    return { x, y };
  }
  function depthKey(col, row, layer = 0) {
    return (col + row) * 10 + layer;
  }
  function facingFromDelta(dCol, dRow) {
    if (dCol === 0 && dRow === 0) return null;
    if (Math.abs(dCol) >= Math.abs(dRow)) {
      return dCol >= 0 ? "se" : "nw";
    }
    return dRow >= 0 ? "sw" : "ne";
  }
  return {
    SPRITE_TILE_W,
    SPRITE_TILE_H,
    SPRITE_UNIT_H,
    DIAMOND_RATIO,
    makeView,
    cellToScreen,
    cellToScreenF,
    depthKey,
    facingFromDelta
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = Iso;
