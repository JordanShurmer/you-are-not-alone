// main.js — Entry point. Wires up PixiJS, entities, input, and the game loop.
//
// Boot sequence:
//   1. Create the PixiJS Application and mount its canvas.
//   2. Build the initial world (one player entity in the centre of the void).
//   3. Attach keyboard listeners so the player can move.
//   4. Register a ticker callback that runs every frame:
//        a. Drain the action queue.
//        b. processActions  — translate actions into entity state changes.
//        c. update          — advance the simulation by dt seconds.
//        d. render          — sync the PixiJS scene graph to entity state.
//
// PixiJS (v7) is loaded as a global (window.PIXI) via a <script> tag in
// index.html.  We do not import it — there is no bundler in Phase 1.

import { entities, createPlayer } from './entities.js';
import { drainActions }           from './actions.js';
import { setupInput, sampleInput } from './input.js';
import { processActions, update } from './update.js';
import { render }                 from './render.js';

// ---------------------------------------------------------------------------
// Canvas / Application configuration
// ---------------------------------------------------------------------------

const CANVAS_WIDTH  = 900;
const CANVAS_HEIGHT = 600;

/** Background colour of the void — deep dark navy. */
const BG_COLOR = 0x0d0d1a;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(function boot() {
  // -- 1. PixiJS Application -------------------------------------------------

  const app = new PIXI.Application({
    width:           CANVAS_WIDTH,
    height:          CANVAS_HEIGHT,
    backgroundColor: BG_COLOR,
    antialias:       true,
    resolution:      window.devicePixelRatio || 1,
    autoDensity:     true,  // keeps CSS pixels consistent on hi-DPI screens
  });

  document.getElementById('game-container').appendChild(app.view);

  // -- 2. Initial world state ------------------------------------------------

  const player = createPlayer(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);

  // -- 3. Input --------------------------------------------------------------

  setupInput();

  // -- 4. HUD — draw static control hints onto a dedicated container ---------

  const hud = _buildHud();
  app.stage.addChild(hud);

  // -- 5. Game loop ----------------------------------------------------------

  // We track our own last-timestamp instead of relying on PIXI's ticker.delta
  // (which is in "ticks", not seconds) so the update system gets a clean dt in
  // seconds that will stay correct if we later change the target frame rate.
  let lastTimestamp = performance.now();

  app.ticker.add(() => {
    const now = performance.now();
    const dt  = (now - lastTimestamp) / 1000; // milliseconds → seconds
    lastTimestamp = now;

    // a) Sample current keyboard state → enqueues a MOVE action.
    sampleInput(player.id);

    // b) Collect everything that happened since the last frame.
    const actions = drainActions();

    // c) Translate actions into entity state mutations.
    processActions(actions);

    // d) Advance the simulation.
    update(dt);

    // e) Sync the PixiJS scene graph — HUD stays on top.
    render(app.stage, entities);

    // Keep the HUD container above all entity graphics by re-raising it.
    // This is O(1) if it is already the last child (PixiJS early-exits).
    app.stage.setChildIndex(hud, app.stage.children.length - 1);
  });
})();

// ---------------------------------------------------------------------------
// HUD helpers
// ---------------------------------------------------------------------------

/**
 * Build a PixiJS Container holding the static on-screen control hints.
 * Drawn once; added to the stage permanently.
 *
 * @returns {PIXI.Container}
 */
function _buildHud() {
  const container = new PIXI.Container();

  // Subtle top-left label
  const title = new PIXI.Text('YOU ARE NOT ALONE', {
    fontFamily: 'monospace',
    fontSize:   11,
    fill:       0x3a4a6a,
    letterSpacing: 3,
  });
  title.x = 16;
  title.y = 14;
  container.addChild(title);

  // Control hint — bottom-centre
  const hint = new PIXI.Text('WASD  /  ↑ ↓ ← →   to move', {
    fontFamily: 'monospace',
    fontSize:   12,
    fill:       0x3a4a6a,
    letterSpacing: 1,
  });
  hint.anchor.set(0.5, 1);
  hint.x = CANVAS_WIDTH  / 2;
  hint.y = CANVAS_HEIGHT - 14;
  container.addChild(hint);

  // Phase label — bottom-right
  const phase = new PIXI.Text('Phase 1 — A Person in the Void', {
    fontFamily: 'monospace',
    fontSize:   10,
    fill:       0x2a3a5a,
    letterSpacing: 1,
  });
  phase.anchor.set(1, 1);
  phase.x = CANVAS_WIDTH  - 16;
  phase.y = CANVAS_HEIGHT - 14;
  container.addChild(phase);

  return container;
}