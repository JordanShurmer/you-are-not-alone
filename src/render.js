// render.js — Phase 4 renderer: camera + terrain + entities + darkness & light.
//
// Phase 4 additions:
//   - Accepts a `darknessLayer` container (sits above worldLayer in the stage)
//   - Any entity with `.lightsource { radius }` cuts a soft radial hole in the
//     darkness — duck-typed, just like `.image` drives sprites or `.box` drives
//     collision.  Any future entity type (torch, lantern, dragon fire) just
//     needs the field; the renderer finds it automatically.
//   - Gradient textures are generated once via Canvas API and cached by radius.
//   - PIXI.BLEND_MODES.ERASE on a container that has a filter applied gives us
//     true alpha-subtraction so lights punch real holes in the overlay.

import {
  isWorldLoaded,
  getWorldData,
  TILE_COLORS,
  getWorldPixelWidth,
  getWorldPixelHeight,
} from './world.js';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from './config.js';

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

// Local player appears slightly above vertical centre for better look-ahead.
const CAM_Y_OFFSET = CANVAS_HEIGHT * 0.45;

// ---------------------------------------------------------------------------
// Entity sprite pool
// ---------------------------------------------------------------------------

/** @type {Map<number, PIXI.Graphics>} entityId -> display object */
const _displayObjects = new Map();

/** @type {Set<number>} scratch set — which ids are alive this frame */
const _liveIds = new Set();

// ---------------------------------------------------------------------------
// Terrain tile cache
// ---------------------------------------------------------------------------

/** @type {PIXI.Graphics|null} */
let _tileGfx = null;

const _tileCache = {
  worldWidth: -1, worldHeight: -1, tileSize: -1,
  worldRevision: -1,
  startX: -1, endX: -1, startY: -1, endY: -1,
  valid: false,
};

// ---------------------------------------------------------------------------
// Darkness / lighting state
// ---------------------------------------------------------------------------

/** Whether the darkness layer has been bootstrapped yet. */
let _darknessReady = false;

/**
 * Gradient textures keyed by rounded radius (px).
 * Built once via Canvas API; PIXI keeps the GPU texture alive.
 * @type {Map<number, PIXI.Texture>}
 */
const _gradientCache = new Map();

/**
 * One ERASE-blend Sprite per lightsource entity, keyed by entity id.
 * Created on first sight, repositioned every frame, destroyed when the
 * entity loses its .lightsource or is removed from the world.
 * @type {Map<number, PIXI.Sprite>}
 */
const _lightSprites = new Map();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sync the Pixi scene with current game state.
 *
 * @param {PIXI.Container} worldLayer    - world-space layer (offset by camera)
 * @param {PIXI.Container} darknessLayer - screen-space darkness overlay
 * @param {Array<Object>}  entities      - full entity array
 */
export function render(worldLayer, darknessLayer, entities) {
  // ── Camera ─────────────────────────────────────────────────────────────
  const local = _findLocalPlayer(entities);
  let camX = 0;
  let camY = 0;

  if (local && isWorldLoaded()) {
    const maxX = Math.max(0, getWorldPixelWidth()  - CANVAS_WIDTH);
    const maxY = Math.max(0, getWorldPixelHeight() - CANVAS_HEIGHT);
    camX = Math.max(0, Math.min(local.position.x - CANVAS_WIDTH  / 2, maxX));
    camY = Math.max(0, Math.min(local.position.y - CAM_Y_OFFSET,      maxY));
  }

  worldLayer.x = -Math.round(camX);
  worldLayer.y = -Math.round(camY);

  // ── Terrain ─────────────────────────────────────────────────────────────
  if (isWorldLoaded()) {
    _renderTilesIfNeeded(worldLayer, camX, camY);
  }

  // ── Entity sprites ───────────────────────────────────────────────────────
  _liveIds.clear();

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (!entity?.image || !entity?.position) continue;

    const { id, image, position } = entity;
    _liveIds.add(id);

    let gfx = _displayObjects.get(id);
    if (!gfx) {
      gfx = _buildEntityGfx(image);
      _displayObjects.set(id, gfx);
      worldLayer.addChild(gfx);
    }

    gfx.x = Math.round(position.x - image.width  / 2);
    gfx.y = Math.round(position.y - image.height / 2);
  }

  // Remove sprites for entities that no longer exist.
  for (const [id, gfx] of _displayObjects) {
    if (_liveIds.has(id)) continue;
    worldLayer.removeChild(gfx);
    gfx.destroy();
    _displayObjects.delete(id);
  }

  // ── Darkness + light holes ───────────────────────────────────────────────
  _updateDarkness(darknessLayer, entities, camX, camY);
}

// ---------------------------------------------------------------------------
// Darkness helpers
// ---------------------------------------------------------------------------

/**
 * Bootstrap the darkness container on first call, then every frame:
 *   1. Find all entities that duck-type as lightsources (.lightsource.radius).
 *   2. Give each one an ERASE-blend gradient sprite positioned in screen-space.
 *   3. Remove sprites for entities that have lost their lightsource or died.
 *
 * Why AlphaFilter?
 *   PIXI.BLEND_MODES.ERASE subtracts alpha from its *parent's framebuffer*.
 *   A plain Container composites directly onto the stage, so ERASE bleeds
 *   through everything.  Setting any filter on the Container forces PIXI to
 *   first render it into an isolated off-screen texture; ERASE then correctly
 *   punches holes only within that texture.  AlphaFilter(0.96) doubles as the
 *   overall darkness opacity — 96 % opaque, 4 % ambient.
 *
 * @param {PIXI.Container} layer
 * @param {Array<Object>}  entities
 * @param {number}         camX
 * @param {number}         camY
 */
function _updateDarkness(layer, entities, camX, camY) {
  if (!_darknessReady) {
    layer.filters = [new PIXI.AlphaFilter(1.0)];

    const bg = new PIXI.Graphics();
    bg.beginFill(0x000000, 1.0);
    bg.drawRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    bg.endFill();
    layer.addChild(bg);

    _darknessReady = true;
  }

  const activeIds = new Set();

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    // Duck-type: any entity with .lightsource + .position is a light source.
    // Players carry one by default; torches, campfires, etc. will too.
    if (!e?.lightsource || !e?.position) continue;

    const { id, position, lightsource } = e;
    const radius = lightsource.radius;
    activeIds.add(id);

    // World-space → screen-space, with optional per-entity light offset
    const sx = Math.round(position.x + (lightsource.offsetX ?? 0) - camX);
    const sy = Math.round(position.y + (lightsource.offsetY ?? 0) - camY);

    let sprite = _lightSprites.get(id);

    if (!sprite) {
      sprite = new PIXI.Sprite(_getGradientTexture(radius));
      sprite.anchor.set(0.5, 0.5);
      sprite.blendMode = PIXI.BLEND_MODES.ERASE;
      sprite._cachedRadius = radius;
      layer.addChild(sprite);
      _lightSprites.set(id, sprite);
    } else if (sprite._cachedRadius !== radius) {
      // Radius changed (power-up, damage, etc.) — hot-swap the texture.
      sprite.texture = _getGradientTexture(radius);
      sprite._cachedRadius = radius;
    }

    sprite.x = sx;
    sprite.y = sy;
  }

  // Tear down sprites for entities that disappeared or lost their lightsource.
  const toRemove = [];
  for (const [id] of _lightSprites) {
    if (!activeIds.has(id)) toRemove.push(id);
  }
  for (let i = 0; i < toRemove.length; i++) {
    const id     = toRemove[i];
    const sprite = _lightSprites.get(id);
    layer.removeChild(sprite);
    sprite.destroy({ texture: false }); // keep the cached gradient texture alive
    _lightSprites.delete(id);
  }
}

/**
 * Build (and permanently cache) a radial-gradient texture for `radius` px.
 *
 * Stops are tuned for "moody, not hard-clipped" (Phase 4 spec):
 *   - Bright, stable core (feels like real carried light)
 *   - Gradual mid-field fade
 *   - Soft, nearly-invisible fringe so the edge breathes rather than cuts
 *
 * @param   {number}       radius   world-space radius in pixels
 * @returns {PIXI.Texture}
 */
function _getGradientTexture(radius) {
  const r = Math.round(radius);
  if (_gradientCache.has(r)) return _gradientCache.get(r);

  const diam   = r * 2;
  const canvas = document.createElement('canvas');
  canvas.width  = diam;
  canvas.height = diam;

  const ctx  = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);

  grad.addColorStop(0.00, 'rgba(255,255,255,1.00)'); // fully lit core
  grad.addColorStop(0.35, 'rgba(255,255,255,0.97)'); // still bright near-centre
  grad.addColorStop(0.60, 'rgba(255,255,255,0.72)'); // noticeable but gentle mid-fade
  grad.addColorStop(0.78, 'rgba(255,255,255,0.38)'); // clearly dimming
  grad.addColorStop(0.90, 'rgba(255,255,255,0.10)'); // just a breath of light
  grad.addColorStop(1.00, 'rgba(255,255,255,0.00)'); // seamless edge into dark

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, diam, diam);

  const texture = PIXI.Texture.from(canvas);
  _gradientCache.set(r, texture);
  return texture;
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

function _renderTilesIfNeeded(worldLayer, camX, camY) {
  if (!_tileGfx) {
    _tileGfx = new PIXI.Graphics();
    worldLayer.addChildAt(_tileGfx, 0);
  }

  const world = getWorldData();
  const { tiles, width, height, tileSize: ts, revision } = world;

  const startX = Math.max(0,         Math.floor(camX / ts) - 1);
  const endX   = Math.min(width  - 1, Math.ceil((camX + CANVAS_WIDTH)  / ts) + 1);
  const startY = Math.max(0,         Math.floor(camY / ts) - 1);
  const endY   = Math.min(height - 1, Math.ceil((camY + CANVAS_HEIGHT) / ts) + 1);

  const sameWindow =
    _tileCache.valid &&
    _tileCache.worldWidth    === width    &&
    _tileCache.worldHeight   === height   &&
    _tileCache.tileSize      === ts       &&
    _tileCache.worldRevision === revision &&
    _tileCache.startX === startX && _tileCache.endX === endX &&
    _tileCache.startY === startY && _tileCache.endY === endY;

  if (sameWindow) return;

  _tileGfx.clear();

  for (let ty = startY; ty <= endY; ty++) {
    const row = ty * width;
    const py  = ty * ts;

    for (let tx = startX; tx <= endX; tx++) {
      const tileType = tiles[row + tx];
      if (tileType === 0) continue;

      const color = TILE_COLORS[tileType] ?? 0x888888;
      _tileGfx.beginFill(color);
      _tileGfx.drawRect(tx * ts, py, ts, ts);
      _tileGfx.endFill();
    }
  }

  _tileCache.worldWidth    = width;
  _tileCache.worldHeight   = height;
  _tileCache.tileSize      = ts;
  _tileCache.worldRevision = revision;
  _tileCache.startX = startX; _tileCache.endX = endX;
  _tileCache.startY = startY; _tileCache.endY = endY;
  _tileCache.valid  = true;
}

// ---------------------------------------------------------------------------
// Entity sprite factory
// ---------------------------------------------------------------------------

function _buildEntityGfx(image) {
  const { width, height, color } = image;
  const outline   = _scaleColor(color, 0.6);
  const highlight = _scaleColor(color, 1.5);
  const gfx       = new PIXI.Graphics();

  // Drop shadow
  gfx.beginFill(0x000000, 0.25);
  gfx.drawRect(3, 4, width, height);
  gfx.endFill();

  // Body + outline
  gfx.lineStyle(2, outline, 1);
  gfx.beginFill(color);
  gfx.drawRect(0, 0, width, height);
  gfx.endFill();
  gfx.lineStyle(0);

  // Top highlight strip
  gfx.beginFill(highlight, 0.35);
  gfx.drawRect(3, 2, width - 6, 4);
  gfx.endFill();

  return gfx;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function _findLocalPlayer(entities) {
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (e?.isLocal && e?.isPlayer) return e;
  }
  return null;
}

function _scaleColor(color, factor) {
  const r = Math.min(255, ((color >> 16) & 0xff) * factor) | 0;
  const g = Math.min(255, ((color >>  8) & 0xff) * factor) | 0;
  const b = Math.min(255, ( color        & 0xff) * factor) | 0;
  return (r << 16) | (g << 8) | b;
}
