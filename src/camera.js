// camera.js — Shared camera position so input.js can convert screen→world coords.

let _x = 0;
let _y = 0;

/** Called by render.js after computing camX/camY. */
export function setCameraPosition(x, y) {
  _x = x;
  _y = y;
}

/** Returns the current camera offset in world-space pixels. */
export function getCameraPosition() {
  return { x: _x, y: _y };
}