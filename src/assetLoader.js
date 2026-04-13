// assetLoader.js — Phase 6: Load AutoSprite spritesheet assets into PixiJS.
//
// AutoSprite atlas JSON format (custom, not TexturePacker):
//   {
//     "frames": {
//       "0": { "x": 0,   "y": 0,   "w": 256, "h": 256, "duration": 1 },
//       "1": { "x": 256, "y": 0,   "w": 256, "h": 256, "duration": 1 },
//       ...
//     },
//     "meta": {
//       "size": { "w": 1024, "h": 1024 },
//       "frame_size": { "w": 256, "h": 256 }
//     }
//   }
//
// Usage:
//   1. await preloadAllCharacters()  — call once before starting the game loop
//   2. getFrames('micah', 'walk')    — synchronous, returns PIXI.Texture[]
//
// Assets live at:  assets/sprites/<characterName>/<kind>.{png,json}

import { CHARACTERS } from './sprites.js';

// ---------------------------------------------------------------------------
// Internal cache
// ---------------------------------------------------------------------------

/**
 * Resolved animation frames keyed by "characterName/kind".
 * @type {Map<string, PIXI.Texture[]>}
 */
const _cache = new Map();

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Animation kinds we preload for every character. */
export const ANIM_KINDS = ['idle', 'walk', 'run', 'attack', 'jump'];

// Character roster is sourced from sprites.js to keep a single canonical list.

// ---------------------------------------------------------------------------
// Core loading
// ---------------------------------------------------------------------------

/**
 * Load and cache animation frames for one character + kind pair.
 * Returns the cached array on subsequent calls — never re-fetches.
 *
 * @param {string} characterName  e.g. 'micah'
 * @param {string} kind           e.g. 'idle' | 'walk' | 'run' | 'attack' | 'jump'
 * @returns {Promise<PIXI.Texture[]>}
 */
export async function loadAnimation(characterName, kind) {
  const cacheKey = `${characterName}/${kind}`;
  if (_cache.has(cacheKey)) return _cache.get(cacheKey);

  const pngPath  = `assets/sprites/${characterName}/${kind}.png`;
  const jsonPath = `assets/sprites/${characterName}/${kind}.json`;

  // Fetch the atlas descriptor and the base texture in parallel.
  const [atlas, sheetTex] = await Promise.all([
    fetch(jsonPath).then((r) => {
      if (!r.ok) throw new Error(`[AssetLoader] Failed to fetch ${jsonPath}: ${r.status}`);
      return r.json();
    }),
    PIXI.Assets.load(pngPath),
  ]);

  // PIXI.Assets.load() returns a PIXI.Texture for images.
  // We need the underlying BaseTexture to construct sub-region textures.
  const baseTex = (sheetTex instanceof PIXI.BaseTexture)
    ? sheetTex
    : sheetTex.baseTexture;

  if (!baseTex) {
    throw new Error(`[AssetLoader] Could not get BaseTexture for ${pngPath}`);
  }

  // Build frame array sorted by numeric index (0, 1, 2, …).
  const sorted = Object.keys(atlas.frames)
    .sort((a, b) => Number(a) - Number(b));

  const frames = sorted.map((k) => {
    const f = atlas.frames[k];
    return new PIXI.Texture(baseTex, new PIXI.Rectangle(f.x, f.y, f.w, f.h));
  });

  if (frames.length === 0) {
    console.warn(`[AssetLoader] Zero frames parsed for ${cacheKey}`);
  }

  _cache.set(cacheKey, frames);
  return frames;
}

// ---------------------------------------------------------------------------
// Synchronous accessor (after preload)
// ---------------------------------------------------------------------------

/**
 * Return cached frames synchronously.
 * Returns null if the animation has not been preloaded yet — this should not
 * happen in normal gameplay after preloadAllCharacters() has resolved.
 *
 * @param {string} characterName
 * @param {string} kind
 * @returns {PIXI.Texture[]|null}
 */
export function getFrames(characterName, kind) {
  return _cache.get(`${characterName}/${kind}`) ?? null;
}

// ---------------------------------------------------------------------------
// Batch preloaders
// ---------------------------------------------------------------------------

/**
 * Preload all five animation kinds for a single character.
 *
 * @param {string} characterName
 * @returns {Promise<void>}
 */
export async function preloadCharacter(characterName) {
  await Promise.all(
    ANIM_KINDS.map((kind) => loadAnimation(characterName, kind)),
  );
}

/**
 * Preload every character in the roster.
 * Await this once at boot before starting the PixiJS Ticker.
 *
 * @returns {Promise<void>}
 */
export async function preloadAllCharacters() {
  await Promise.all(CHARACTERS.map(preloadCharacter));
  console.log(`[AssetLoader] All ${CHARACTERS.length} characters loaded (${CHARACTERS.join(', ')})`);
}