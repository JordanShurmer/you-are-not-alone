// world.js — Shared terrain data and tile-query helpers.
//
// The world grid is received once from the server in the WELCOME message and
// is read-only for the duration of Phase 3. Two systems consume it:
//
//   update.js  — solid-tile collision detection
//   render.js  — visible-region tile drawing; camera world-bounds clamping
//
// No PixiJS or network code lives here — pure data + pure queries.

// ---------------------------------------------------------------------------
// Tile type constants
// ---------------------------------------------------------------------------

export const TILE_AIR = 0;
export const TILE_DIRT = 1;
export const TILE_STONE = 2;
export const TILE_SAND = 3;

/** Packed PixiJS fill colour for each solid tile type. */
export const TILE_COLORS = {
  [TILE_DIRT]:  0x8b5e3c,
  [TILE_STONE]: 0x667788,
  [TILE_SAND]:  0xd4aa70,
};

/**
 * Time in seconds to break each tile type with bare hands.
 * @type {Object.<number, number>}
 */
export const TILE_HARDNESS = {
  [TILE_DIRT]:  0.8,
  [TILE_STONE]: 2.4,
  [TILE_SAND]:  0.5,
};

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** @type {Int8Array|null} Row-major flat tile grid. Index = ty * width + tx. */
let _tiles = null;
let _width = 0;
let _height = 0;
let _tileSize = 32;

/** Incremented whenever world data is replaced or cleared. */
let _revision = 0;

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

/**
 * Store world data received from the server.
 * Called by network.js when the WELCOME message arrives.
 *
 * @param {{ width:number, height:number, tileSize:number, tiles:number[] }} data
 */
export function setWorldData(data) {
  _width = data.width;
  _height = data.height;
  _tileSize = data.tileSize ?? 32;
  _tiles = new Int8Array(data.tiles);
  _revision++;
}

/** True once setWorldData has been called. */
export function isWorldLoaded() { return _tiles !== null; }

/** Clear all world data and bump revision so caches can invalidate. */
export function clearWorldData() {
  _tiles = null;
  _width = 0;
  _height = 0;
  _tileSize = 32;
  _revision++;
}

/**
 * Raw accessor used by the render system.
 * @returns {{ tiles: Int8Array|null, width: number, height: number, tileSize: number, revision: number }}
 */
export function getWorldData() {
  return {
    tiles: _tiles,
    width: _width,
    height: _height,
    tileSize: _tileSize,
    revision: _revision,
  };
}

/**
 * Mutate a single tile. Bumps the revision so the renderer invalidates its cache.
 * No-op if coords are out of bounds or world is not loaded.
 *
 * @param {number} tx
 * @param {number} ty
 * @param {number} tileType
 */
export function setTile(tx, ty, tileType) {
  if (!_tiles) return;
  if (tx < 0 || tx >= _width || ty < 0 || ty >= _height) return;
  _tiles[ty * _width + tx] = tileType;
  _revision++;
}

// ---------------------------------------------------------------------------
// Tile queries
// ---------------------------------------------------------------------------

/**
 * Return the tile type at tile-space coordinate (tx, ty).
 *
 * Out-of-bounds handling:
 *   left / right edges  → TILE_STONE (solid side walls)
 *   above the world     → TILE_AIR   (open sky)
 *   below the world     → TILE_STONE (solid floor)
 *
 * @param {number} tx
 * @param {number} ty
 * @returns {number}
 */
export function getTile(tx, ty) {
  if (tx < 0 || tx >= _width) return TILE_STONE;
  if (ty < 0) return TILE_AIR;
  if (ty >= _height) return TILE_STONE;
  return _tiles[ty * _width + tx];
}

/**
 * @param {number} tx
 * @param {number} ty
 * @returns {boolean} True if the tile blocks movement.
 */
export function isSolid(tx, ty) {
  return getTile(tx, ty) !== TILE_AIR;
}

// ---------------------------------------------------------------------------
// World dimension helpers
// ---------------------------------------------------------------------------

export function getTileSize() { return _tileSize; }
export function getWorldTileWidth() { return _width; }
export function getWorldTileHeight() { return _height; }
export function getWorldPixelWidth() { return _width * _tileSize; }
export function getWorldPixelHeight() { return _height * _tileSize; }