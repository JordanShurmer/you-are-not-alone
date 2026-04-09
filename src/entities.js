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
  // Allow callers to pin the entity to a server-assigned id (e.g. for
  // network players whose id must be consistent across all clients).
  const forcedId = props.id;
  const id = (forcedId !== undefined) ? forcedId : _nextId++;

  // Keep _nextId ahead of any forced id so future auto-assigned ids don't
  // collide with server-assigned ones.
  if (forcedId !== undefined && forcedId >= _nextId) {
    _nextId = forcedId + 1;
  }

  // Spread props last so that our resolved `id` always wins.
  const entity = { ...props, id };
  entities.push(entity);
  _entitiesById.set(id, entity);
  return entity;
}

/**
 * Destroy an entity by id.
 *
 * @param {number} id
 * @returns {boolean} true if an entity was removed, false otherwise.
 */
export function destroyEntity(id) {
  const entity = _entitiesById.get(id);
  if (!entity) return false;

  _entitiesById.delete(id);

  const idx = entities.indexOf(entity);
  if (idx === -1) return true;

  // Swap-remove for O(1) deletion (order not guaranteed).
  const lastIdx = entities.length - 1;
  if (idx !== lastIdx) entities[idx] = entities[lastIdx];
  entities.pop();

  return true;
}

/**
 * Remove all entities and reset id allocation.
 * Useful for tests / hard reset.
 */
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

/**
 * @returns {number} Current number of live entities.
 */
export function entityCount() {
  return entities.length;
}

/**
 * Check if an id is currently live.
 *
 * @param {number} id
 * @returns {boolean}
 */
export function hasEntity(id) {
  return _entitiesById.has(id);
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/**
 * Create the local player entity at the given canvas position.
 *
 * Fat struct fields populated:
 *   isPlayer    — flag so other systems can find the player quickly
 *   position    — world-space centre of the entity
 *   velocity    — pixels per second, derived from input each frame
 *   image       — width / height / color used by the render system
 *   box         — axis-aligned bounding box used for collision (Phase 3+)
 *
 * @param {number} [x=400]
 * @param {number} [y=300]
 * @returns {Object}
 */
export function createPlayer(x = 400, y = 300) {
  return createEntity({
    isPlayer: true,
    isLocal: true,

    position: { x, y },
    velocity: { x: 0, y: 0 },

    image: {
      width: 32,
      height: 48,
      color: 0x4a9eff,
    },

    box: {
      width: 32,
      height: 48,
      offsetX: 0,
      offsetY: 0,
    },
  });
}