// network.js — WebSocket client for Phase 2 multiplayer.
//
// Connects to the game server and bridges the two-way message flow:
//
//   Server → Client messages are handled here:
//     WELCOME        Assigns our player ID, color, and starting position.
//                    Also populates entities for all currently-connected players.
//     SPAWN_PLAYER   A new player joined; create their entity.
//     DESPAWN_PLAYER A player left; destroy their entity.
//     MOVE           A remote player's movement action — enqueued directly
//                    into the action queue so it travels the same path as
//                    local keyboard input.
//     POSITION       A remote player's drift-correction snapshot — also
//                    enqueued so update.js can snap their position.
//
//   Client → Server messages are sent via sendAction():
//     MOVE           Emitted every frame by sampleInput() → main.js
//     POSITION       Emitted every ~250 ms by main.js for drift correction.
//
// Auto-reconnects on disconnect.  The entity store is cleared on every
// disconnect so it is cleanly rebuilt from the next WELCOME message.

import { enqueueAction }                          from './actions.js';
import { createEntity, destroyEntity, clearEntities, getEntity } from './entities.js';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** @type {WebSocket|null} */
let _ws = null;

/** @type {number|null}  Server-assigned entity ID for the local player. */
let _localPlayerId = null;

/** @type {boolean} */
let _connected = false;

const RECONNECT_DELAY_MS = 2_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @returns {number|null} The server-assigned entity ID for the local player,
 *   or null if not yet welcomed by the server.
 */
export function getLocalPlayerId() {
  return _localPlayerId;
}

/**
 * @returns {boolean} True when the WebSocket is open and ready to send.
 */
export function isConnected() {
  return _connected;
}

/**
 * Send an action to the server.
 * Safe to call at any time — silently no-ops when not connected.
 *
 * @param {Object} action
 */
export function sendAction(action) {
  if (_connected && _ws && _ws.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify(action));
  }
}

/**
 * Open the WebSocket connection.
 * Automatically reconnects on close or error.
 */
export function setupNetwork() {
  _connect();
}

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
    try {
      msg = JSON.parse(data);
    } catch (e) {
      console.warn('[net] malformed message:', data);
      return;
    }
    _handleMessage(msg);
  };

  _ws.onclose = () => {
    _connected     = false;
    _localPlayerId = null;

    // Wipe the game world.  It will be fully rebuilt from the next WELCOME.
    clearEntities();

    console.log(`[net] disconnected — reconnecting in ${RECONNECT_DELAY_MS} ms`);
    setTimeout(_connect, RECONNECT_DELAY_MS);
  };

  _ws.onerror = (err) => {
    // onclose always fires after onerror; reconnection is handled there.
    console.error('[net] error:', err);
  };
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

/**
 * Dispatch an inbound server message.
 *
 * @param {Object} msg
 */
function _handleMessage(msg) {
  switch (msg.type) {

    case 'WELCOME': {
      _localPlayerId = msg.playerId;

      // Create the local player entity with our server-assigned ID and color.
      _spawnPlayer(msg.playerId, msg.x, msg.y, msg.color, /* isLocal */ true);

      // Create entities for every player already in the game.
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

    // Remote actions enter the action queue — identical treatment to local
    // keyboard input.  update.js handles both without knowing the origin.
    case 'MOVE':
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

/**
 * Convert a CSS hex color string to a packed integer understood by PixiJS.
 *
 * @param {string} hex  e.g. "#4a9eff"
 * @returns {number}    e.g. 0x4a9eff
 */
function _hexToInt(hex) {
  return parseInt(hex.replace('#', ''), 16);
}

/**
 * Create a player entity in the local entity store.
 *
 * All players — local and remote — use the same fat-struct shape so every
 * system (render, update, collision) handles them identically.
 *
 * @param {number}  id
 * @param {number}  x
 * @param {number}  y
 * @param {string}  colorHex  CSS hex string, e.g. "#4a9eff"
 * @param {boolean} isLocal   True only for the player on this machine.
 */
function _spawnPlayer(id, x, y, colorHex, isLocal) {
  const existing = getEntity(id);

  if (existing) {
    existing.isPlayer = true;
    existing.isLocal = isLocal;

    if (!existing.position) existing.position = { x: 0, y: 0 };
    existing.position.x = x;
    existing.position.y = y;

    if (!existing.velocity) existing.velocity = { x: 0, y: 0 };
    existing.velocity.x = 0;
    existing.velocity.y = 0;

    existing.image = {
      width:  32,
      height: 48,
      color:  _hexToInt(colorHex),
    };

    existing.box = {
      width:   32,
      height:  48,
      offsetX: 0,
      offsetY: 0,
    };
    return;
  }

  createEntity({
    id,

    isPlayer: true,
    isLocal,

    position: { x, y },
    velocity: { x: 0, y: 0 },

    image: {
      width:  32,
      height: 48,
      color:  _hexToInt(colorHex),
    },

    box: {
      width:   32,
      height:  48,
      offsetX: 0,
      offsetY: 0,
    },
  });
}
