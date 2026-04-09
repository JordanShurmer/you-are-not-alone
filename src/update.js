// update.js — movement + physics simulation.
//
// Goals of this refactor:
//   - Acceleration-based horizontal movement (instead of instant velocity set)
//   - Slower, more deliberate ramp-up for a purposeful feel
//   - Buffered jumps + coyote time for fluid, forgiving platforming
//   - Smooth ground/air transitions while preserving collision correctness

import { entities, getEntity } from './entities.js';
import { isSolid, getTileSize, isWorldLoaded } from './world.js';

// ---------------------------------------------------------------------------
// Tunable movement constants
// ---------------------------------------------------------------------------

/** Max horizontal run speed (px/s). */
const MAX_RUN_SPEED = 250;

/** Ground acceleration toward target speed (px/s²). */
const GROUND_ACCEL = 1100;

/** Ground deceleration when no input (px/s²). */
const GROUND_DECEL = 1500;

/** Air acceleration toward target speed (px/s²). */
const AIR_ACCEL = 700;

/** Air deceleration when no input (px/s²). */
const AIR_DECEL = 420;

/** Extra acceleration when reversing direction for responsive turns. */
const TURN_ACCEL_MULT = 1.25;

/** Downward acceleration in px/s². */
const GRAVITY = 1750;

/** Upward jump impulse in px/s. */
const JUMP_SPEED = 700;

/** Terminal fall speed in px/s. */
const MAX_FALL_SPEED = 1450;

/** Small horizontal damping when landing without input. */
const LANDING_DRAG = 0.82;

/** Jump input can be buffered this long (seconds). */
const JUMP_BUFFER_TIME = 0.12;

/** Allow jump shortly after leaving ground (seconds). */
const COYOTE_TIME = 0.1;

/** Max upward speed retained when jump is released early (px/s). */
const JUMP_CUT_SPEED_CAP = 260;

/** Extra gravity while rising without jump hold (short-hop behavior). */
const LOW_JUMP_GRAVITY_MULT = 2.2;

/** Slightly stronger gravity while falling for snappier arcs. */
const FALL_GRAVITY_MULT = 1.12;

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

        // Acceleration-based movement stores intent instead of applying speed instantly.
        if (entity.physics) {
          _ensurePhysicsState(entity.physics);
          entity.physics.moveInput = _clamp(action.dx ?? 0, -1, 1);
        } else {
          // Fallback for non-physics entities.
          entity.velocity.x = _clamp(action.dx ?? 0, -1, 1) * MAX_RUN_SPEED;
        }
        break;
      }

      case 'JUMP': {
        const entity = getEntity(action.entityId);
        if (!entity?.velocity) break;

        if (entity.physics) {
          _ensurePhysicsState(entity.physics);
          // Buffered jump: consumed when jump is legal (ground/coyote).
          entity.physics.jumpBufferTimer = JUMP_BUFFER_TIME;
          entity.physics.jumpHeld = true;
        } else if (entity.physics?.onGround) {
          entity.velocity.y = -JUMP_SPEED;
          entity.physics.onGround = false;
        }
        break;
      }

      case 'JUMP_RELEASE': {
        const entity = getEntity(action.entityId);
        if (!entity?.velocity || !entity.physics) break;

        _ensurePhysicsState(entity.physics);
        entity.physics.jumpHeld = false;

        // Jump cut: tapping jump yields a lower apex.
        if (entity.velocity.y < -JUMP_CUT_SPEED_CAP) {
          entity.velocity.y = -JUMP_CUT_SPEED_CAP;
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
  const physics = entity.physics;
  _ensurePhysicsState(physics);

  const steps = Math.max(1, Math.ceil(frameDt / MAX_PHYSICS_STEP_DT));
  const stepDt = frameDt / steps;

  for (let s = 0; s < steps; s++) {
    // Timers and grace windows.
    physics.jumpBufferTimer = Math.max(0, physics.jumpBufferTimer - stepDt);
    physics.coyoteTimer = physics.onGround
      ? COYOTE_TIME
      : Math.max(0, physics.coyoteTimer - stepDt);

    // Horizontal intent -> velocity with acceleration smoothing.
    _applyHorizontalMovement(entity, stepDt);

    // Buffered jump + coyote jump.
    const canJump = physics.onGround || physics.coyoteTimer > 0;
    if (physics.jumpBufferTimer > 0 && canJump) {
      entity.velocity.y = -JUMP_SPEED;
      physics.onGround = false;
      physics.coyoteTimer = 0;
      physics.jumpBufferTimer = 0;
    }

    // Hold-aware gravity for variable jump height.
    const gravityMult = _computeGravityMultiplier(entity);
    entity.velocity.y = Math.min(
      entity.velocity.y + GRAVITY * gravityMult * stepDt,
      MAX_FALL_SPEED,
    );

    // X axis.
    entity.position.x += entity.velocity.x * stepDt;
    _resolveCollisionsX(entity);

    // Y axis.
    const wasOnGround = physics.onGround;
    entity.position.y += entity.velocity.y * stepDt;
    _resolveCollisionsY(entity);

    // Subtle landing damping for smoother state transitions.
    if (!wasOnGround && physics.onGround && Math.abs(physics.moveInput) < 0.01) {
      entity.velocity.x *= LANDING_DRAG;
    }
  }
}

function _applyHorizontalMovement(entity, dt) {
  const { velocity, physics } = entity;

  const input = physics.moveInput;
  const target = input * MAX_RUN_SPEED;
  const grounded = physics.onGround;

  let accel;
  if (input !== 0) {
    accel = grounded ? GROUND_ACCEL : AIR_ACCEL;
  } else {
    accel = grounded ? GROUND_DECEL : AIR_DECEL;
  }

  // Slightly stronger accel when reversing for tighter control.
  if (input !== 0 && Math.sign(target) !== Math.sign(velocity.x) && velocity.x !== 0) {
    accel *= TURN_ACCEL_MULT;
  }

  velocity.x = _approach(velocity.x, target, accel * dt);
}

function _computeGravityMultiplier(entity) {
  const { velocity, physics } = entity;

  // Rising + jump released => short hop.
  if (velocity.y < 0 && !physics.jumpHeld) return LOW_JUMP_GRAVITY_MULT;

  // Slightly stronger fall keeps jump/fall cadence punchy.
  if (velocity.y > 0) return FALL_GRAVITY_MULT;

  return 1;
}

function _ensurePhysicsState(physics) {
  if (typeof physics.onGround !== 'boolean') physics.onGround = false;
  if (typeof physics.moveInput !== 'number') physics.moveInput = 0;
  if (typeof physics.jumpBufferTimer !== 'number') physics.jumpBufferTimer = 0;
  if (typeof physics.coyoteTimer !== 'number') physics.coyoteTimer = 0;
  if (typeof physics.jumpHeld !== 'boolean') physics.jumpHeld = false;
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

function _approach(current, target, maxDelta) {
  if (current < target) return Math.min(current + maxDelta, target);
  if (current > target) return Math.max(current - maxDelta, target);
  return target;
}

function _clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}