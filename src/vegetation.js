// vegetation.js — Animated bush/tree decorations scattered along the ground surface.
//
// Behavior:
//   • Each instance sits statically on frame 0 until triggered.
//   • Triggers play the animation once then return to frame 0.
//   • Two trigger sources:
//       1. A player enters the instance's triggerRadius (proximity)
//       2. A per-instance random idle timer fires (every 5–20 s)
//
// Assets loaded from:  assets/sprites/vegetation/<name>.{png,json}
// Atlas format identical to AutoSprite character spritesheets.

import { getWorldData } from './world.js';

// ---------------------------------------------------------------------------
// Vegetation type catalogue
// ---------------------------------------------------------------------------

/**
 * @typedef {{ name:string, scale:number, scaleVariance:number,
 *             triggerRadius:number, weight:number }} VegDef
 */
const VEGETATION_DEFS = [
  { name: 'bush',    scale: 0.26, scaleVariance: 0.05, triggerRadius: 140, weight: 3 },
  { name: 'bushes',  scale: 0.30, scaleVariance: 0.05, triggerRadius: 150, weight: 2 },
  { name: 'bushes2', scale: 0.28, scaleVariance: 0.05, triggerRadius: 145, weight: 2 },
  { name: 'tree',    scale: 0.42, scaleVariance: 0.07, triggerRadius: 190, weight: 1 },
  { name: 'tree1',   scale: 0.45, scaleVariance: 0.07, triggerRadius: 190, weight: 1 },
  { name: 'tree2',   scale: 0.43, scaleVariance: 0.07, triggerRadius: 190, weight: 1 },
];

/** Weighted pool for random type selection — items repeated by their weight value. */
const _weightedPool = [];
for (const def of VEGETATION_DEFS) {
  for (let i = 0; i < def.weight; i++) _weightedPool.push(def);
}

// ---------------------------------------------------------------------------
// Frame cache
// ---------------------------------------------------------------------------

/** @type {Map<string, PIXI.Texture[]>} name → animation frames */
const _frameCache = new Map();

let _preloaded = false;

/** @returns {boolean} True once preloadVegetation() has resolved. */
export function isVegetationPreloaded() { return _preloaded; }

// ---------------------------------------------------------------------------
// Preloading
// ---------------------------------------------------------------------------

/**
 * Fetch the PNG spritesheet + JSON atlas for one vegetation type and cache
 * the resulting PIXI.Texture array.  Identical approach to assetLoader.js.
 *
 * @param {string} name
 */
async function _loadType(name) {
  if (_frameCache.has(name)) return;

  const pngPath  = `assets/sprites/vegetation/${name}.png`;
  const jsonPath = `assets/sprites/vegetation/${name}.json`;

  const [atlas, sheetTex] = await Promise.all([
    fetch(jsonPath).then((r) => {
      if (!r.ok) throw new Error(`[Vegetation] Failed to fetch ${jsonPath}: ${r.status}`);
      return r.json();
    }),
    PIXI.Assets.load(pngPath),
  ]);

  const baseTex = (sheetTex instanceof PIXI.BaseTexture)
    ? sheetTex
    : sheetTex.baseTexture;

  if (!baseTex) {
    throw new Error(`[Vegetation] Could not get BaseTexture for ${pngPath}`);
  }

  const frames = Object.keys(atlas.frames)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => {
      const f = atlas.frames[k];
      return new PIXI.Texture(baseTex, new PIXI.Rectangle(f.x, f.y, f.w, f.h));
    });

  if (frames.length === 0) {
    console.warn(`[Vegetation] Zero frames parsed for '${name}'`);
  }

  _frameCache.set(name, frames);
}

/**
 * Preload all vegetation spritesheets.
 * Await this once during boot alongside preloadAllCharacters().
 *
 * @returns {Promise<void>}
 */
export async function preloadVegetation() {
  await Promise.all(VEGETATION_DEFS.map((def) => _loadType(def.name)));
  _preloaded = true;
  console.log('[Vegetation] All types preloaded:', VEGETATION_DEFS.map((d) => d.name).join(', '));
}

// ---------------------------------------------------------------------------
// Instance state
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   sprite:        PIXI.AnimatedSprite,
 *   worldX:        number,
 *   worldY:        number,
 *   triggerRadius: number,
 *   cooldown:      number,
 *   idleTimer:     number,
 *   idleInterval:  number,
 *   wasPlaying:    boolean,
 * }} VegInstance
 */

/** @type {VegInstance[]} */
let _instances = [];

// ---------------------------------------------------------------------------
// Seeded RNG (Mulberry32) — deterministic placement per world size
// ---------------------------------------------------------------------------

/**
 * Returns a seeded pseudo-random function in [0, 1).
 * @param {number} seed
 * @returns {() => number}
 */
function _seededRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Init — place sprites on the world surface
// ---------------------------------------------------------------------------

/**
 * Build the vegetation container from current world data.
 * Returns the container so the caller can insert it at the correct z-depth.
 * Should be called once after the world is loaded and vegetation is preloaded.
 *
 * @returns {PIXI.Container}
 */
export function initVegetation() {
  _instances = [];
  const container = new PIXI.Container();

  const { tiles, width, height, tileSize: ts } = getWorldData();
  if (!tiles) return container;

  // ── Build per-column surface Y (world-px) ─────────────────────────────────
  const surfaceY = new Float32Array(width);
  for (let tx = 0; tx < width; tx++) {
    let sy = height * ts;
    for (let ty = 0; ty < height; ty++) {
      if (tiles[ty * width + tx] !== 0) { sy = ty * ts; break; }
    }
    surfaceY[tx] = sy;
  }

  // ── Deterministic placement ──────────────────────────────────────────────
  const rng = _seededRng(width * 31 + height * 17);

  // Average spacing between plants in tile units.
  const SPACING = 7;
  // Leave a small margin at each world edge.
  const MARGIN  = 3;

  for (let tx = MARGIN; tx < width - MARGIN; tx += SPACING) {
    // Jitter position within the spacing window.
    const jitter  = Math.floor(rng() * SPACING) - Math.floor(SPACING / 2);
    const placeTx = Math.max(MARGIN, Math.min(width - MARGIN - 1, tx + jitter));

    // Skip columns that are below-surface level (could look buried).
    const sy = surfaceY[placeTx];
    if (sy >= height * ts) continue;   // all-air column — no ground

    // Pick a vegetation type.
    const def    = _weightedPool[Math.floor(rng() * _weightedPool.length)];
    const frames = _frameCache.get(def.name);
    if (!frames || frames.length === 0) continue;

    // Scale with a bit of variance; random horizontal flip for variety.
    const scale  = def.scale + (rng() * 2 - 1) * def.scaleVariance;
    const flipX  = rng() < 0.5 ? 1 : -1;

    // World position: bottom-centre of sprite sits exactly on the surface.
    const worldX = placeTx * ts + ts * 0.5;
    const worldY = sy;

    // Build the AnimatedSprite — stopped on frame 0.
    const sprite = new PIXI.AnimatedSprite(frames);
    sprite.animationSpeed = 0.22;
    sprite.loop           = false;
    sprite.gotoAndStop(0);
    sprite.anchor.set(0.5, 1);          // bottom-centre origin
    sprite.scale.set(flipX * scale, scale);
    sprite.x = worldX;
    sprite.y = worldY;

    container.addChild(sprite);

    // Stagger idle timers so plants don't all rustle at once on load.
    const idleInterval = 5 + rng() * 15;
    const idleTimer    = rng() * idleInterval;

    _instances.push({
      sprite,
      worldX,
      worldY,
      triggerRadius: def.triggerRadius,
      cooldown:      0,
      idleTimer,
      idleInterval,
      wasPlaying:    false,
    });
  }

  console.log(`[Vegetation] Placed ${_instances.length} instances across ${width} tile columns`);
  return container;
}

// ---------------------------------------------------------------------------
// Update — called every game tick
// ---------------------------------------------------------------------------

/**
 * Advance vegetation animation state.
 * Handles proximity triggers from nearby players and idle random triggers.
 *
 * @param {number}         dt       Delta-time in seconds.
 * @param {Array<Object>}  entities All current game entities.
 */
export function updateVegetation(dt, entities) {
  if (_instances.length === 0) return;

  // Collect all player world positions once per frame.
  const playerPositions = [];
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (e?.isPlayer && e?.position) playerPositions.push(e.position);
  }

  for (let i = 0; i < _instances.length; i++) {
    const inst = _instances[i];

    // Tick down cooldown.
    if (inst.cooldown > 0) inst.cooldown -= dt;

    // Detect when a one-shot animation finishes → snap back to frame 0.
    if (inst.wasPlaying && !inst.sprite.playing) {
      inst.sprite.gotoAndStop(0);
      inst.wasPlaying = false;
    }

    // While playing or on cooldown, skip trigger checks.
    if (inst.wasPlaying || inst.cooldown > 0) continue;

    // ── Proximity trigger ──────────────────────────────────────────────────
    let triggered = false;
    for (let p = 0; p < playerPositions.length; p++) {
      const pos = playerPositions[p];
      const dx  = pos.x - inst.worldX;
      const dy  = pos.y - inst.worldY;
      if (dx * dx + dy * dy <= inst.triggerRadius * inst.triggerRadius) {
        triggered = true;
        break;
      }
    }

    // ── Idle random trigger ────────────────────────────────────────────────
    if (!triggered) {
      inst.idleTimer -= dt;
      if (inst.idleTimer <= 0) {
        // Reset timer with slight jitter so repeated triggers feel natural.
        inst.idleTimer = inst.idleInterval + (Math.random() * 4 - 2);
        triggered = true;
      }
    }

    // ── Fire animation ─────────────────────────────────────────────────────
    if (triggered) {
      inst.sprite.gotoAndPlay(0);
      inst.wasPlaying = true;
      inst.cooldown   = 2.5;   // seconds before this instance can trigger again
    }
  }
}