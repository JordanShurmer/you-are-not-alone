// update.js — Phase 3: action processing + physics simulation.
//
// New in Phase 3:
//   processActions  — JUMP sets upward velocity when on ground
//                   — MOVE only sets velocity.x (gravity owns velocity.y)
//                   — POSITION snap now also syncs remote velocity
//   update          — applies gravity, then resolves tile collisions via
//                     separate-axis AABB push-out (X first, then Y)

import { entities, getEntity } from './entities.js';
import { isSolid, getTileSize, isWorldLoaded } from './world.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Horizontal movement speed in px/s. */
const PLAYER_SPEED   = 220;

/** Downward acceleration in px/s². */
const GRAVITY        = 1600;

/** Upward velocity on jump in px/s. */
const JUMP_SPEED     = 680;

/** Terminal fall speed in px/s. */
const MAX_FALL_SPEED = 1400;

// ---------------------------------------------------------------------------
// Step 1 — Action processing
// ---------------------------------------------------------------------------

/**
 * Process a batch of actions, mutating the relevant entities' state.
 *
 * @param {Array<Object>} actions
 */
export function processActions(actions) {
  for (const action of actions) {
    switch (action.type) {

      case 'MOVE': {
        const entity = getEntity(action.entityId);
        if (!entity?.velocity) break;
        // dy is ignored — gravity is the sole driver of vertical velocity.
        entity.velocity.x = action.dx * PLAYER_SPEED;
        break;
      }

      case 'JUMP': {
        const entity = getEntity(action.entityId);
        if (!entity?.velocity || !entity?.physics) break;
        if (entity.physics.onGround) {
          entity.velocity.y      = -JUMP_SPEED;
          entity.physics.onGround = false;
        }
        break;
      }

      case 'POSITION': {
        const entity = getEntity(action.entityId);
        if (!entity?.position) break;
        // Only remote players are snapped; we trust our own simulation.
        if (!entity.isLocal) {
          entity.position.x = action.x;
          entity.position.y = action.y;
          // Sync velocity so remote physics stays in step.
          if (entity.velocity && action.vx !== undefined) {
            entity.velocity.x = action.vx;
            entity.velocity.y = action.vy ?? 0;
          }
        }
        break;
      }

      // Unknown action types silently ignored for forward-compatibility.
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
  const safeDt  = Math.min(dt, 0.1);
  const worldOk = isWorldLoaded();

  for (const entity of entities) {
    if (!entity.position || !entity.velocity) continue;

    if (entity.physics && worldOk) {
      // ── Gravity ────────────────────────────────────────────────────────
      entity.velocity.y = Math.min(
        entity.velocity.y + GRAVITY * safeDt,
        MAX_FALL_SPEED,
      );

      // ── X axis: move then resolve ──────────────────────────────────────
      entity.position.x += entity.velocity.x * safeDt;
      if (entity.box) _pushOutX(entity);

      // ── Y axis: move then resolve ──────────────────────────────────────
      entity.position.y += entity.velocity.y * safeDt;
      if (entity.box) _pushOutY(entity);

    } else {
      // No physics: free movement (fallback for entities without physics).
      entity.position.x += entity.velocity.x * safeDt;
      entity.position.y += entity.velocity.y * safeDt;
    }
  }
}

// ---------------------------------------------------------------------------
// Collision resolution — separate-axis minimum-penetration push-out
// ---------------------------------------------------------------------------

/**
 * Push the entity out of any solid tiles along the X axis.
 * Must be called AFTER moving in X, BEFORE moving in Y.
 *
 * @param {Object} entity
 */
function _pushOutX(entity) {
  const { position: pos, velocity: vel, box } = entity;
  const hw = box.width  / 2;
  const hh = box.height / 2;
  const ts = getTileSize();

  const txMin = Math.floor((pos.x - hw)        / ts);
  const txMax = Math.floor((pos.x + hw - 0.01) / ts);
  const tyMin = Math.floor((pos.y - hh)        / ts);
  const tyMax = Math.floor((pos.y + hh - 0.01) / ts);

  for (let ty = tyMin; ty <= tyMax; ty++) {
    for (let tx = txMin; tx <= txMax; tx++) {
      if (!isSolid(tx, ty)) continue;

      const tLeft   = tx * ts;
      const tRight  = tLeft + ts;
      const tTop    = ty * ts;
      const tBottom = tTop  + ts;
      const eLeft   = pos.x - hw;
      const eRight  = pos.x + hw;

      // Full 2-D overlap required (avoids corner ghosts after Y resolve).
      if (eRight  <= tLeft  || eLeft  >= tRight)  continue;
      if (pos.y + hh <= tTop || pos.y - hh >= tBottom) continue;

      const dL = eRight - tLeft;   // penetration depth pushing left
      const dR = tRight - eLeft;   // penetration depth pushing right
      if (dL < dR) {
        pos.x -= dL;
      } else {
        pos.x += dR;
      }
      vel.x = 0;
    }
  }
}

/**
 * Push the entity out of any solid tiles along the Y axis.
 * Must be called AFTER moving in Y.
 * Sets entity.physics.onGround = true when the entity lands on a tile top.
 *
 * @param {Object} entity
 */
function _pushOutY(entity) {
  const { position: pos, velocity: vel, box, physics } = entity;
  const hw = box.width  / 2;
  const hh = box.height / 2;
  const ts = getTileSize();

  physics.onGround = false;

  const txMin = Math.floor((pos.x - hw)        / ts);
  const txMax = Math.floor((pos.x + hw - 0.01) / ts);
  const tyMin = Math.floor((pos.y - hh)        / ts);
  const tyMax = Math.floor((pos.y + hh - 0.01) / ts);

  for (let ty = tyMin; ty <= tyMax; ty++) {
    for (let tx = txMin; tx <= txMax; tx++) {
      if (!isSolid(tx, ty)) continue;

      const tLeft   = tx * ts;
      const tRight  = tLeft + ts;
      const tTop    = ty * ts;
      const tBottom = tTop  + ts;
      const eLeft   = pos.x - hw;
      const eRight  = pos.x + hw;
      const eTop    = pos.y - hh;
      const eBottom = pos.y + hh;

      if (eRight  <= tLeft  || eLeft  >= tRight)  continue;
      if (eBottom <= tTop   || eTop   >= tBottom) continue;

      const dT = eBottom - tTop;     // depth from above  (landing)
      const dB = tBottom - eTop;     // depth from below  (head bump)
      if (dT < dB) {
        pos.y -= dT;
        vel.y  = 0;
        physics.onGround = true;
      } else {
        pos.y += dB;
        if (vel.y < 0) vel.y = 0;
      }
    }
  }
}