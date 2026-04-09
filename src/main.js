// main.js — Entry point for Phase 3: Ground Beneath Your Feet.

import { entities, getEntity } from './entities.js';
import { drainActions } from './actions.js';
import { setupInput, sampleInput } from './input.js';
import { processActions, update } from './update.js';
import { render } from './render.js';
import { setupNetwork, getLocalPlayerId, sendAction } from './network.js';
import { CANVAS_WIDTH, CANVAS_HEIGHT, BG_COLOR } from './config.js';

/** How often (seconds) to broadcast our position + velocity for drift correction. */
const POSITION_SYNC_INTERVAL = 0.1;

/** How often (seconds) to recount players for HUD status text. */
const STATUS_SAMPLE_INTERVAL = 0.2;

(function boot() {
  const app = createApp();
  const { worldLayer, hudLayer } = createLayers(app.stage);

  setupInput();
  setupNetwork();

  const { statusText } = buildHud(hudLayer);

  let lastTimestamp = performance.now();
  let syncTimer = 0;
  let statusTimer = STATUS_SAMPLE_INTERVAL; // force immediate first sample
  let cachedPlayerCount = 0;
  const statusState = { text: '', fill: -1 };

  app.ticker.add(() => {
    const now = performance.now();
    const dt = (now - lastTimestamp) / 1000;
    lastTimestamp = now;

    const localId = getLocalPlayerId();

    if (localId !== null) {
      // Local input (MOVE and/or JUMP)
      const localActions = sampleInput(localId);
      for (let i = 0; i < localActions.length; i++) {
        sendAction(localActions[i]);
      }

      // Periodic position + velocity broadcast
      syncTimer += dt;
      if (syncTimer >= POSITION_SYNC_INTERVAL) {
        syncTimer -= POSITION_SYNC_INTERVAL;
        const player = getEntity(localId);
        if (player) {
          sendAction({
            type: 'POSITION',
            entityId: localId,
            x: player.position.x,
            y: player.position.y,
            vx: player.velocity?.x ?? 0,
            vy: player.velocity?.y ?? 0,
          });
        }
      }
    } else {
      syncTimer = 0;
    }

    // Core loop
    const actions = drainActions();
    processActions(actions);
    update(dt);
    render(worldLayer, entities);

    // HUD status (lighter than recounting every frame)
    if (localId === null) {
      setStatus(statusText, statusState, 'CONNECTING…', 0x6a6a3a);
    } else {
      statusTimer += dt;
      if (statusTimer >= STATUS_SAMPLE_INTERVAL) {
        statusTimer = 0;
        cachedPlayerCount = countPlayers(entities);
      }

      if (cachedPlayerCount <= 1) {
        setStatus(statusText, statusState, 'ALONE', 0x3a4a6a);
      } else {
        setStatus(statusText, statusState, `${cachedPlayerCount} SOULS`, 0x4a9a6a);
      }
    }
  });
})();

function createApp() {
  const app = new PIXI.Application({
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    backgroundColor: BG_COLOR,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  document.getElementById('game-container').appendChild(app.view);
  return app;
}

function createLayers(stage) {
  const worldLayer = new PIXI.Container();
  const hudLayer = new PIXI.Container();

  stage.addChild(worldLayer);
  stage.addChild(hudLayer);

  return { worldLayer, hudLayer };
}

function buildHud(hudLayer) {
  const style = (size, color, spacing = 1) => ({
    fontFamily: 'monospace',
    fontSize: size,
    fill: color,
    letterSpacing: spacing,
  });

  const title = new PIXI.Text('YOU ARE NOT ALONE', style(11, 0x3a4a6a, 3));
  title.x = 16;
  title.y = 14;
  hudLayer.addChild(title);

  const hint = new PIXI.Text('A / D to move   W / Space to jump', style(12, 0x3a4a6a));
  hint.anchor.set(0.5, 1);
  hint.x = CANVAS_WIDTH / 2;
  hint.y = CANVAS_HEIGHT - 14;
  hudLayer.addChild(hint);

  const phase = new PIXI.Text('Phase 3 — Ground Beneath Your Feet', style(10, 0x2a3a5a));
  phase.anchor.set(1, 1);
  phase.x = CANVAS_WIDTH - 16;
  phase.y = CANVAS_HEIGHT - 14;
  hudLayer.addChild(phase);

  const statusText = new PIXI.Text('CONNECTING…', style(11, 0x5a6a3a, 2));
  statusText.x = 16;
  statusText.y = 34;
  hudLayer.addChild(statusText);

  return { statusText };
}

function countPlayers(allEntities) {
  let count = 0;
  for (let i = 0; i < allEntities.length; i++) {
    if (allEntities[i]?.isPlayer) count++;
  }
  return count;
}

function setStatus(statusText, statusState, text, fill) {
  if (statusState.text === text && statusState.fill === fill) return;
  statusText.text = text;
  statusText.style.fill = fill;
  statusState.text = text;
  statusState.fill = fill;
}