// render.js — Phase 3 renderer: camera + terrain + entities.
//
// Improvements:
//   - Uses shared viewport constants from config.js
//   - Avoids rebuilding tile geometry every frame
//   - Rebuilds visible tiles only when camera tile-window changes

import {
  isWorldLoaded,
  getWorldData,
  TILE_COLORS,
  TILE_HIGHLIGHT,
  getWorldPixelWidth,
  getWorldPixelHeight,
} from './world.js';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from './config.js';

// Camera vertical offset — local player appears slightly above center.
const CAM_Y_OFFSET = CANVAS_HEIGHT * 0.45;

/** @type {Map<number, PIXI.Graphics>} entityId -> display object */
const _displayObjects = new Map();

/** @type {Set<number>} */
const _liveIds = new Set();

/** @type {PIXI.Graphics|null} */
let _tileGfx = null;

/** Cached tile window and world signature to avoid unnecessary redraws. */
const _tileCache = {
  worldWidth: -1,
  worldHeight: -1,
  tileSize: -1,
  worldRevision: null,
  startX: -1,
  endX: -1,
  startY: -1,
  endY: -1,
  valid: false,
};

/**
 * Sync the Pixi scene with current game state.
 *
 * @param {PIXI.Container} worldLayer
 * @param {Array<Object>} entities
 */
export function render(worldLayer, entities) {
  // Camera
  const local = _findLocalPlayer(entities);
  let camX = 0;
  let camY = 0;

  if (local && isWorldLoaded()) {
    const maxX = Math.max(0, getWorldPixelWidth() - CANVAS_WIDTH);
    const maxY = Math.max(0, getWorldPixelHeight() - CANVAS_HEIGHT);

    camX = Math.max(0, Math.min(local.position.x - CANVAS_WIDTH / 2, maxX));
    camY = Math.max(0, Math.min(local.position.y - CAM_Y_OFFSET, maxY));
  }

  worldLayer.x = -Math.round(camX);
  worldLayer.y = -Math.round(camY);

  // Terrain
  if (isWorldLoaded()) {
    _renderTilesIfNeeded(worldLayer, camX, camY);
  }

  // Entities
  _liveIds.clear();

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (!entity?.image || !entity?.position) continue;

    const { id, image, position } = entity;
    _liveIds.add(id);

    let gfx = _displayObjects.get(id);
    if (!gfx) {
      gfx = _createEntitySprite(image);
      _displayObjects.set(id, gfx);
      worldLayer.addChild(gfx);
    }

    gfx.x = Math.round(position.x - image.width / 2);
    gfx.y = Math.round(position.y - image.height / 2);
  }

  // Cleanup stale entity sprites
  for (const [id, gfx] of _displayObjects) {
    if (_liveIds.has(id)) continue;
    worldLayer.removeChild(gfx);
    gfx.destroy();
    _displayObjects.delete(id);
  }
}

function _renderTilesIfNeeded(worldLayer, camX, camY) {
  if (!_tileGfx) {
    _tileGfx = new PIXI.Graphics();
    worldLayer.addChildAt(_tileGfx, 0);
  }

  const world = getWorldData();
  const { tiles, width, height, tileSize: ts } = world;
  const worldRevision = world.revision ?? tiles;

  // Visible range with 1-tile guard band.
  const startX = Math.max(0, Math.floor(camX / ts) - 1);
  const endX = Math.min(width - 1, Math.ceil((camX + CANVAS_WIDTH) / ts) + 1);
  const startY = Math.max(0, Math.floor(camY / ts) - 1);
  const endY = Math.min(height - 1, Math.ceil((camY + CANVAS_HEIGHT) / ts) + 1);

  const sameWindow =
    _tileCache.valid &&
    _tileCache.worldWidth === width &&
    _tileCache.worldHeight === height &&
    _tileCache.tileSize === ts &&
    _tileCache.worldRevision === worldRevision &&
    _tileCache.startX === startX &&
    _tileCache.endX === endX &&
    _tileCache.startY === startY &&
    _tileCache.endY === endY;

  if (sameWindow) return;

  _tileGfx.clear();

  for (let ty = startY; ty <= endY; ty++) {
    const row = ty * width;
    const py = ty * ts;

    for (let tx = startX; tx <= endX; tx++) {
      const tileType = tiles[row + tx];
      if (tileType === 0) continue;

      const color = TILE_COLORS[tileType] ?? 0x888888;
      const hi = TILE_HIGHLIGHT[tileType] ?? _scaleColor(color, 1.3);
      const px = tx * ts;

      _tileGfx.beginFill(color);
      _tileGfx.drawRect(px, py, ts, ts);
      _tileGfx.endFill();

      _tileGfx.beginFill(hi, 0.55);
      _tileGfx.endFill();
    }
  }

  _tileCache.worldWidth = width;
  _tileCache.worldHeight = height;
  _tileCache.tileSize = ts;
  _tileCache.worldRevision = worldRevision;
  _tileCache.startX = startX;
  _tileCache.endX = endX;
  _tileCache.startY = startY;
  _tileCache.endY = endY;
  _tileCache.valid = true;
}

function _createEntitySprite(image) {
  const { width, height, color } = image;
  const outlineColor = _scaleColor(color, 0.6);
  const highlightColor = _scaleColor(color, 1.5);

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

function _findLocalPlayer(entities) {
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (e?.isLocal && e?.isPlayer) return e;
  }
  return null;
}

function _scaleColor(color, factor) {
  const r = Math.min(255, ((color >> 16) & 0xff) * factor) | 0;
  const g = Math.min(255, ((color >> 8) & 0xff) * factor) | 0;
  const b = Math.min(255, (color & 0xff) * factor) | 0;
  return (r << 16) | (g << 8) | b;
}
