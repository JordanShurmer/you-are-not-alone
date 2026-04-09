// render.js — Phase 3: camera tracking + tile rendering + entity sprites.
//
// New in Phase 3:
//   - worldLayer is offset each frame to implement a camera that follows
//     the local player.
//   - Visible tiles are drawn with a single PIXI.Graphics cleared and
//     rebuilt each frame (fast enough for ~600 visible tiles at 60 fps).
//   - Entity sprite system is unchanged from Phase 2.

import {
  isWorldLoaded,
  getWorldData,
  TILE_COLORS,
  TILE_HIGHLIGHT,
  getWorldPixelWidth,
  getWorldPixelHeight,
} from './world.js';

// ---------------------------------------------------------------------------
// Constants  (must match main.js)
// ---------------------------------------------------------------------------

const CANVAS_WIDTH  = 900;
const CANVAS_HEIGHT = 600;

// Camera vertical offset — player appears slightly above screen centre so
// players see more ground below them (classic platformer framing).
const CAM_Y_OFFSET = CANVAS_HEIGHT * 0.45;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** @type {Map<number, PIXI.Graphics>} entityId → display object */
const _displayObjects = new Map();

/** Reused each frame to detect stale display objects. */
const _liveIds = new Set();

/** Single Graphics object for all tile geometry, inserted once at z-index 0. */
let _tileGfx = null;

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/**
 * Sync the PixiJS scene with the current entity array.
 *
 * @param {PIXI.Container} worldLayer  Offset by camera transform each frame.
 * @param {Array<Object>}  entities
 */
export function render(worldLayer, entities) {
  // ── Camera ──────────────────────────────────────────────────────────────
  const local = _findLocalPlayer(entities);
  let camX = 0, camY = 0;

  if (local && isWorldLoaded()) {
    const maxX = Math.max(0, getWorldPixelWidth()  - CANVAS_WIDTH);
    const maxY = Math.max(0, getWorldPixelHeight() - CANVAS_HEIGHT);

    camX = Math.max(0, Math.min(local.position.x - CANVAS_WIDTH  / 2, maxX));
    camY = Math.max(0, Math.min(local.position.y - CAM_Y_OFFSET,      maxY));
  }

  worldLayer.x = -Math.round(camX);
  worldLayer.y = -Math.round(camY);

  // ── Tiles ────────────────────────────────────────────────────────────────
  if (isWorldLoaded()) {
    _renderTiles(worldLayer, camX, camY);
  }

  // ── Entities ─────────────────────────────────────────────────────────────
  _liveIds.clear();

  for (const entity of entities) {
    if (!entity?.image || !entity?.position) continue;

    const { id, image, position } = entity;
    _liveIds.add(id);

    let gfx = _displayObjects.get(id);
    if (!gfx) {
      gfx = _createEntitySprite(image);
      _displayObjects.set(id, gfx);
      worldLayer.addChild(gfx); // always added above tiles
    }

    gfx.x = Math.round(position.x - image.width  / 2);
    gfx.y = Math.round(position.y - image.height / 2);
  }

  // Destroy display objects for entities that no longer exist.
  for (const [id, gfx] of _displayObjects) {
    if (_liveIds.has(id)) continue;
    worldLayer.removeChild(gfx);
    gfx.destroy();
    _displayObjects.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Tile rendering
// ---------------------------------------------------------------------------

function _renderTiles(worldLayer, camX, camY) {
  // Create the tile layer once, pinned behind all entity sprites.
  if (!_tileGfx) {
    _tileGfx = new PIXI.Graphics();
    worldLayer.addChildAt(_tileGfx, 0);
  }

  const { tiles, width, height, tileSize: ts } = getWorldData();

  _tileGfx.clear();

  // Visible range with a 1-tile buffer to avoid pop-in at screen edges.
  const startX = Math.max(0,          Math.floor(camX / ts) - 1);
  const endX   = Math.min(width  - 1, Math.ceil((camX + CANVAS_WIDTH)  / ts) + 1);
  const startY = Math.max(0,          Math.floor(camY / ts) - 1);
  const endY   = Math.min(height - 1, Math.ceil((camY + CANVAS_HEIGHT) / ts) + 1);

  for (let ty = startY; ty <= endY; ty++) {
    for (let tx = startX; tx <= endX; tx++) {
      const tileType = tiles[ty * width + tx];
      if (tileType === 0) continue; // air — nothing to draw

      const color = TILE_COLORS[tileType]    ?? 0x888888;
      const hi    = TILE_HIGHLIGHT[tileType] ?? _scaleColor(color, 1.3);
      const px    = tx * ts;
      const py    = ty * ts;

      // Main body
      _tileGfx.beginFill(color);
      _tileGfx.drawRect(px, py, ts, ts);
      _tileGfx.endFill();

      // Top-edge highlight — gives the surface tiles a sense of depth
      _tileGfx.beginFill(hi, 0.55);
      _tileGfx.drawRect(px, py, ts, 3);
      _tileGfx.endFill();
    }
  }
}

// ---------------------------------------------------------------------------
// Entity sprite factory (unchanged from Phase 2)
// ---------------------------------------------------------------------------

function _createEntitySprite(image) {
  const { width, height, color } = image;
  const outlineColor    = _scaleColor(color, 0.6);
  const highlightColor  = _scaleColor(color, 1.5);

  const gfx = new PIXI.Graphics();

  // Drop shadow
  gfx.beginFill(0x000000, 0.25);
  gfx.drawRect(3, 4, width, height);
  gfx.endFill();

  // Main body + outline
  gfx.lineStyle(2, outlineColor, 1);
  gfx.beginFill(color, 1);
  gfx.drawRect(0, 0, width, height);
  gfx.endFill();
  gfx.lineStyle(0);

  // Top highlight
  gfx.beginFill(highlightColor, 0.35);
  gfx.drawRect(3, 2, width - 6, 4);
  gfx.endFill();

  return gfx;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _findLocalPlayer(entities) {
  for (const e of entities) {
    if (e.isLocal && e.isPlayer) return e;
  }
  return null;
}

function _scaleColor(color, factor) {
  const r = Math.min(255, ((color >> 16) & 0xff) * factor) | 0;
  const g = Math.min(255, ((color >> 8)  & 0xff) * factor) | 0;
  const b = Math.min(255, (color         & 0xff) * factor) | 0;
  return (r << 16) | (g << 8) | b;
}