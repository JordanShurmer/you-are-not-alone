// input.js — Keyboard input → action queue bridge (IMGUI-style).
//
// Rather than tracking state-transition events (KEY_DOWN / KEY_UP) and
// accumulating flags on entities, this module owns a single Set of currently
// held directions and exposes one function — sampleInput() — that the game
// loop calls once per frame.
//
// sampleInput() reads the Set *right now*, derives a direction vector, and
// enqueues a MOVE action.  If nothing is held it enqueues {dx:0, dy:0} so
// the entity comes to a stop.  There is never any stale state to clean up:
// the entity only moves when we have positive evidence of a keypress this
// frame.
//
// The focus-loss bug disappears naturally: when the window blurs we clear
// the Set, and the very next sampleInput() call produces a zero-velocity
// MOVE action.  No synthetic KEY_UP events needed.
//
// Action emitted:
//   { type: 'MOVE', entityId: number, dx: -1|0|1, dy: -1|0|1 }

import { enqueueAction } from './actions.js';

// ---------------------------------------------------------------------------
// Internal state — the only state this module holds
// ---------------------------------------------------------------------------

// Canonical direction strings that are currently physically pressed.
// Multiple keys can map to the same direction; the Set deduplicates them.
const _held = new Set();

// ---------------------------------------------------------------------------
// Key → direction mapping
// ---------------------------------------------------------------------------

const KEY_TO_DIRECTION = {
  ArrowUp:    'up',
  ArrowDown:  'down',
  ArrowLeft:  'left',
  ArrowRight: 'right',
  w: 'up',  W: 'up',
  s: 'down', S: 'down',
  a: 'left', A: 'left',
  d: 'right', D: 'right',
};

const PREVENT_DEFAULT_KEYS = new Set(Object.keys(KEY_TO_DIRECTION));

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attach keyboard and blur listeners to the window.
 *
 * Call once during initialisation.  Returns a teardown function for
 * hot-reload / testing.
 *
 * @returns {{ teardown: () => void }}
 */
export function setupInput() {
  function onKeyDown(e) {
    if (PREVENT_DEFAULT_KEYS.has(e.key)) e.preventDefault();
    if (e.repeat) return;
    const dir = KEY_TO_DIRECTION[e.key];
    if (dir) _held.add(dir);
  }

  function onKeyUp(e) {
    if (PREVENT_DEFAULT_KEYS.has(e.key)) e.preventDefault();
    const dir = KEY_TO_DIRECTION[e.key];
    if (dir) _held.delete(dir);
  }

  // When focus is lost the browser never fires keyup for held keys.
  // Clearing the set means the next sampleInput() produces dx:0, dy:0.
  function onBlur() {
    _held.clear();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup',   onKeyUp);
  window.addEventListener('blur',    onBlur);

  return {
    teardown() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup',   onKeyUp);
      window.removeEventListener('blur',    onBlur);
    },
  };
}

/**
 * Sample the current held-key state and enqueue a MOVE action for the given
 * entity.  Call this once per frame at the top of the game loop, before
 * draining the action queue.
 *
 * The emitted action carries a unit direction vector (dx / dy each -1, 0,
 * or 1).  The update system multiplies by speed, so input knows nothing
 * about pixels or frame rate.
 *
 * @param {number} entityId
 */
export function sampleInput(entityId) {
  const dx = (_held.has('right') ? 1 : 0) - (_held.has('left') ? 1 : 0);
  const dy = (_held.has('down')  ? 1 : 0) - (_held.has('up')   ? 1 : 0);

  const action = { type: 'MOVE', entityId, dx, dy };
  enqueueAction(action);
  // Return the action so the caller (main.js) can forward it to the server
  // without needing a separate peek into the queue.
  return action;
}