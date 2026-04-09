// entities.js — The fat struct entity store.
//
// Every "thing" in the game is a plain object in this array.
// The game loop inspects properties and behaves accordingly:
//   .position   → can be moved / rendered at a location
//   .velocity   → movement is applied each frame
//   .image      → rendered as a colored rectangle
//   .box        → participates in collision detection
//   .inputState → tracks which directional keys are held
//
// Nothing in here knows about PixiJS, networking, or input.
// It's just data.

/** @type {Array<Object>} The single source of truth for all game objects. */
export const entities = [];

let _nextId = 0;

/**
 * Create a new entity and add it to the entity array.
 *
 * @param {Object} props - Initial property bag (fat struct fields).
 * @returns {Object} The newly created entity.
 */
export function createEntity(props = {}) {
  const entity = { id: _nextId++, ...props };
  entities.push(entity);
  return entity;
}

/**
 * Remove an entity from the array by id.
 *
 * @param {number} id
 */
export function destroyEntity(id) {
  const idx = entities.findIndex((e) => e.id === id);
  if (idx !== -1) entities.splice(idx, 1);
}

/**
 * Find an entity by id.  O(n) — fine for Phase 1 entity counts.
 *
 * @param {number} id
 * @returns {Object|undefined}
 */
export function getEntity(id) {
  return entities.find((e) => e.id === id);
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
 *   velocity    — pixels per second, derived from inputState each frame
 *   image       — width / height / color used by the render system
 *   box         — axis-aligned bounding box used for collision (Phase 3+)
 *   inputState  — mutable flags set by the input system
 *
 * @param {number} [x=400]
 * @param {number} [y=300]
 * @returns {Object}
 */
export function createPlayer(x = 400, y = 300) {
  return createEntity({
    isPlayer: true,

    position: { x, y },
    velocity: { x: 0, y: 0 },

    // Visual representation — a solid colored rectangle.
    image: {
      width: 32,
      height: 48,
      color: 0x4a9eff, // bright blue so it pops against the dark void
    },

    // Collision rectangle (aligned to the image, origin at top-left).
    // offsetX/Y are relative to position (which is the centre of the entity).
    box: {
      width: 32,
      height: 48,
      offsetX: 0,
      offsetY: 0,
    },
  });
}