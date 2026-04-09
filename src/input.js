// input.js — Platformer keyboard input for Phase 3.
//
// Controls:
//   A / D / ← →      move left / right  → MOVE action (dx only)
//   W / ↑ / Space     jump               → JUMP action (one-shot on keydown)
//
// sampleInput() now returns an Array<Object> of actions to send to the
// server.  An empty array means nothing changed this frame.

import { enqueueAction } from './actions.js';

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const _held = new Set();
const _lastMoveByEntity = new Map();

let _pendingJump = false;

// ---------------------------------------------------------------------------
// Key mappings
// ---------------------------------------------------------------------------

const KEY_TO_DIRECTION = {
  ArrowLeft:  'left',
  ArrowRight: 'right',
  a: 'left', A: 'left',
  d: 'right', D: 'right',
};

const JUMP_KEYS = new Set(['ArrowUp', 'w', 'W', ' ']);

const PREVENT_DEFAULT_KEYS = new Set([
  ...Object.keys(KEY_TO_DIRECTION),
  ...JUMP_KEYS,
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attach keyboard and blur listeners to the window.
 * Returns a teardown function for cleanup.
 *
 * @returns {{ teardown: () => void }}
 */
export function setupInput() {
  function onKeyDown(e) {
    if (PREVENT_DEFAULT_KEYS.has(e.key)) e.preventDefault();
    if (e.repeat) return;

    const dir = KEY_TO_DIRECTION[e.key];
    if (dir) _held.add(dir);

    if (JUMP_KEYS.has(e.key)) _pendingJump = true;
  }

  function onKeyUp(e) {
    if (PREVENT_DEFAULT_KEYS.has(e.key)) e.preventDefault();
    const dir = KEY_TO_DIRECTION[e.key];
    if (dir) _held.delete(dir);
  }

  function onBlur() {
    _held.clear();
    // _pendingJump is intentionally NOT cleared — it is consumed in sampleInput.
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
 * Sample current input and return any new actions for this frame.
 *
 * Each action is both enqueued locally (for update.js) and returned so
 * main.js can forward it to the server.
 *
 * @param {number} entityId
 * @returns {Array<Object>}  May be empty.
 */
export function sampleInput(entityId) {
  const result = [];

  // ── Horizontal movement ──────────────────────────────────────────────────
  const dx = (_held.has('right') ? 1 : 0) - (_held.has('left') ? 1 : 0);
  const last = _lastMoveByEntity.get(entityId);

  if (!last || last.dx !== dx) {
    _lastMoveByEntity.set(entityId, { dx });
    const action = { type: 'MOVE', entityId, dx, dy: 0 };
    enqueueAction(action);
    result.push(action);
  }

  // ── Jump (one-shot) ───────────────────────────────────────────────────────
  if (_pendingJump) {
    _pendingJump = false;
    const action = { type: 'JUMP', entityId };
    enqueueAction(action);
    result.push(action);
  }

  return result;
}