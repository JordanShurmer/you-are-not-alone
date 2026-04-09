// main.js — Entry point for Phase 3: Ground Beneath Your Feet.
//
// Boot sequence:
//   1) Create the PixiJS app
//   2) Build world + HUD layers
//   3) Attach keyboard listeners (input.js)
//   4) Connect to the WebSocket server (network.js)
//      — server assigns player ID, color, spawn position
//      — server sends the world terrain grid inside WELCOME
//   5) Run the game loop:
//        • sample local keyboard → enqueue MOVE / JUMP → forward to server
//        • every ~100 ms broadcast POSITION + velocity for drift correction
//        • drain action queue → processActions → update → render

import { entities, getEntity }                        from './entities.js';
import { drainActions }                               from './actions.js';
import { setupInput, sampleInput }                    from './input.js';
import { processActions, update }                     from './update.js';
import { render }                                     from './render.js';
import { setupNetwork, getLocalPlayerId, sendAction } from './network.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CANVAS_WIDTH  = 900;
const CANVAS_HEIGHT = 600;
const BG_COLOR      = 0x0d0d1a;

/** How often (seconds) to broadcast our position + velocity for drift correction. */
const POSITION_SYNC_INTERVAL = 0.1;

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
      // ── Local input ────────────────────────────────────────────────────
      // sampleInput now returns an array (MOVE and/or JUMP).
      const localActions = sampleInput(localId);
      for (const action of localActions) {
        sendAction(action);
      }

      // ── Periodic position + velocity broadcast ─────────────────────────
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
            vx:       player.velocity?.x ?? 0,
            vy:       player.velocity?.y ?? 0,
          });
        }
      }
    }

    // ── Core loop ──────────────────────────────────────────────────────────
    const actions = drainActions();
    processActions(actions);
    update(dt);
    render(worldLayer, entities);

    // ── HUD status ─────────────────────────────────────────────────────────
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
  stage.addChild(hudLayer); // always above world

  return { worldLayer, hudLayer };
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

function buildHud(hudLayer) {
  const style = (size, color, spacing = 1) => ({
    fontFamily:    'monospace',
    fontSize:      size,
    fill:          color,
    letterSpacing: spacing,
  });

  // Title
  const title = new PIXI.Text('YOU ARE NOT ALONE', style(11, 0x3a4a6a, 3));
  title.x = 16;
  title.y = 14;
  hudLayer.addChild(title);

  // Controls hint
  const hint = new PIXI.Text('A / D to move   W / Space to jump', style(12, 0x3a4a6a));
  hint.anchor.set(0.5, 1);
  hint.x = CANVAS_WIDTH / 2;
  hint.y = CANVAS_HEIGHT - 14;
  hudLayer.addChild(hint);

  // Phase label
  const phase = new PIXI.Text('Phase 3 — Ground Beneath Your Feet', style(10, 0x2a3a5a));
  phase.anchor.set(1, 1);
  phase.x = CANVAS_WIDTH - 16;
  phase.y = CANVAS_HEIGHT - 14;
  hudLayer.addChild(phase);

  // Connection / presence status
  const statusText = new PIXI.Text('CONNECTING…', style(11, 0x5a6a3a, 2));
  statusText.x = 16;
  statusText.y = 34;
  hudLayer.addChild(statusText);

  return { statusText };
}

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