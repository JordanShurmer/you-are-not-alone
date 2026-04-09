// main.js — Entry point for Phase 1.
// Keeps boot flow small and explicit:
//   1) Create app
//   2) Build layers (world + HUD)
//   3) Create initial entities
//   4) Setup input
//   5) Run loop: sample input → process actions → update → render world only

import { entities, createPlayer } from './entities.js';
import { drainActions } from './actions.js';
import { setupInput, sampleInput } from './input.js';
import { processActions, update } from './update.js';
import { render } from './render.js';

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 600;
const BG_COLOR = 0x0d0d1a;

(function boot() {
  const app = createApp();
  const { worldLayer, hudLayer } = createLayers(app.stage);

  const player = createInitialWorld();
  setupInput();
  hudLayer.addChild(buildHud());

  let lastTimestamp = performance.now();

  app.ticker.add(() => {
    const now = performance.now();
    const dt = (now - lastTimestamp) / 1000;
    lastTimestamp = now;

    sampleInput(player.id);
    const actions = drainActions();
    processActions(actions);
    update(dt);
    render(worldLayer, entities);
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
  stage.addChild(hudLayer); // always above world; no per-frame reordering needed

  return { worldLayer, hudLayer };
}

function createInitialWorld() {
  return createPlayer(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
}

function buildHud() {
  const container = new PIXI.Container();

  const title = new PIXI.Text('YOU ARE NOT ALONE', {
    fontFamily: 'monospace',
    fontSize: 11,
    fill: 0x3a4a6a,
    letterSpacing: 3,
  });
  title.x = 16;
  title.y = 14;
  container.addChild(title);

  const hint = new PIXI.Text('WASD  /  ↑ ↓ ← →   to move', {
    fontFamily: 'monospace',
    fontSize: 12,
    fill: 0x3a4a6a,
    letterSpacing: 1,
  });
  hint.anchor.set(0.5, 1);
  hint.x = CANVAS_WIDTH / 2;
  hint.y = CANVAS_HEIGHT - 14;
  container.addChild(hint);

  const phase = new PIXI.Text('Phase 1 — A Person in the Void', {
    fontFamily: 'monospace',
    fontSize: 10,
    fill: 0x2a3a5a,
    letterSpacing: 1,
  });
  phase.anchor.set(1, 1);
  phase.x = CANVAS_WIDTH - 16;
  phase.y = CANVAS_HEIGHT - 14;
  container.addChild(phase);

  return container;
}