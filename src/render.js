// render.js — PixiJS render system.
//
// Responsibility: keep the PixiJS scene graph in sync with the entity array.
//
// Streamlined for Phase 1:
// - Keep display object cache by entity id.
// - Reuse a module-level live-id Set to avoid per-frame Set allocations.
// - Use one shared color scaling helper for darken/lighten variants.

const _displayObjects = new Map(); // entityId -> PIXI.Graphics
const _liveIds = new Set();        // reused each frame to track current entities

/**
 * Sync the PixiJS scene graph to the current entity array.
 *
 * @param {PIXI.Container} stage
 * @param {Array<Object>} entities
 */
export function render(stage, entities) {
  _liveIds.clear();

  // Pass 1: create/update renderables and record live ids.
  for (const entity of entities) {
    if (!entity?.image || !entity?.position) continue;

    const { id, image, position } = entity;
    _liveIds.add(id);

    let gfx = _displayObjects.get(id);
    if (!gfx) {
      gfx = _createDisplayObject(image);
      _displayObjects.set(id, gfx);
      stage.addChild(gfx);
    }

    // Position uses center-origin entity coordinates.
    gfx.x = Math.round(position.x - image.width / 2);
    gfx.y = Math.round(position.y - image.height / 2);
  }

  // Pass 2: cleanup stale display objects.
  for (const [id, gfx] of _displayObjects) {
    if (_liveIds.has(id)) continue;

    stage.removeChild(gfx);
    gfx.destroy();
    _displayObjects.delete(id);
  }
}

/**
 * Build a rectangle graphic from image descriptor.
 *
 * @param {{ width:number, height:number, color:number }} image
 * @returns {PIXI.Graphics}
 */
function _createDisplayObject(image) {
  const { width, height, color } = image;

  const outlineColor = _scaleColor(color, 0.6);
  const highlightColor = _scaleColor(color, 1.5);

  const gfx = new PIXI.Graphics();

  // Drop shadow
  gfx.beginFill(0x000000, 0.25);
  gfx.drawRect(3, 4, width, height);
  gfx.endFill();

  // Main body + outline
  gfx.lineStyle(2, outlineColor, 1);
  gfx.beginFill(color, 1);
  gfx.drawRect(0, 0, width, height);
  gfx.endFill();
  gfx.lineStyle(0);

  // Top highlight
  gfx.beginFill(highlightColor, 0.35);
  gfx.drawRect(3, 2, width - 6, 4);
  gfx.endFill();

  return gfx;
}

/**
 * Scale packed RGB channels by a factor.
 *
 * @param {number} color - 0xRRGGBB
 * @param {number} factor - <1 darken, >1 lighten
 * @returns {number}
 */
function _scaleColor(color, factor) {
  const r = Math.min(255, ((color >> 16) & 0xff) * factor) | 0;
  const g = Math.min(255, ((color >> 8) & 0xff) * factor) | 0;
  const b = Math.min(255, (color & 0xff) * factor) | 0;
  return (r << 16) | (g << 8) | b;
}