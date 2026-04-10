/**
 * Shared game configuration constants.
 *
 * Centralizing these values avoids duplication across modules and keeps
 * rendering, physics, networking spawn logic, and collision dimensions aligned.
 */

// Canvas / viewport
export const CANVAS_WIDTH = 900;
export const CANVAS_HEIGHT = 600;
export const BG_COLOR = 0x0d0d1a;

// Player dimensions (visual + collision box for Phase 3)
export const PLAYER_WIDTH = 18;
export const PLAYER_HEIGHT = 28;
export const PLAYER_BOX_OFFSET_X = 0;
export const PLAYER_BOX_OFFSET_Y = 0;

// Useful derived values
export const PLAYER_HALF_WIDTH = PLAYER_WIDTH / 2;
export const PLAYER_HALF_HEIGHT = PLAYER_HEIGHT / 2;