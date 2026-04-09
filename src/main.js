// main.js — Entry point for Phase 2: You Are Not Alone.
//
// Boot sequence:
//   1) Create the PixiJS app
//   2) Build world + HUD layers
//   3) Attach keyboard listeners (input.js)
//   4) Connect to the WebSocket server (network.js)
//      — the server assigns our player ID, color, and starting position
//      — entities are created once WELCOME arrives; the loop runs fine
//        with an empty world until then
//   5) Run the game loop:
//        • sample local keyboard → enqueue MOVE → forward to server
//        • every ~250 ms send a POSITION sync for drift correction
//        • drain action queue → processActions → update → render

import { entities, getEntity }                      from './entities.js';
import { drainActions }                              from './actions.js';
import { setupInput, sampleInput }                  from './input.js';
import { processActions, update }                   from './update.js';
import { render }                                   from './render.js';
import { setupNetwork, getLocalPlayerId, sendAction } from './network.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CANVAS_WIDTH  = 900;
const CANVAS_HEIGHT = 600;
const BG_COLOR      = 0x0d0d1a;

/** How often (in seconds) to broadcast our position for remote drift correction. */
const POSITION_SYNC_INTERVAL = 0.25;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(function boot() {
  const app = createApp();
  const { worldLayer, hudLayer } = createLayers(app.stage);

  setupInput();
  setupNetwork();

  const { statusText } = buildHud(hudLayer);

  let lastTimestamp = performance.now();
  let syncTimer     = 0;

  app.ticker.add(() => {
    const now = performance.now();
    const dt  = (now - lastTimestamp) / 1000;
    lastTimestamp = now;

    const localId = getLocalPlayerId();

    if (localId !== null) {
      // ── Local input ──────────────────────────────────────────────────────
      // sampleInput returns null when direction is unchanged. In that case
      // we skip the network send to avoid redundant MOVE traffic.
      const moveAction = sampleInput(localId);
      if (moveAction) {
        sendAction(moveAction);
      }

      // ── Periodic position broadcast ──────────────────────────────────────
      // Clients simulate all players locally from MOVE actions.  Over time
      // floating-point accumulation and timing jitter cause drift.  Every
      // POSITION_SYNC_INTERVAL seconds we broadcast our actual position so
      // other clients can snap their copy of us back in line.
      syncTimer += dt;
      if (syncTimer >= POSITION_SYNC_INTERVAL) {
        syncTimer = 0;
        const player = getEntity(localId);
        if (player) {
          sendAction({
            type:     'POSITION',
            entityId: localId,
            x:        player.position.x,
            y:        player.position.y,
          });
        }
      }
    }

    // ── Core loop ────────────────────────────────────────────────────────
    const actions = drainActions();
    processActions(actions);
    update(dt);
    render(worldLayer, entities);

    // ── HUD status ───────────────────────────────────────────────────────
    updateStatus(statusText, localId);
  });
})();

// ---------------------------------------------------------------------------
// PixiJS setup helpers
// ---------------------------------------------------------------------------

function createApp() {
  const app = new PIXI.Application({
    width:           CANVAS_WIDTH,
    height:          CANVAS_HEIGHT,
    backgroundColor: BG_COLOR,
    antialias:       true,
    resolution:      window.devicePixelRatio || 1,
    autoDensity:     true,
  });

  document.getElementById('game-container').appendChild(app.view);
  return app;
}

function createLayers(stage) {
  const worldLayer = new PIXI.Container();
  const hudLayer   = new PIXI.Container();

  stage.addChild(worldLayer);
  stage.addChild(hudLayer); // always rendered above the world

  return { worldLayer, hudLayer };
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

/**
 * Build the static and dynamic HUD elements, add them to the provided
 * container, and return references to the pieces that need per-frame updates.
 *
 * @param {PIXI.Container} hudLayer
 * @returns {{ statusText: PIXI.Text }}
 */
function buildHud(hudLayer) {
  const textStyle = (size, color, spacing = 1) => ({
    fontFamily:    'monospace',
    fontSize:      size,
    fill:          color,
    letterSpacing: spacing,
  });

  // ── Title (top-left) ─────────────────────────────────────────────────────
  const title = new PIXI.Text('YOU ARE NOT ALONE', textStyle(11, 0x3a4a6a, 3));
  title.x = 16;
  title.y = 14;
  hudLayer.addChild(title);

  // ── Controls hint (bottom-centre) ────────────────────────────────────────
  const hint = new PIXI.Text('WASD  /  ↑ ↓ ← →   to move', textStyle(12, 0x3a4a6a));
  hint.anchor.set(0.5, 1);
  hint.x = CANVAS_WIDTH / 2;
  hint.y = CANVAS_HEIGHT - 14;
  hudLayer.addChild(hint);

  // ── Phase label (bottom-right) ───────────────────────────────────────────
  const phase = new PIXI.Text('Phase 2 — You Are Not Alone', textStyle(10, 0x2a3a5a));
  phase.anchor.set(1, 1);
  phase.x = CANVAS_WIDTH - 16;
  phase.y = CANVAS_HEIGHT - 14;
  hudLayer.addChild(phase);

  // ── Connection / presence status (top-left, below title) ─────────────────
  // Updated every frame by updateStatus() below.
  const statusText = new PIXI.Text('CONNECTING…', textStyle(11, 0x5a6a3a, 2));
  statusText.x = 16;
  statusText.y = 34;
  hudLayer.addChild(statusText);

  return { statusText };
}

/**
 * Refresh the dynamic status line each frame.
 *
 * Shows "CONNECTING…" while awaiting the server handshake, "ALONE" once
 * connected solo, and "N SOULS" once other players are present — a small
 * nod to the game's central theme.
 *
 * @param {PIXI.Text} statusText
 * @param {number|null} localId
 */
function updateStatus(statusText, localId) {
  if (localId === null) {
    statusText.text       = 'CONNECTING…';
    statusText.style.fill = 0x6a6a3a;
    return;
  }

  const playerCount = entities.reduce((n, e) => n + (e.isPlayer ? 1 : 0), 0);

  if (playerCount <= 1) {
    statusText.text       = 'ALONE';
    statusText.style.fill = 0x3a4a6a;
  } else {
    statusText.text       = `${playerCount} SOULS`;
    statusText.style.fill = 0x4a9a6a;
  }
}