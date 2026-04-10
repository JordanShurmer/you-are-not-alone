// entities.js — Minimal entity store used by update/render/network.

export const entities = [];

/** @type {Map<number, Object>} */
const entitiesById = new Map();

let nextId = 0;

/**
 * Create and register an entity.
 * If `props.id` is provided, that id is used.
 *
 * @param {Object} [props={}]
 * @returns {Object}
 */
export function createEntity(props = {}) {
  const forcedId = props.id;
  const id = Number.isInteger(forcedId) ? forcedId : nextId++;

  if (Number.isInteger(forcedId) && forcedId >= nextId) {
    nextId = forcedId + 1;
  }

  const entity = { ...props, id };
  entities.push(entity);
  entitiesById.set(id, entity);
  return entity;
}

/**
 * Remove an entity by id.
 *
 * @param {number} id
 * @returns {boolean}
 */
export function destroyEntity(id) {
  const entity = entitiesById.get(id);
  if (!entity) return false;

  entitiesById.delete(id);

  const i = entities.indexOf(entity);
  if (i !== -1) {
    const last = entities.length - 1;
    if (i !== last) entities[i] = entities[last];
    entities.pop();
  }

  return true;
}

/** Remove all entities and reset id allocation. */
export function clearEntities() {
  entities.length = 0;
  entitiesById.clear();
  nextId = 0;
}

/**
 * Lookup by id.
 *
 * @param {number} id
 * @returns {Object|undefined}
 */
export function getEntity(id) {
  return entitiesById.get(id);
}