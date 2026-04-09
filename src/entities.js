// entities.js — The fat-struct entity store.
//
// Every "thing" in the game is a plain object in `entities`.
// This module provides:
//
// - Fast id lookups via an internal Map (O(1) average)
// - Stable array storage for frame-wide iteration
// - Clear lifecycle helpers (create / destroy / clear / query)
//
// Why both array + map?
// - The array is ideal for tight update/render loops.
// - The map avoids repeated O(n) scans for id-based access.

import {
  PLAYER_WIDTH,
  PLAYER_HEIGHT,
  PLAYER_BOX_OFFSET_X,
  PLAYER_BOX_OFFSET_Y,
} from './config.js';

export const entities = [];

/** @type {Map<number, Object>} */
const _entitiesById = new Map();

let _nextId = 0;

/**
 * Create a new entity and register it in both storage structures.
 *
 * @param {Object} [props={}] - Initial property bag (fat struct fields).
 * @returns {Object}
 */
export function createEntity(props = {}) {
  const forcedId = props.id;
  const id = (forcedId !== undefined) ? forcedId : _nextId++;

  if (forcedId !== undefined && forcedId >= _nextId) {
    _nextId = forcedId + 1;
  }

  const entity = { ...props, id };
  entities.push(entity);
  _entitiesById.set(id, entity);
  return entity;
}

/**
 * Destroy an entity by id.
 *
 * @param {number} id
 * @returns {boolean}
 */
export function destroyEntity(id) {
  const entity = _entitiesById.get(id);
  if (!entity) return false;

  _entitiesById.delete(id);

  const idx = entities.indexOf(entity);
  if (idx === -1) return true;

  const lastIdx = entities.length - 1;
  if (idx !== lastIdx) entities[idx] = entities[lastIdx];
  entities.pop();

  return true;
}

/** Remove all entities and reset id allocation. */
export function clearEntities() {
  entities.length = 0;
  _entitiesById.clear();
  _nextId = 0;
}

/**
 * Find an entity by id in O(1) average time.
 *
 * @param {number} id
 * @returns {Object|undefined}
 */
export function getEntity(id) {
  return _entitiesById.get(id);
}

/** @returns {number} Current number of live entities. */
export function entityCount() { return entities.length; }

/** @param {number} id @returns {boolean} */
export function hasEntity(id) { return _entitiesById.has(id); }

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/**
 * Create the local player entity.
 *
 * Fat struct fields:
 *   isPlayer  — flag used by HUD and camera
 *   isLocal   — true only on the machine that owns this player
 *   position  — world-space centre
 *   velocity  — pixels per second
 *   physics   — gravity/collision state (Phase 3+)
 *   image     — width / height / color for the render system
 *   box       — axis-aligned bounding box for collision (Phase 3+)
 *
 * @param {number} [x=400]
 * @param {number} [y=300]
 * @returns {Object}
 */
export function createPlayer(x = 400, y = 300) {
  return createEntity({
    isPlayer: true,
    isLocal:  true,

    position: { x, y },
    velocity: { x: 0, y: 0 },

    // physics — populated by update.js each frame
    physics: { onGround: false },

    image: {
      width: PLAYER_WIDTH,
      height: PLAYER_HEIGHT,
      color: 0x4a9eff,
    },

    box: {
      width: PLAYER_WIDTH,
      height: PLAYER_HEIGHT,
      offsetX: PLAYER_BOX_OFFSET_X,
      offsetY: PLAYER_BOX_OFFSET_Y,
    },
  });
}