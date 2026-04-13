// render.js — Phase 6: Sprites, Animations & Visual Identity.
//
// Replaces the Phase 5 coloured-rectangle player renderer with PixiJS
// AnimatedSprite objects driven by the AutoSprite spritesheet assets.
//
// Layer order inside worldLayer (offset each frame by camera):
//   [0] _tileGfx          — terrain rectangles
//   [1] _entitiesContainer — all entity visuals (sprites + pickup graphics)
//   [2] _miningOverlay    — semi-transparent tile-break progress
//
// Entity types:
//   • entity.character   → AnimatedSprite (players; loaded via assetLoader.js)
//   • entity.image       → PIXI.Graphics rectangle (pickups, legacy)
//
// Phase 4 darkness / lighting layer is retained unchanged on darknessLayer.

import { setCameraPosition } from './camera.js';
import {
  isWorldLoaded,
  getWorldData,
  getTileSize,
  TILE_COLORS,
  getWorldPixelWidth,
  getWorldPixelHeight,
} from './world.js';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from './config.js';
import { getFrames }                   from './assetLoader.js';
import { SPRITE_SCALE, ANIM_SPEED, LOOPS, getAnimState } from './sprites.js';

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

/** Player viewport vertical offset — shows a bit more terrain below player. */
const CAM_Y_OFFSET = CANVAS_HEIGHT * 0.45;

// ---------------------------------------------------------------------------
// Layer references (initialised lazily on first render call)
// ---------------------------------------------------------------------------

/** @type {PIXI.Container|null} */
let _entitiesContainer = null;

// ---------------------------------------------------------------------------
// Entity sprite pool — character-based (AnimatedSprite)
// ---------------------------------------------------------------------------

/**
 * Per-entity sprite state.
 *
 * @typedef {{ container: PIXI.Container, sprite: PIXI.AnimatedSprite,
 *             shadow: PIXI.Graphics, state: string, facing: number }} SpriteObj
 * @type {Map<number, SpriteObj>}
 */
const _spriteObjects = new Map();

// ---------------------------------------------------------------------------
// Entity graphics pool — image-based (PIXI.Graphics for pickups etc.)
// ---------------------------------------------------------------------------

/** @type {Map<number, PIXI.Graphics>} */
const _graphicsObjects = new Map();

/** @type {Set<number>} ids of entities alive this frame */
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

let _darknessReady = false;

/**
 * Gradient textures keyed by rounded radius (px).
 * @type {Map<number, PIXI.Texture>}
 */
const _gradientCache = new Map();

/**
 * ERASE-blend sprites keyed by entity id.
 * @type {Map<number, PIXI.Sprite>}
 */
const _lightSprites = new Map();

// ---------------------------------------------------------------------------
// Mining overlay
// ---------------------------------------------------------------------------

/** @type {PIXI.Graphics|null} */
let _miningOverlay = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sync the PixiJS scene with current game state.
 *
 * @param {PIXI.Container} worldLayer
 * @param {PIXI.Container} darknessLayer
 * @param {Array<Object>}  entities
 * @param {{ tx:number, ty:number, progress:number, hardness:number }|null} [miningState]
 */
export function render(worldLayer, darknessLayer, entities, miningState) {

  // ── Lazy-init sub-container for entities ────────────────────────────────
  if (!_entitiesContainer) {
    _entitiesContainer = new PIXI.Container();
    worldLayer.addChild(_entitiesContainer);
  }

  // ── Camera ───────────────────────────────────────────────────────────────
  const local = _findLocalPlayer(entities);
  let camX = 0;
  let camY = 0;

  if (local && isWorldLoaded()) {
    const maxX = Math.max(0, getWorldPixelWidth()  - CANVAS_WIDTH);
    const maxY = Math.max(0, getWorldPixelHeight() - CANVAS_HEIGHT);
    camX = Math.max(0, Math.min(local.position.x - CANVAS_WIDTH  / 2, maxX));
    camY = Math.max(0, Math.min(local.position.y - CAM_Y_OFFSET,      maxY));
  }

  setCameraPosition(camX, camY);
  worldLayer.x = -Math.round(camX);
  worldLayer.y = -Math.round(camY);

  // ── Terrain ──────────────────────────────────────────────────────────────
  if (isWorldLoaded()) {
    _renderTilesIfNeeded(worldLayer, camX, camY);
  }

  // ── Entity visuals ───────────────────────────────────────────────────────
  _liveIds.clear();

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (!entity?.position) continue;

    const { id } = entity;
    _liveIds.add(id);

    if (entity.character) {
      // ── Animated character sprite ────────────────────────────────────────
      // Remove any legacy graphics leftover for this id (shouldn't happen, but safe).
      _removeGraphics(id);
      _updateCharacterSprite(entity);

    } else if (entity.image) {
      // ── Coloured-rectangle fallback (pickups, etc.) ──────────────────────
      // Remove any leftover sprite for this id.
      _removeSprite(id);

      const { position, image } = entity;
      let gfx = _graphicsObjects.get(id);
      if (!gfx) {
        gfx = _buildEntityGfx(image);
        _graphicsObjects.set(id, gfx);
        _entitiesContainer.addChild(gfx);
      }
      gfx.x = Math.round(position.x - image.width  / 2);
      gfx.y = Math.round(position.y - image.height / 2);
    }
  }

  // ── Garbage-collect removed entities ────────────────────────────────────
  for (const id of _spriteObjects.keys()) {
    if (!_liveIds.has(id)) _removeSprite(id);
  }
  for (const id of _graphicsObjects.keys()) {
    if (!_liveIds.has(id)) _removeGraphics(id);
  }

  // ── Mining overlay ───────────────────────────────────────────────────────
  _renderMiningOverlay(worldLayer, miningState ?? null);

  // ── Darkness + light holes ───────────────────────────────────────────────
  _updateDarkness(darknessLayer, entities, camX, camY);
}

// ---------------------------------------------------------------------------
// Character sprite helpers
// ---------------------------------------------------------------------------

/**
 * Create or update the AnimatedSprite for a character-based entity.
 *
 * Layout inside the container (origin = entity's bottom-centre):
 *   shadow  → ellipse at (0, 2)  — ground contact indicator
 *   sprite  → anchor (0.5, 1)   — grows upward from origin
 *
 * @param {Object} entity
 */
function _updateCharacterSprite(entity) {
  const { id, position, velocity, box, character } = entity;

  // Entity bottom-centre in world space
  const bx = Math.round(position.x + (box?.offsetX ?? 0));
  const by = Math.round(position.y + (box?.offsetY ?? 0) + (box?.height ?? 0) / 2);

  let obj = _spriteObjects.get(id);

  if (!obj) {
    obj = _createCharacterSprite(character);
    _spriteObjects.set(id, obj);
    _entitiesContainer.addChild(obj.container);
  }

  // ── Position ─────────────────────────────────────────────────────────────
  obj.container.x = bx;
  obj.container.y = by;

  // ── Facing direction (sticky — only changes when velocity is meaningful) ─
  const vx = velocity?.x ?? 0;
  if (vx < -8)      obj.facing = -1;
  else if (vx > 8)  obj.facing =  1;

  // ── Animation state machine ───────────────────────────────────────────────
  const newState = getAnimState(entity);

  if (newState !== obj.state) {
    const frames = getFrames(character, newState);
    if (frames && frames.length > 0) {
      obj.sprite.textures        = frames;
      obj.sprite.animationSpeed  = ANIM_SPEED[newState] ?? 0.2;
      obj.sprite.loop            = LOOPS.has(newState);
      obj.sprite.gotoAndPlay(0);
    }
    obj.state = newState;
  }

  // ── Apply scale (negative x = flip for left-facing) ──────────────────────
  obj.sprite.scale.x = obj.facing * SPRITE_SCALE;
  obj.sprite.scale.y = SPRITE_SCALE;
}

/**
 * Build a fresh SpriteObj for the given character name.
 *
 * @param   {string}    characterName
 * @returns {SpriteObj}
 */
function _createCharacterSprite(characterName) {
  const container = new PIXI.Container();

  // Ground-contact shadow (rendered below the sprite)
  const shadow = new PIXI.Graphics();
  shadow.beginFill(0x000000, 0.28);
  shadow.drawEllipse(0, 2, 13, 4);
  shadow.endFill();
  container.addChild(shadow);

  // Animated sprite
  const idleFrames = getFrames(characterName, 'idle') ?? [PIXI.Texture.WHITE];
  const sprite     = new PIXI.AnimatedSprite(idleFrames);
  sprite.anchor.set(0.5, 1);       // bottom-centre pivot
  sprite.scale.set(SPRITE_SCALE);
  sprite.animationSpeed = ANIM_SPEED.idle;
  sprite.loop           = true;
  sprite.play();
  container.addChild(sprite);

  return { container, sprite, shadow, state: 'idle', facing: 1 };
}

/**
 * Destroy and remove an animated sprite object from the scene.
 *
 * @param {number} id
 */
function _removeSprite(id) {
  const obj = _spriteObjects.get(id);
  if (!obj) return;
  obj.sprite.stop();
  _entitiesContainer.removeChild(obj.container);
  obj.container.destroy({ children: true });
  _spriteObjects.delete(id);
}

/**
 * Destroy and remove a graphics object from the scene.
 *
 * @param {number} id
 */
function _removeGraphics(id) {
  const gfx = _graphicsObjects.get(id);
  if (!gfx) return;
  _entitiesContainer.removeChild(gfx);
  gfx.destroy();
  _graphicsObjects.delete(id);
}

// ---------------------------------------------------------------------------
// Mining overlay helpers
// ---------------------------------------------------------------------------

function _renderMiningOverlay(worldLayer, miningState) {
  if (!_miningOverlay) {
    _miningOverlay = new PIXI.Graphics();
    worldLayer.addChild(_miningOverlay);
  }

  _miningOverlay.clear();
  if (!miningState) return;

  const { tx, ty, progress, hardness } = miningState;
  const ts    = getTileSize();
  const ratio = Math.min(progress / hardness, 1);
  const x     = tx * ts;
  const y     = ty * ts;

  _miningOverlay.beginFill(0x000000, 0.15 + 0.5 * ratio);
  _miningOverlay.drawRect(x, y, ts, ts);
  _miningOverlay.endFill();

  const barH = 4;
  _miningOverlay.beginFill(0x000000, 0.7);
  _miningOverlay.drawRect(x, y + ts - barH, ts, barH);
  _miningOverlay.endFill();

  _miningOverlay.beginFill(0xffffff, 0.9);
  _miningOverlay.drawRect(x, y + ts - barH, Math.round(ts * ratio), barH);
  _miningOverlay.endFill();
}

// ---------------------------------------------------------------------------
// Darkness helpers
// ---------------------------------------------------------------------------

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
    if (!e?.lightsource || !e?.position) continue;

    const { id, position, lightsource } = e;
    const radius = lightsource.radius;
    activeIds.add(id);

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
      sprite.texture       = _getGradientTexture(radius);
      sprite._cachedRadius = radius;
    }

    sprite.x = sx;
    sprite.y = sy;
  }

  const toRemove = [];
  for (const [id] of _lightSprites) {
    if (!activeIds.has(id)) toRemove.push(id);
  }
  for (let i = 0; i < toRemove.length; i++) {
    const id     = toRemove[i];
    const sprite = _lightSprites.get(id);
    layer.removeChild(sprite);
    sprite.destroy({ texture: false });
    _lightSprites.delete(id);
  }
}

function _getGradientTexture(radius) {
  const r = Math.round(radius);
  if (_gradientCache.has(r)) return _gradientCache.get(r);

  const diam   = r * 2;
  const canvas = document.createElement('canvas');
  canvas.width  = diam;
  canvas.height = diam;

  const ctx  = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);

  grad.addColorStop(0.00, 'rgba(255,255,255,1.00)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.97)');
  grad.addColorStop(0.60, 'rgba(255,255,255,0.72)');
  grad.addColorStop(0.78, 'rgba(255,255,255,0.38)');
  grad.addColorStop(0.90, 'rgba(255,255,255,0.10)');
  grad.addColorStop(1.00, 'rgba(255,255,255,0.00)');

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
    worldLayer.addChildAt(_tileGfx, 0);          // behind everything
  }

  const world = getWorldData();
  const { tiles, width, height, tileSize: ts, revision } = world;

  const startX = Math.max(0,          Math.floor(camX / ts) - 1);
  const endX   = Math.min(width  - 1, Math.ceil((camX + CANVAS_WIDTH)  / ts) + 1);
  const startY = Math.max(0,          Math.floor(camY / ts) - 1);
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
// Graphics entity factory (pickups, legacy coloured rectangles)
// ---------------------------------------------------------------------------

function _buildEntityGfx(image) {
  const { width, height, color } = image;
  const outline   = _scaleColor(color, 0.6);
  const highlight = _scaleColor(color, 1.5);
  const gfx       = new PIXI.Graphics();

  gfx.beginFill(0x000000, 0.25);
  gfx.drawRect(3, 4, width, height);
  gfx.endFill();

  gfx.lineStyle(2, outline, 1);
  gfx.beginFill(color);
  gfx.drawRect(0, 0, width, height);
  gfx.endFill();
  gfx.lineStyle(0);

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