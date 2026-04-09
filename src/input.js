// input.js — Platformer keyboard input for Phase 3+.
//
// Controls:
//   A / D / ← →   move left / right         → MOVE action (dx only)
//   W / ↑          jump press                → JUMP action (one-shot on keydown)
//   W / ↑ up       jump release              → JUMP_RELEASE action (one-shot on keyup)
//   Space          boost (heelies push)      → BOOST_START on press, BOOST_END on release
//                  hold for speed burst, release to glide
//
// sampleInput() returns an Array<Object> of actions to send to the server.
// An empty array means nothing changed this frame.
//
// Jump press + jump release are both emitted so update.js can implement
// variable jump height (tap for short hop, hold for full jump).

import { enqueueAction } from './actions.js';

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const _held = new Set();
const _lastMoveByEntity = new Map();

/** Whether any jump key is currently held down. */
let _jumpHeld = false;

/** Ordered jump edge events captured between frames: 'press' | 'release'. */
const _pendingJumpEvents = [];

/** Whether the boost key is currently held down. */
let _boostHeld = false;

/** Ordered boost edge events captured between frames: 'press' | 'release'. */
const _pendingBoostEvents = [];

// ---------------------------------------------------------------------------
// Key mappings
// ---------------------------------------------------------------------------

const KEY_TO_DIRECTION = {
  ArrowLeft:  'left',
  ArrowRight: 'right',
  a: 'left', A: 'left',
  d: 'right', D: 'right',
};

const JUMP_KEYS = new Set(['ArrowUp', 'w', 'W']);

const BOOST_KEYS = new Set([' ']);

const PREVENT_DEFAULT_KEYS = new Set([
  ...Object.keys(KEY_TO_DIRECTION),
  ...JUMP_KEYS,
  ...BOOST_KEYS,
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attach keyboard and blur listeners to window.
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

    if (JUMP_KEYS.has(e.key) && !_jumpHeld) {
      _jumpHeld = true;
      _pendingJumpEvents.push('press');
    }

    if (BOOST_KEYS.has(e.key) && !_boostHeld) {
      _boostHeld = true;
      _pendingBoostEvents.push('press');
    }
  }

  function onKeyUp(e) {
    if (PREVENT_DEFAULT_KEYS.has(e.key)) e.preventDefault();

    const dir = KEY_TO_DIRECTION[e.key];
    if (dir) _held.delete(dir);

    if (JUMP_KEYS.has(e.key) && _jumpHeld) {
      _jumpHeld = false;
      _pendingJumpEvents.push('release');
    }

    if (BOOST_KEYS.has(e.key) && _boostHeld) {
      _boostHeld = false;
      _pendingBoostEvents.push('release');
    }
  }

  function onBlur() {
    _held.clear();

    // If the window loses focus while jump is held, force a release edge
    // so jump-hold behavior cannot get stuck.
    if (_jumpHeld) {
      _jumpHeld = false;
      _pendingJumpEvents.push('release');
    }

    // Same for boost — prevent stuck boost state on focus loss.
    if (_boostHeld) {
      _boostHeld = false;
      _pendingBoostEvents.push('release');
    }
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return {
    teardown() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
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
 * @returns {Array<Object>} May be empty.
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

  // ── Jump edge events (press/release) ─────────────────────────────────────
  for (let i = 0; i < _pendingJumpEvents.length; i++) {
    const edge = _pendingJumpEvents[i];
    const action = (edge === 'press')
      ? { type: 'JUMP', entityId }
      : { type: 'JUMP_RELEASE', entityId };

    enqueueAction(action);
    result.push(action);
  }
  _pendingJumpEvents.length = 0;

  // ── Boost edge events (press/release) ────────────────────────────────────
  for (let i = 0; i < _pendingBoostEvents.length; i++) {
    const edge = _pendingBoostEvents[i];
    const action = (edge === 'press')
      ? { type: 'BOOST_START', entityId }
      : { type: 'BOOST_END', entityId };

    enqueueAction(action);
    result.push(action);
  }
  _pendingBoostEvents.length = 0;

  return result;
}