// input.js — Platformer keyboard + mouse input for Phase 5.
//
// Controls:
//   A / D / ← →   move left / right         → MOVE action (dx only)
//   W / ↑          jump press                → JUMP action (one-shot on keydown)
//   W / ↑ up       jump release              → JUMP_RELEASE action (one-shot on keyup)
//   Space          boost (heelies push)      → BOOST action (one-shot on keydown only)
//   1-5            select hotbar slot
//   Left click     mine tile (hold to break)
//   Right click    place tile from inventory

import { enqueueAction } from './actions.js';
import { getCameraPosition } from './camera.js';
import { getTileSize, getTile, TILE_AIR, TILE_HARDNESS } from './world.js';
import { getEntity } from './entities.js';
import { MINING_RANGE_PX, getCanvasWidth, getCanvasHeight } from './config.js';
import {
  getSelectedItem,
  consumeSelected,
  getSelectedSlot,
  setSelectedSlot,
  HOTBAR_SLOTS,
} from './inventory.js';

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const _held = new Set();
const _lastMoveByEntity = new Map();

/** Whether any jump key is currently held down. */
let _jumpHeld = false;

/** Ordered jump edge events captured between frames: 'press' | 'release'. */
const _pendingJumpEvents = [];

/** Whether a boost was pressed since the last sampleInput call. */
let _pendingBoost = false;

/** Canvas element reference (set in setupInput). */
let _canvas = null;

/** Current mouse position in screen (canvas) coordinates. */
let _mouseX = 0;
let _mouseY = 0;

/** True while left mouse button is held. */
let _leftDown = false;

/** True if right mouse was pressed since last sampleInput call. */
let _rightPending = false;

/** Currently targeted tile for mining { tx, ty } or null. */
let _miningTarget = null;

/** Accumulated mining progress in seconds. */
let _miningProgress = 0;

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
 * Attach keyboard, mouse, and blur listeners to window.
 * Returns a teardown function for cleanup.
 *
 * @returns {{ teardown: () => void }}
 */
export function setupInput() {
  // Store canvas reference for coordinate conversion
  _canvas = document.querySelector('#game-container canvas');

  function onKeyDown(e) {
    if (PREVENT_DEFAULT_KEYS.has(e.key)) e.preventDefault();
    if (e.repeat) return;

    const dir = KEY_TO_DIRECTION[e.key];
    if (dir) _held.add(dir);

    if (JUMP_KEYS.has(e.key) && !_jumpHeld) {
      _jumpHeld = true;
      _pendingJumpEvents.push('press');
    }

    if (BOOST_KEYS.has(e.key)) {
      // One-shot — just flag it; sampleInput will emit the action.
      _pendingBoost = true;
    }

    // Hotbar slot selection via number keys 1-5
    const slotKey = parseInt(e.key, 10);
    if (slotKey >= 1 && slotKey <= HOTBAR_SLOTS) {
      setSelectedSlot(slotKey - 1);
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

    // No BOOST_END — boost is a fire-and-forget impulse.
  }

  function onBlur() {
    _held.clear();

    // If the window loses focus while jump is held, force a release edge
    // so jump-hold behavior cannot get stuck.
    if (_jumpHeld) {
      _jumpHeld = false;
      _pendingJumpEvents.push('release');
    }

    // Reset mouse state on focus loss
    _leftDown = false;
    _rightPending = false;
    _miningTarget = null;
    _miningProgress = 0;
  }

  function onMouseMove(e) {
    if (!_canvas) return;
    const rect = _canvas.getBoundingClientRect();
    // Use logical (CSS) game dimensions so coords match world-space pixels
    // regardless of devicePixelRatio / autoDensity scaling.
    const scaleX = getCanvasWidth()  / rect.width;
    const scaleY = getCanvasHeight() / rect.height;
    _mouseX = (e.clientX - rect.left) * scaleX;
    _mouseY = (e.clientY - rect.top)  * scaleY;
  }

  function onMouseDown(e) {
    if (!_canvas) return;
    const rect = _canvas.getBoundingClientRect();
    const scaleX = getCanvasWidth()  / rect.width;
    const scaleY = getCanvasHeight() / rect.height;
    _mouseX = (e.clientX - rect.left) * scaleX;
    _mouseY = (e.clientY - rect.top)  * scaleY;

    if (e.button === 0) {
      _leftDown = true;
      // Reset mining if target changes
      _miningTarget = null;
      _miningProgress = 0;
    }
    if (e.button === 2) {
      _rightPending = true;
    }
  }

  function onMouseUp(e) {
    if (e.button === 0) {
      _leftDown = false;
      _miningTarget = null;
      _miningProgress = 0;
    }
  }

  function onContextMenu(e) {
    e.preventDefault();
  }

  window.addEventListener('keydown',     onKeyDown);
  window.addEventListener('keyup',       onKeyUp);
  window.addEventListener('blur',        onBlur);
  window.addEventListener('mousemove',   onMouseMove);
  window.addEventListener('mousedown',   onMouseDown);
  window.addEventListener('mouseup',     onMouseUp);
  window.addEventListener('contextmenu', onContextMenu);

  return {
    teardown() {
      window.removeEventListener('keydown',     onKeyDown);
      window.removeEventListener('keyup',       onKeyUp);
      window.removeEventListener('blur',        onBlur);
      window.removeEventListener('mousemove',   onMouseMove);
      window.removeEventListener('mousedown',   onMouseDown);
      window.removeEventListener('mouseup',     onMouseUp);
      window.removeEventListener('contextmenu', onContextMenu);
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
 * @param {number} [dt=0]  Frame delta time in seconds.
 * @returns {Array<Object>} May be empty.
 */
export function sampleInput(entityId, dt = 0) {
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

  // ── Boost one-shot ───────────────────────────────────────────────────────
  if (_pendingBoost) {
    _pendingBoost = false;
    const action = { type: 'BOOST', entityId };
    enqueueAction(action);
    result.push(action);
  }

  // ── Mouse: mining (left-click hold) and placing (right-click) ────────────

  const entity = getEntity(entityId);
  const cam    = getCameraPosition();
  const ts     = getTileSize();

  // World-space cursor position
  const worldMouseX = _mouseX + cam.x;
  const worldMouseY = _mouseY + cam.y;

  // Tile under cursor
  const cursorTX = Math.floor(worldMouseX / ts);
  const cursorTY = Math.floor(worldMouseY / ts);

  // Player center in world space (entity.position is center)
  const playerX = entity?.position?.x ?? 0;
  const playerY = entity?.position?.y ?? 0;

  // Tile center
  const tileCX = (cursorTX + 0.5) * ts;
  const tileCY = (cursorTY + 0.5) * ts;
  const distToTile = Math.hypot(playerX - tileCX, playerY - tileCY);
  const inRange = distToTile <= MINING_RANGE_PX;

  // ── Left-click: mine ─────────────────────────────────────────────────────
  if (_leftDown && inRange && entity) {
    const tileType = getTile(cursorTX, cursorTY);

    if (tileType !== TILE_AIR) {
      // If target changed, reset progress
      if (!_miningTarget || _miningTarget.tx !== cursorTX || _miningTarget.ty !== cursorTY) {
        _miningTarget   = { tx: cursorTX, ty: cursorTY };
        _miningProgress = 0;
      }

      _miningProgress += dt;
      const hardness = TILE_HARDNESS[tileType] ?? 1.0;

      if (_miningProgress >= hardness) {
        // Tile is fully mined — emit action
        _miningProgress = 0;
        _miningTarget   = null;
        const action = { type: 'BREAK_TILE', entityId, tx: cursorTX, ty: cursorTY };
        enqueueAction(action);
        result.push(action);
      }
    } else {
      // Clicked on air — reset
      _miningTarget   = null;
      _miningProgress = 0;
    }
  } else if (!_leftDown) {
    _miningTarget   = null;
    _miningProgress = 0;
  }

  // ── Right-click: place block ─────────────────────────────────────────────
  if (_rightPending) {
    _rightPending = false;

    if (inRange && entity) {
      const tileType = getTile(cursorTX, cursorTY);
      if (tileType === TILE_AIR) {
        const item = getSelectedItem();
        if (item) {
          const placed = consumeSelected(); // consume from inventory first
          if (placed !== null) {
            const action = {
              type: 'PLACE_TILE',
              entityId,
              tx: cursorTX,
              ty: cursorTY,
              tileType: placed,
            };
            enqueueAction(action);
            result.push(action);
          }
        }
      }
    }
  }

  return result;
}

/**
 * Returns the current mining state for visual feedback.
 * @returns {{ tx: number, ty: number, progress: number, hardness: number }|null}
 */
export function getMiningState() {
  if (!_miningTarget) return null;
  const tileType = getTile(_miningTarget.tx, _miningTarget.ty);
  const hardness = TILE_HARDNESS[tileType] ?? 1.0;
  return {
    tx:       _miningTarget.tx,
    ty:       _miningTarget.ty,
    progress: _miningProgress,
    hardness,
  };
}