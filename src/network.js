// network.js — WebSocket client for Phase 3 multiplayer.
//
// Changes from Phase 2:
//   - WELCOME now carries `world` data; we call setWorldData() before
//     spawning any players so collision can work from frame one.
//   - _spawnPlayer gives every player a physics component.
//   - POSITION actions now carry vx/vy which update.js uses to sync
//     remote-player velocity.

import { enqueueAction }                                          from './actions.js';
import { createEntity, destroyEntity, clearEntities, getEntity } from './entities.js';
import { setWorldData }                                           from './world.js';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** @type {WebSocket|null} */
let _ws = null;

/** @type {number|null} */
let _localPlayerId = null;

/** @type {boolean} */
let _connected = false;

const RECONNECT_DELAY_MS = 2_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** @returns {number|null} */
export function getLocalPlayerId() { return _localPlayerId; }

/** @returns {boolean} */
export function isConnected() { return _connected; }

/**
 * Send an action to the server.
 * @param {Object} action
 */
export function sendAction(action) {
  if (_connected && _ws && _ws.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify(action));
  }
}

/** Open the WebSocket connection (auto-reconnects). */
export function setupNetwork() { _connect(); }

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function _connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url      = `${protocol}//${location.hostname}:8080/ws`;

  _ws = new WebSocket(url);

  _ws.onopen = () => {
    _connected = true;
    console.log('[net] connected to', url);
  };

  _ws.onmessage = ({ data }) => {
    let msg;
    try { msg = JSON.parse(data); }
    catch (e) { console.warn('[net] malformed message:', data); return; }
    _handleMessage(msg);
  };

  _ws.onclose = () => {
    _connected     = false;
    _localPlayerId = null;
    clearEntities();
    console.log(`[net] disconnected — reconnecting in ${RECONNECT_DELAY_MS} ms`);
    setTimeout(_connect, RECONNECT_DELAY_MS);
  };

  _ws.onerror = (err) => { console.error('[net] error:', err); };
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

function _handleMessage(msg) {
  switch (msg.type) {

    case 'WELCOME': {
      _localPlayerId = msg.playerId;

      // Load terrain BEFORE spawning players so collision works from frame 1.
      if (msg.world) {
        setWorldData(msg.world);
        console.log(`[net] world loaded: ${msg.world.width}×${msg.world.height} tiles`);
      }

      _spawnPlayer(msg.playerId, msg.x, msg.y, msg.color, /* isLocal */ true);

      for (const p of (msg.players ?? [])) {
        _spawnPlayer(p.id, p.x, p.y, p.color, /* isLocal */ false);
      }

      console.log(
        `[net] welcomed as player ${msg.playerId}` +
        ` — ${msg.players?.length ?? 0} other(s) present`,
      );
      break;
    }

    case 'SPAWN_PLAYER': {
      _spawnPlayer(msg.playerId, msg.x, msg.y, msg.color, /* isLocal */ false);
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
    case 'POSITION': {
      enqueueAction(msg);
      break;
    }

    default:
      console.warn('[net] unknown message type:', msg.type);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _hexToInt(hex) {
  return parseInt(hex.replace('#', ''), 16);
}

/**
 * Create or update a player entity in the local entity store.
 *
 * @param {number}  id
 * @param {number}  x
 * @param {number}  y
 * @param {string}  colorHex  e.g. "#4a9eff"
 * @param {boolean} isLocal
 */
function _spawnPlayer(id, x, y, colorHex, isLocal) {
  const existing = getEntity(id);

  if (existing) {
    existing.isPlayer = true;
    existing.isLocal  = isLocal;

    if (!existing.position) existing.position = { x: 0, y: 0 };
    existing.position.x = x;
    existing.position.y = y;

    if (!existing.velocity) existing.velocity = { x: 0, y: 0 };
    existing.velocity.x = 0;
    existing.velocity.y = 0;

    if (!existing.physics) existing.physics = {};
    existing.physics.onGround = false;

    existing.image = { width: 28, height: 44, color: _hexToInt(colorHex) };
    existing.box   = { width: 28, height: 44, offsetX: 0, offsetY: 0 };
    return;
  }

  createEntity({
    id,
    isPlayer: true,
    isLocal,

    position: { x, y },
    velocity: { x: 0, y: 0 },
    physics:  { onGround: false },

    image: { width: 28, height: 44, color: _hexToInt(colorHex) },
    box:   { width: 28, height: 44, offsetX: 0, offsetY: 0 },
  });
}