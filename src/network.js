// network.js — Hardened WebSocket client for Phase 3 multiplayer.
//
// Improvements:
// - Reconnect backoff with jitter
// - Stale-socket guards (ignore events from superseded sockets)
// - Strong inbound message validation + normalization
// - Safer outbound send path validation

import { enqueueAction } from './actions.js';
import { createEntity, destroyEntity, clearEntities, getEntity } from './entities.js';
import { setWorldData, clearWorldData } from './world.js';
import {
  PLAYER_WIDTH,
  PLAYER_HEIGHT,
  PLAYER_BOX_OFFSET_X,
  PLAYER_BOX_OFFSET_Y,
} from './config.js';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** @type {WebSocket|null} */
let _ws = null;

/** @type {number|null} */
let _localPlayerId = null;

/** @type {boolean} */
let _connected = false;

/** Monotonic token to invalidate stale socket callbacks. */
let _socketToken = 0;

/** @type {number|null} */
let _reconnectTimer = null;

let _reconnectAttempts = 0;

// ---------------------------------------------------------------------------
// Reconnect strategy
// ---------------------------------------------------------------------------

const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 10_000;
const RECONNECT_JITTER_RATIO = 0.25;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** @returns {number|null} */
export function getLocalPlayerId() { return _localPlayerId; }

/** @returns {boolean} */
export function isConnected() { return _connected; }

/**
 * Send an action to the server if connected.
 * Returns true when sent, false when dropped.
 *
 * @param {Object} action
 * @returns {boolean}
 */
export function sendAction(action) {
  if (!_isValidOutgoingAction(action)) return false;
  if (!_connected || !_ws || _ws.readyState !== WebSocket.OPEN) return false;

  try {
    _ws.send(JSON.stringify(action));
    return true;
  } catch (err) {
    console.warn('[net] send failed:', err);
    return false;
  }
}

/** Open the WebSocket connection (auto-reconnects). */
export function setupNetwork() {
  // If already open/connecting, do nothing.
  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  // Cancel pending reconnect and connect immediately.
  if (_reconnectTimer !== null) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }

  _connect();
}

// ---------------------------------------------------------------------------
// Internal: connect / lifecycle
// ---------------------------------------------------------------------------

function _connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.hostname}:8080/ws`;

  const ws = new WebSocket(url);
  const token = ++_socketToken;
  _ws = ws;

  ws.onopen = () => {
    if (!_isCurrentSocket(ws, token)) return;

    _connected = true;
    _reconnectAttempts = 0;
    console.log('[net] connected to', url);
  };

  ws.onmessage = ({ data }) => {
    if (!_isCurrentSocket(ws, token)) return;

    const msg = _parseAndNormalizeInbound(data);
    if (!msg) return;
    _handleMessage(msg);
  };

  ws.onerror = (err) => {
    if (!_isCurrentSocket(ws, token)) return;
    console.error('[net] socket error:', err);
  };

  ws.onclose = () => {
    if (!_isCurrentSocket(ws, token)) return;

    _connected = false;
    _localPlayerId = null;
    _ws = null;

    clearEntities();
    clearWorldData();

    const delay = _computeBackoffDelay(++_reconnectAttempts);
    console.log(`[net] disconnected — reconnecting in ${delay} ms`);
    _scheduleReconnect(delay);
  };
}

function _scheduleReconnect(delayMs) {
  if (_reconnectTimer !== null) return;

  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    _connect();
  }, delayMs);
}

function _isCurrentSocket(ws, token) {
  return _ws === ws && _socketToken === token;
}

function _computeBackoffDelay(attempt) {
  const exp = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * (2 ** (attempt - 1)));
  const jitter = exp * RECONNECT_JITTER_RATIO;
  const min = Math.max(0, exp - jitter);
  const max = exp + jitter;
  return Math.round(min + Math.random() * (max - min));
}

// ---------------------------------------------------------------------------
// Internal: message handling
// ---------------------------------------------------------------------------

function _handleMessage(msg) {
  switch (msg.type) {
    case 'WELCOME': {
      clearEntities();
      clearWorldData();

      _localPlayerId = msg.playerId;

      if (msg.world) {
        setWorldData(msg.world);
        console.log(`[net] world loaded: ${msg.world.width}×${msg.world.height} tiles`);
      } else {
        console.warn('[net] welcome message missing world payload');
      }

      _spawnPlayer(msg.playerId, msg.x, msg.y, msg.color, true);

      for (let i = 0; i < msg.players.length; i++) {
        const p = msg.players[i];
        if (p.id === msg.playerId) continue;
        _spawnPlayer(p.id, p.x, p.y, p.color, false);
      }

      console.log(
        `[net] welcomed as player ${msg.playerId}` +
        ` — ${msg.players.length} other(s) present`,
      );
      break;
    }

    case 'SPAWN_PLAYER': {
      _spawnPlayer(msg.playerId, msg.x, msg.y, msg.color, false);
      console.log(`[net] player ${msg.playerId} joined`);
      break;
    }

    case 'DESPAWN_PLAYER': {
      destroyEntity(msg.playerId);
      console.log(`[net] player ${msg.playerId} left`);
      break;
    }

    case 'MOVE':
    case 'JUMP':
    case 'JUMP_RELEASE':
    case 'POSITION':
    case 'BOOST': {
      enqueueAction(msg);
      break;
    }

    default:
      // Should never happen because parser validates type.
      console.warn('[net] unknown message type:', msg.type);
  }
}

// ---------------------------------------------------------------------------
// Internal: inbound validation + normalization
// ---------------------------------------------------------------------------

function _parseAndNormalizeInbound(rawData) {
  if (typeof rawData !== 'string') {
    console.warn('[net] non-text message ignored');
    return null;
  }

  let obj;
  try {
    obj = JSON.parse(rawData);
  } catch {
    console.warn('[net] malformed JSON message ignored');
    return null;
  }

  if (!_isPlainObject(obj) || typeof obj.type !== 'string') {
    console.warn('[net] invalid message envelope ignored');
    return null;
  }

  switch (obj.type) {
    case 'WELCOME':
      return _normalizeWelcome(obj);
    case 'SPAWN_PLAYER':
      return _normalizeSpawn(obj);
    case 'DESPAWN_PLAYER':
      return _normalizeDespawn(obj);
    case 'MOVE':
      return _normalizeMove(obj);
    case 'JUMP':
      return _normalizeJump(obj);
    case 'JUMP_RELEASE':
      return _normalizeJumpRelease(obj);
    case 'BOOST':
      return _normalizeBoost(obj, 'BOOST');
    case 'POSITION':
      return _normalizePosition(obj);
    default:
      console.warn('[net] unknown message type ignored:', obj.type);
      return null;
  }
}

function _normalizeWelcome(m) {
  const playerId = _toInt(m.playerId);
  const x = _toFinite(m.x);
  const y = _toFinite(m.y);
  const color = _toColorHex(m.color);

  if (playerId === null || x === null || y === null || color === null) {
    console.warn('[net] invalid WELCOME fields ignored');
    return null;
  }

  const players = [];
  if (Array.isArray(m.players)) {
    for (let i = 0; i < m.players.length; i++) {
      const p = m.players[i];
      if (!_isPlainObject(p)) continue;

      const id = _toInt(p.id);
      const px = _toFinite(p.x);
      const py = _toFinite(p.y);
      const pColor = _toColorHex(p.color);

      if (id === null || px === null || py === null || pColor === null) continue;
      players.push({ id, x: px, y: py, color: pColor });
    }
  }

  const world = _normalizeWorld(m.world);

  return {
    type: 'WELCOME',
    playerId,
    x,
    y,
    color,
    players,
    world,
  };
}

function _normalizeSpawn(m) {
  const playerId = _toInt(m.playerId);
  const x = _toFinite(m.x);
  const y = _toFinite(m.y);
  const color = _toColorHex(m.color);

  if (playerId === null || x === null || y === null || color === null) {
    console.warn('[net] invalid SPAWN_PLAYER fields ignored');
    return null;
  }

  return { type: 'SPAWN_PLAYER', playerId, x, y, color };
}

function _normalizeDespawn(m) {
  const playerId = _toInt(m.playerId);
  if (playerId === null) {
    console.warn('[net] invalid DESPAWN_PLAYER fields ignored');
    return null;
  }
  return { type: 'DESPAWN_PLAYER', playerId };
}

function _normalizeMove(m) {
  const entityId = _toInt(m.entityId);
  const dx = _toFinite(m.dx);

  if (entityId === null || dx === null) {
    console.warn('[net] invalid MOVE fields ignored');
    return null;
  }

  // Clamp for stability even if server/client sends slightly out of range.
  const clampedDx = Math.max(-1, Math.min(1, dx));
  return { type: 'MOVE', entityId, dx: clampedDx, dy: 0 };
}

function _normalizeJump(m) {
  const entityId = _toInt(m.entityId);
  if (entityId === null) {
    console.warn('[net] invalid JUMP fields ignored');
    return null;
  }
  return { type: 'JUMP', entityId };
}

function _normalizeJumpRelease(m) {
  const entityId = _toInt(m.entityId);
  if (entityId === null) {
    console.warn('[net] invalid JUMP_RELEASE fields ignored');
    return null;
  }
  return { type: 'JUMP_RELEASE', entityId };
}

function _normalizeBoost(m) {
  const entityId = _toInt(m.entityId);
  if (entityId === null) {
    console.warn('[net] invalid BOOST fields ignored');
    return null;
  }
  return { type: 'BOOST', entityId };
}

function _normalizePosition(m) {
  const entityId = _toInt(m.entityId);
  const x = _toFinite(m.x);
  const y = _toFinite(m.y);
  const vx = _toFiniteOr(m.vx, 0);
  const vy = _toFiniteOr(m.vy, 0);

  if (entityId === null || x === null || y === null) {
    console.warn('[net] invalid POSITION fields ignored');
    return null;
  }

  return { type: 'POSITION', entityId, x, y, vx, vy };
}

function _normalizeWorld(world) {
  if (!_isPlainObject(world)) return null;

  const width = _toInt(world.width);
  const height = _toInt(world.height);
  const tileSize = _toInt(world.tileSize);

  if (
    width === null || height === null || tileSize === null ||
    width <= 0 || height <= 0 || tileSize <= 0
  ) {
    return null;
  }

  if (!Array.isArray(world.tiles) || world.tiles.length !== width * height) {
    return null;
  }

  // Keep only supported tile values; coerce unknown values to air.
  const tiles = new Array(world.tiles.length);
  for (let i = 0; i < world.tiles.length; i++) {
    const t = _toInt(world.tiles[i]);
    tiles[i] = (t === 1 || t === 2) ? t : 0;
  }

  return { width, height, tileSize, tiles };
}

// ---------------------------------------------------------------------------
// Internal: outbound validation
// ---------------------------------------------------------------------------

function _isValidOutgoingAction(action) {
  if (!_isPlainObject(action) || typeof action.type !== 'string') return false;

  switch (action.type) {
    case 'MOVE':
      return _toInt(action.entityId) !== null && _toFinite(action.dx) !== null;
    case 'JUMP':
    case 'JUMP_RELEASE':
    case 'BOOST':
      return _toInt(action.entityId) !== null;
    case 'POSITION':
      return (
        _toInt(action.entityId) !== null &&
        _toFinite(action.x) !== null &&
        _toFinite(action.y) !== null
      );
    default:
      // Forward-compatible: allow unknown action types if they at least have type.
      return true;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _hexToInt(hex) {
  if (typeof hex !== 'string') return 0x4a9eff;
  const stripped = hex.startsWith('#') ? hex.slice(1) : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(stripped)) return 0x4a9eff;
  return parseInt(stripped, 16);
}

function _spawnPlayer(id, x, y, colorHex, isLocal) {
  const existing = getEntity(id);
  const color = _hexToInt(colorHex);

  const image = { width: PLAYER_WIDTH, height: PLAYER_HEIGHT, color };
  const box = {
    width: PLAYER_WIDTH,
    height: PLAYER_HEIGHT,
    offsetX: PLAYER_BOX_OFFSET_X,
    offsetY: PLAYER_BOX_OFFSET_Y,
  };

  if (existing) {
    existing.isPlayer = true;
    existing.isLocal = isLocal;

    if (!existing.position) existing.position = { x: 0, y: 0 };
    existing.position.x = x;
    existing.position.y = y;

    if (!existing.velocity) existing.velocity = { x: 0, y: 0 };
    existing.velocity.x = 0;
    existing.velocity.y = 0;

    if (!existing.physics) existing.physics = {};
    existing.physics.onGround = false;
    existing.physics.moveInput = 0;
    existing.physics.jumpBufferTimer = 0;
    existing.physics.coyoteTimer = 0;
    existing.physics.jumpHeld = false;

    existing.physics.boostSpeed = 160;

    existing.image = image;
    existing.box = box;
    return;
  }

  createEntity({
    id,
    isPlayer: true,
    isLocal,
    position: { x, y },
    velocity: { x: 0, y: 0 },
    physics: {
      onGround: false,
      moveInput: 0,
      jumpBufferTimer: 0,
      coyoteTimer: 0,
      jumpHeld: false,

      boostSpeed: 160,
    },
    image,
    box,
  });
}

function _isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function _toInt(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (!Number.isInteger(v)) return null;
  return v;
}

function _toFinite(v) {
  return (typeof v === 'number' && Number.isFinite(v)) ? v : null;
}

function _toFiniteOr(v, fallback) {
  const n = _toFinite(v);
  return n === null ? fallback : n;
}

function _toColorHex(v) {
  if (typeof v !== 'string') return null;
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : null;
}