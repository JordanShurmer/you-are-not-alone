// world.js — Shared terrain data and tile-query helpers.
//
// The world grid is received once from the server in the WELCOME message and
// is read-only for the duration of Phase 3.  Two systems consume it:
//
//   update.js  — solid-tile collision detection
//   render.js  — visible-region tile drawing; camera world-bounds clamping
//
// No PixiJS or network code lives here — pure data + pure queries.

// ---------------------------------------------------------------------------
// Tile type constants
// ---------------------------------------------------------------------------

export const TILE_AIR   = 0;
export const TILE_DIRT  = 1;
export const TILE_STONE = 2;

/** Packed PixiJS fill colour for each solid tile type. */
export const TILE_COLORS = {
  [TILE_DIRT]:  0x8b5e3c,   // earthy brown
  [TILE_STONE]: 0x667788,   // cool blue-grey
};

/** Lighter highlight colour used for the top edge of each tile. */
export const TILE_HIGHLIGHT = {
  [TILE_DIRT]:  0xa87050,
  [TILE_STONE]: 0x7e95a8,
};

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** @type {Int8Array|null}  Row-major flat tile grid.  Index = ty * width + tx. */
let _tiles    = null;
let _width    = 0;
let _height   = 0;
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
  _width    = data.width;
  _height   = data.height;
  _tileSize = data.tileSize ?? 32;
  _tiles    = new Int8Array(data.tiles);
  _revision++;
}

/** True once setWorldData has been called. */
export function isWorldLoaded() { return _tiles !== null; }

/**
 * Clear all world data and bump revision so caches can invalidate.
 */
export function clearWorldData() {
  _tiles = null;
  _width = 0;
  _height = 0;
  _tileSize = 32;
  _revision++;
}

/** Monotonic world revision, useful for cache invalidation. */
export function getWorldRevision() { return _revision; }

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

// ---------------------------------------------------------------------------
// Tile queries
// ---------------------------------------------------------------------------

/**
 * Return the tile type at tile-space coordinate (tx, ty).
 *
 * Out-of-bounds handling:
 *   left / right edges  → TILE_STONE  (solid side walls)
 *   above the world     → TILE_AIR    (open sky)
 *   below the world     → TILE_STONE  (solid floor)
 *
 * @param {number} tx
 * @param {number} ty
 * @returns {number}
 */
export function getTile(tx, ty) {
  if (tx < 0 || tx >= _width) return TILE_STONE;
  if (ty < 0)                 return TILE_AIR;
  if (ty >= _height)          return TILE_STONE;
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

export function getTileSize()         { return _tileSize; }
export function getWorldTileWidth()   { return _width;    }
export function getWorldTileHeight()  { return _height;   }
export function getWorldPixelWidth()  { return _width  * _tileSize; }
export function getWorldPixelHeight() { return _height * _tileSize; }