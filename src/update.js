// update.js — Action processing and entity state advancement.
//
// Each frame the game loop calls these two functions in order:
//
//   STEP 1 — processActions(actions)
//     Walk the action list and mutate entity state accordingly.
//     Phase 1 action: MOVE — emitted by sampleInput() in input.js.
//     Phase 2 action: POSITION — emitted periodically by remote clients via
//     the server, used to correct accumulated drift in the distributed
//     simulation.  Both local and remote actions enter this function
//     identically; the only distinction is that POSITION snaps are skipped
//     for the local player (we trust our own simulation).
//
//   STEP 2 — update(dt)
//     Walk the entity array and advance the simulation by dt seconds.
//     Currently: apply velocity to position.
//
// Neither step knows anything about PixiJS, the DOM, or the network.

import { entities, getEntity } from './entities.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Player movement speed in pixels per second. */
const PLAYER_SPEED = 220;

// ---------------------------------------------------------------------------
// Step 1 — Action processing
// ---------------------------------------------------------------------------

/**
 * Process a batch of actions, mutating the relevant entities' state.
 *
 * @param {Array<Object>} actions - Actions returned by drainActions().
 */
export function processActions(actions) {
  for (const action of actions) {
    switch (action.type) {

      case 'MOVE': {
        const entity = getEntity(action.entityId);
        if (!entity?.velocity) break;

        // dx / dy are unit direction components (-1, 0, or 1).
        // Scaling here keeps input.js free of simulation constants.
        entity.velocity.x = action.dx * PLAYER_SPEED;
        entity.velocity.y = action.dy * PLAYER_SPEED;
        break;
      }

      case 'POSITION': {
        const entity = getEntity(action.entityId);
        if (!entity?.position) break;

        // Skip the local player — we trust our own simulation and don't
        // want to fight against position corrections sent by ourselves.
        // Remote players get snapped to the authoritative position the
        // sender reported, correcting any drift that built up from
        // simulating their movement locally from MOVE actions.
        if (!entity.isLocal) {
          entity.position.x = action.x;
          entity.position.y = action.y;
        }
        break;
      }

      // Unknown action types are silently ignored so that future action
      // types introduced by the server don't break older clients.
    }
  }
}

// ---------------------------------------------------------------------------
// Step 2 — Simulation advancement
// ---------------------------------------------------------------------------

/**
 * Advance the simulation by `dt` seconds.
 *
 * @param {number} dt - Elapsed time since the last frame, in seconds.
 */
export function update(dt) {
  // Clamp dt so a stall (tab switch, debugger pause) doesn't teleport entities.
  const safeDt = Math.min(dt, 0.1);

  for (const entity of entities) {
    // velocity → position
    if (entity.position && entity.velocity) {
      entity.position.x += entity.velocity.x * safeDt;
      entity.position.y += entity.velocity.y * safeDt;
    }
  }
}