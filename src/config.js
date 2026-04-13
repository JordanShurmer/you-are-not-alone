// Shared game configuration constants.

// Canvas / viewport — always matches the live browser window so the game
// fills the full page without rescaling (same world-space pixel density,
// just more world visible).
export function getCanvasWidth()  { return window.innerWidth;  }
export function getCanvasHeight() { return window.innerHeight; }
export const BG_COLOR = 0xdedad4;

// Player dimensions (visual + collision box for Phase 3)
export const PLAYER_WIDTH = 18;
export const PLAYER_HEIGHT = 28;
export const PLAYER_BOX_OFFSET_X = 0;
export const PLAYER_BOX_OFFSET_Y = 0;

// Phase 4 — lighting
/** Radius in world-space pixels of each player's carried light source. */
export const LIGHT_RADIUS = 1800;

// Phase 5 — Block interaction
/** World-space pixel radius within which a player can mine/place. */
export const MINING_RANGE_PX = 192;
/** Number of hotbar slots. */
export const HOTBAR_SLOTS = 5;
