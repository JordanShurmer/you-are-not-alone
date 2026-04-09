// update.js — Phase 3: action processing + physics simulation.
//
// Improvements in this version:
//   - Tighter timestep handling with bounded frame dt + sub-stepping
//   - Shared tile-overlap helpers to remove duplicated collision math
//   - Uses box offsets for collision extents (future-proof for non-centered boxes)

import { entities, getEntity } from './entities.js';
import { isSolid, getTileSize, isWorldLoaded } from './world.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Horizontal movement speed in px/s. */
const PLAYER_SPEED = 220;

/** Downward acceleration in px/s². */
const GRAVITY = 1600;

/** Upward velocity on jump in px/s. */
const JUMP_SPEED = 680;

/** Terminal fall speed in px/s. */
const MAX_FALL_SPEED = 1400;

/** Hard cap for a single frame delta (seconds). */
const MAX_FRAME_DT = 0.1;

/** Maximum sub-step size for physics integration (seconds). */
const MAX_PHYSICS_STEP_DT = 1 / 120;

// ---------------------------------------------------------------------------
// Step 1 — Action processing
// ---------------------------------------------------------------------------

/**
 * Process a batch of actions, mutating entity state.
 *
 * @param {Array<Object>} actions
 */
export function processActions(actions) {
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];

    switch (action.type) {
      case 'MOVE': {
        const entity = getEntity(action.entityId);
        if (!entity?.velocity) break;
        entity.velocity.x = (action.dx ?? 0) * PLAYER_SPEED;
        break;
      }

      case 'JUMP': {
        const entity = getEntity(action.entityId);
        if (!entity?.velocity || !entity?.physics) break;
        if (entity.physics.onGround) {
          entity.velocity.y = -JUMP_SPEED;
          entity.physics.onGround = false;
        }
        break;
      }

      case 'POSITION': {
        const entity = getEntity(action.entityId);
        if (!entity?.position || entity.isLocal) break;

        entity.position.x = action.x;
        entity.position.y = action.y;

        if (entity.velocity) {
          entity.velocity.x = action.vx ?? 0;
          entity.velocity.y = action.vy ?? 0;
        }
        break;
      }

      default:
      // Unknown action types ignored for forward compatibility.
    }
  }
}

// ---------------------------------------------------------------------------
// Step 2 — Simulation advancement
// ---------------------------------------------------------------------------

/**
 * Advance the simulation by `dt` seconds.
 *
 * @param {number} dt
 */
export function update(dt) {
  const frameDt = _clampDt(dt);
  if (frameDt <= 0) return;

  const worldOk = isWorldLoaded();

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (!entity?.position || !entity?.velocity) continue;

    if (entity.physics && worldOk && entity.box) {
      _integratePhysicsEntity(entity, frameDt);
    } else {
      entity.position.x += entity.velocity.x * frameDt;
      entity.position.y += entity.velocity.y * frameDt;
    }
  }
}

function _integratePhysicsEntity(entity, frameDt) {
  const steps = Math.max(1, Math.ceil(frameDt / MAX_PHYSICS_STEP_DT));
  const stepDt = frameDt / steps;

  for (let s = 0; s < steps; s++) {
    // Gravity
    entity.velocity.y = Math.min(entity.velocity.y + GRAVITY * stepDt, MAX_FALL_SPEED);

    // X axis
    entity.position.x += entity.velocity.x * stepDt;
    _resolveCollisionsX(entity);

    // Y axis
    entity.position.y += entity.velocity.y * stepDt;
    _resolveCollisionsY(entity);
  }
}

function _clampDt(dt) {
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  return Math.min(dt, MAX_FRAME_DT);
}

// ---------------------------------------------------------------------------
// Collision helpers
// ---------------------------------------------------------------------------

function _resolveCollisionsX(entity) {
  _forEachOverlappingSolidTile(entity, (tile, edges) => {
    const dL = edges.right - tile.left; // push left
    const dR = tile.right - edges.left; // push right

    if (dL < dR) {
      entity.position.x -= dL;
    } else {
      entity.position.x += dR;
    }
    entity.velocity.x = 0;
  });
}

function _resolveCollisionsY(entity) {
  entity.physics.onGround = false;

  _forEachOverlappingSolidTile(entity, (tile, edges) => {
    const dT = edges.bottom - tile.top; // landing from above
    const dB = tile.bottom - edges.top; // head bump from below

    if (dT < dB) {
      entity.position.y -= dT;
      entity.velocity.y = 0;
      entity.physics.onGround = true;
    } else {
      entity.position.y += dB;
      if (entity.velocity.y < 0) entity.velocity.y = 0;
    }
  });
}

/**
 * Iterate all solid tiles currently overlapping the entity's box.
 *
 * @param {Object} entity
 * @param {(tile:{left:number,right:number,top:number,bottom:number},
 *          edges:{left:number,right:number,top:number,bottom:number}) => void} cb
 */
function _forEachOverlappingSolidTile(entity, cb) {
  const ts = getTileSize();
  const bounds = _getTileBounds(entity, ts);

  for (let ty = bounds.tyMin; ty <= bounds.tyMax; ty++) {
    const tileTop = ty * ts;
    const tileBottom = tileTop + ts;

    for (let tx = bounds.txMin; tx <= bounds.txMax; tx++) {
      if (!isSolid(tx, ty)) continue;

      const tileLeft = tx * ts;
      const tileRight = tileLeft + ts;
      const edges = _getEntityEdges(entity);

      if (edges.right <= tileLeft || edges.left >= tileRight) continue;
      if (edges.bottom <= tileTop || edges.top >= tileBottom) continue;

      cb(
        { left: tileLeft, right: tileRight, top: tileTop, bottom: tileBottom },
        edges,
      );
    }
  }
}

function _getTileBounds(entity, ts) {
  const e = _getEntityEdges(entity);
  return {
    txMin: Math.floor(e.left / ts),
    txMax: Math.floor((e.right - 0.01) / ts),
    tyMin: Math.floor(e.top / ts),
    tyMax: Math.floor((e.bottom - 0.01) / ts),
  };
}

function _getEntityEdges(entity) {
  const { position, box } = entity;
  const hw = box.width / 2;
  const hh = box.height / 2;
  const ox = box.offsetX ?? 0;
  const oy = box.offsetY ?? 0;
  const cx = position.x + ox;
  const cy = position.y + oy;

  return {
    left: cx - hw,
    right: cx + hw,
    top: cy - hh,
    bottom: cy + hh,
  };
}