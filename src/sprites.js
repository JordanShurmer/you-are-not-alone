// sprites.js — Phase 6: Character roster and animation state machine.
//
// Defines which characters are available (mapped from AutoSprite MCP),
// animation playback speeds per state, and the pure function that derives
// the current animation state from an entity's runtime data.

// ---------------------------------------------------------------------------
// Character roster
// ---------------------------------------------------------------------------

/** Characters downloaded from AutoSprite, in order.  Player IDs cycle through these. */
export const CHARACTERS = ['micah', 'wiz', 'george', 'sam', 'saint', 'titus', 'squire', 'jacque', 'ben', 'bartholemew', 'boniface', 'isaiah'];

// ---------------------------------------------------------------------------
// Visual constants
// ---------------------------------------------------------------------------

/**
 * Uniform scale applied to all character sprites.
 * Sprites are 256×256 px; at 0.3 they display as ~77×77 px,
 * making the visible character (~70 % of frame) roughly 54 px ≈ 1.7 tiles tall.
 */
export const SPRITE_SCALE = 0.3;

// ---------------------------------------------------------------------------
// Animation playback settings
// ---------------------------------------------------------------------------

/**
 * PixiJS animationSpeed for each state.
 * animationSpeed is a fraction of elapsed frames advanced per ticker tick.
 * At 60 fps:  0.15 → ~9 fps animation,  0.3 → ~18 fps,  0.4 → ~24 fps.
 *
 * @type {Record<string, number>}
 */
export const ANIM_SPEED = {
  idle:   0.15,   // slow breathing cycle
  walk:   0.30,   // steady stride
  run:    0.40,   // fast sprint
  attack: 0.32,   // snappy swing (plays once then returns to idle)
  jump:   0.20,   // gentle float
};

/**
 * Animation states that loop seamlessly.
 * Non-looping states (attack, jump) play once then hold the last frame
 * until the state machine selects a new state.
 *
 * @type {Set<string>}
 */
export const LOOPS = new Set(['idle', 'walk', 'run']);

// ---------------------------------------------------------------------------
// Thresholds for animation state transitions
// ---------------------------------------------------------------------------

/** |vx| below this (px/s) → idle (standing still). */
const WALK_THRESHOLD = 15;

/** |vx| at or above this (px/s) → run (fast movement). */
const RUN_THRESHOLD  = 80;

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Map a numeric player ID to a character name.
 * Cycles through CHARACTERS so every player gets a distinct skin up to 4 players,
 * then wraps around if there are more.
 *
 * @param   {number} playerId
 * @returns {string} e.g. 'micah'
 */
export function characterForId(playerId) {
  return CHARACTERS[Math.abs(playerId) % CHARACTERS.length];
}

/**
 * Derive the current animation state purely from an entity's runtime data.
 * Priority order: attack > jump > run > walk > idle.
 *
 * @param   {Object} entity
 * @returns {'idle'|'walk'|'run'|'jump'|'attack'}
 */
export function getAnimState(entity) {
  // Attack takes highest priority (triggered by Phase 8 combat)
  if (entity.attackTimer > 0) return 'attack';

  // Airborne check
  if (!entity.physics?.onGround) return 'jump';

  // Horizontal speed classification
  const speed = Math.abs(entity.velocity?.x ?? 0);
  if (speed < WALK_THRESHOLD) return 'idle';
  if (speed < RUN_THRESHOLD)  return 'walk';
  return 'run';
}