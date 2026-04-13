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
  getWorldPixelWidth,
  getWorldPixelHeight,
} from './world.js';
import { getCanvasWidth, getCanvasHeight } from './config.js';
import { getFrames }                   from './assetLoader.js';
import { SPRITE_SCALE, ANIM_SPEED, LOOPS, getAnimState } from './sprites.js';

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

/**
 * How far from the top of the screen the player's centre sits.
 * Set to ~0.78 so the ground (player feet) lands at roughly 4/5 down —
 * i.e. 1/5 from the bottom — giving a wide, airy sky.
 */
function _camYOffset() { return getCanvasHeight() * 0.78; }

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
let _groundGfx = null;

/** Cached per-column surface Y (world-px). Rebuilt when world revision changes. */
let _groundSurface   = null;   // Float32Array, length = world tile width
let _groundRevision  = -1;

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
    const W    = getCanvasWidth();
    const H    = getCanvasHeight();
    const maxX = Math.max(0, getWorldPixelWidth()  - W);
    const maxY = Math.max(0, getWorldPixelHeight() - H);
    camX = Math.max(0, Math.min(local.position.x - W / 2,        maxX));
    camY = Math.max(0, Math.min(local.position.y - _camYOffset(), maxY));
  }

  setCameraPosition(camX, camY);
  worldLayer.x = -Math.round(camX);
  worldLayer.y = -Math.round(camY);

  // ── Ground ───────────────────────────────────────────────────────────────
  _renderGround(worldLayer, camX, camY);

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
    bg.drawRect(0, 0, 16384, 16384);
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

/**
 * Draw a smooth, slightly rolling ground fill in a papery off-white.
 *
 * The ground surface is derived from the tile data (first solid tile per
 * column), lightly smoothed, then rendered as a single filled polygon that
 * extends from the surface down to the bottom of the world.  No grid, no
 * individual tile colours — just a clean organic landmass.
 *
 * When the world isn't loaded yet the function is a no-op.
 */
function _renderGround(worldLayer, camX, camY) {
  if (!isWorldLoaded()) return;

  if (!_groundGfx) {
    _groundGfx = new PIXI.Graphics();
    worldLayer.addChildAt(_groundGfx, 0);   // behind entities
  }

  const world = getWorldData();
  const { tiles, width, height, tileSize: ts, revision } = world;
  if (!tiles) return;

  // ── Rebuild surface cache when world data changes ─────────────────────────
  if (revision !== _groundRevision || !_groundSurface) {
    _groundSurface  = new Float32Array(width);
    for (let tx = 0; tx < width; tx++) {
      let surfaceY = height * ts;           // default: world floor
      for (let ty = 0; ty < height; ty++) {
        if (tiles[ty * width + tx] !== 0) {
          surfaceY = ty * ts;
          break;
        }
      }
      _groundSurface[tx] = surfaceY;
    }
    _groundRevision = revision;
  }

  // ── Determine the tile columns that are (slightly) off-screen ─────────────
  const W      = getCanvasWidth();
  const worldH = height * ts;

  // Add generous margin so the polygon never has a visible left/right gap.
  const startTx = Math.max(0,         Math.floor(camX / ts) - 3);
  const endTx   = Math.min(width - 1, Math.ceil((camX + W) / ts) + 3);

  // ── Build smoothed surface points ─────────────────────────────────────────
  // Average over a small window (±4 tiles) to soften any hard tile steps.
  const SMOOTH_R = 4;
  const pts = [];   // [{x, y}] in world-px

  for (let tx = startTx; tx <= endTx; tx++) {
    let sum = 0, n = 0;
    for (let d = -SMOOTH_R; d <= SMOOTH_R; d++) {
      const nx = Math.max(0, Math.min(width - 1, tx + d));
      // Weight: closer columns matter more (triangle kernel)
      const w = SMOOTH_R + 1 - Math.abs(d);
      sum += _groundSurface[nx] * w;
      n   += w;
    }
    pts.push({ x: tx * ts + ts * 0.5, y: sum / n });
  }

  // ── Draw filled ground polygon ─────────────────────────────────────────────
  // Papery off-white — warm, slightly yellowish, like uncoated paper.
  const GROUND_COLOR = 0xf5e6c8;

  _groundGfx.clear();
  _groundGfx.beginFill(GROUND_COLOR, 1);

  // Start at bottom-left corner, trace surface left→right, close at bottom-right.
  const leftX  = pts[0].x;
  const rightX = pts[pts.length - 1].x;

  _groundGfx.moveTo(leftX,  worldH + 200);
  _groundGfx.lineTo(leftX,  pts[0].y);

  // Use quadratic Bézier midpoints for a silky smooth curve.
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const mx = (p0.x + p1.x) * 0.5;
    const my = (p0.y + p1.y) * 0.5;
    _groundGfx.quadraticCurveTo(p0.x, p0.y, mx, my);
  }
  // Finish curve through the last point
  const last = pts[pts.length - 1];
  _groundGfx.lineTo(last.x, last.y);

  _groundGfx.lineTo(rightX, worldH + 200);
  _groundGfx.closePath();
  _groundGfx.endFill();
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