// parallax.js — Sequential parallax background scenes.
//
// Images are arranged end-to-end along the horizontal axis, each scene
// covering a wide stretch of the world.  They only very slightly overlap at
// their boundaries.  Each image has a tiny individual speed offset so that
// near a boundary the two images drift apart at slightly different rates,
// giving a sense of depth during the transition.
//
// Usage (main.js):
//   const parallaxLayer = new PIXI.Container();
//   stage.addChildAt(parallaxLayer, 0);   // behind worldLayer
//   await initParallax(parallaxLayer);
//   // then each frame:
//   updateParallax(camX);

import { getCanvasWidth, getCanvasHeight } from './config.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const FILES = ['1.png', '2.png', '3.png', '5.png', '6.png', '8.png', '10.png'];

// How large to display each image (uniform scale — tweak to taste).
const DISPLAY_SCALE = 1.0;

// How much adjacent scenes overlap in screen pixels at camX = 0.
// Keep this small — just enough to avoid a hard seam.
const OVERLAP_PX = 2;

// Base parallax factor: the background as a whole scrolls at this fraction
// of the camera speed, making it feel like a distant backdrop.
const BASE_SPEED = 0.85;

// Each successive image gets this much extra speed on top of BASE_SPEED.
// Tiny value — only perceptible at the boundary where two images meet.
const SPEED_STEP = 0.012;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   sprite:  PIXI.Sprite,
 *   baseX:   number,
 *   speed:   number,
 *   displayW: number,
 *   displayH: number,
 * }} Scene
 * @type {Scene[]}
 */
const _scenes = [];
let _ready = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load every scene image and position the sprites end-to-end.
 * Await this before starting the game loop to avoid pop-in.
 *
 * @param {PIXI.Container} container  Screen-space container (not moved by camera).
 */
export async function initParallax(container) {
  const textures = await Promise.all(
    FILES.map(f => PIXI.Texture.fromURL(`assets/paralax/${f}`))
  );

  // Nearest-neighbour keeps pixel art crisp at any scale.
  for (const tex of textures) {
    tex.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
  }

  const H = getCanvasHeight();

  // Walk left-to-right, placing each scene after the previous one minus the
  // small overlap so they're nearly (but not completely) non-overlapping.
  let cursorX = 0;

  textures.forEach((tex, i) => {
    const displayW = tex.width  * DISPLAY_SCALE;
    const displayH = tex.height * DISPLAY_SCALE;

    const sprite = new PIXI.Sprite(tex);
    sprite.scale.set(DISPLAY_SCALE);

    // Anchor at bottom-left so all scenes sit on the same ground line.
    sprite.anchor.set(0, 1);

    // baseX is the resting left edge of this scene in background-space.
    const baseX = cursorX;

    // Each image's individual scroll speed is BASE_SPEED + a tiny per-image
    // increment.  The further right the scene, the marginally faster it
    // scrolls, which causes a subtle drift between neighbours at transitions.
    const speed = BASE_SPEED + i * SPEED_STEP;

    container.addChild(sprite);
    _scenes.push({ sprite, baseX, speed, displayW, displayH });

    // Advance cursor, pulling the next scene back by OVERLAP_PX.
    cursorX += displayW - OVERLAP_PX;
  });

  _ready = true;
  // Position everything immediately so there's no one-frame jump.
  updateParallax(0);
}

/**
 * Drive the parallax scroll.  Call once per frame.
 *
 * @param {number} camX  Current camera X in world-space pixels.
 */
export function updateParallax(camX) {
  if (!_ready) return;

  const H = getCanvasHeight();

  for (const { sprite, baseX, speed, displayH } of _scenes) {
    // Each scene slides left at its own speed.  Because speed < 1 the whole
    // backdrop moves slower than the world, and because speeds differ slightly
    // the scenes drift relative to each other at their shared boundaries.
    sprite.x = baseX - camX * speed;
    sprite.y = H;
  }
}
