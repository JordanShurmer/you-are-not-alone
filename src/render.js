// render.js — PixiJS render system.
//
// Responsibility: keep the PixiJS scene graph in sync with the entity array.
//
// The render system is intentionally "dumb" — it knows nothing about game
// rules, input, or physics.  It simply:
//
//   1. Creates a PIXI display object the first time it sees an entity with
//      an .image field.
//   2. Updates that display object's position every frame to match
//      entity.position.
//   3. Destroys the display object when the entity is no longer in the array.
//
// Entity .position is treated as the *centre* of the rectangle so that future
// systems (camera, collision, lighting) have a consistent origin to reason about.
//
// PixiJS v7 API is used throughout (beginFill / drawRect / endFill).

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/**
 * Maps entity id → PIXI.Graphics instance.
 * We keep this module-level so it persists across frames without being
 * re-allocated every tick.
 *
 * @type {Map<number, PIXI.Graphics>}
 */
const _displayObjects = new Map();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sync the PixiJS scene graph to the current entity array.
 *
 * Call this once per frame, *after* update() has finished mutating entity
 * state, so that what PixiJS draws always reflects the latest simulation data.
 *
 * @param {PIXI.Container} stage  - The root PixiJS container to add children to.
 * @param {Array<Object>}  entities - The live entity array from entities.js.
 */
export function render(stage, entities) {
  // -------------------------------------------------------------------------
  // Pass 1 — Create / update display objects for every renderable entity.
  // An entity is "renderable" if it has both .image and .position fields.
  // -------------------------------------------------------------------------
  for (const entity of entities) {
    if (!entity.image || !entity.position) continue;

    let gfx = _displayObjects.get(entity.id);

    if (!gfx) {
      // First time we've seen this entity — build its display object.
      gfx = _createDisplayObject(entity.image);
      stage.addChild(gfx);
      _displayObjects.set(entity.id, gfx);
    }

    // Sync position.  entity.position is the centre of the rectangle, so we
    // offset by half the image dimensions to place the top-left corner.
    gfx.x = Math.round(entity.position.x - entity.image.width  / 2);
    gfx.y = Math.round(entity.position.y - entity.image.height / 2);
  }

  // -------------------------------------------------------------------------
  // Pass 2 — Remove display objects for entities that no longer exist.
  // Build a fast lookup set from the current entity ids first so we only
  // iterate the (usually small) _displayObjects map once.
  // -------------------------------------------------------------------------
  if (_displayObjects.size > entities.length) {
    const liveIds = new Set(entities.map((e) => e.id));

    for (const [id, gfx] of _displayObjects) {
      if (!liveIds.has(id)) {
        stage.removeChild(gfx);
        gfx.destroy();
        _displayObjects.delete(id);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a PixiJS Graphics rectangle for the given image descriptor.
 *
 * The graphic is drawn with the entity's colour and a subtle darker outline
 * so the rectangle reads clearly against any background.
 *
 * @param {{ width: number, height: number, color: number }} image
 * @returns {PIXI.Graphics}
 */
function _createDisplayObject(image) {
  const { width, height, color } = image;

  // Derive a slightly darker shade for the outline by reducing each channel.
  const outlineColor = _darken(color, 0.6);

  const gfx = new PIXI.Graphics();

  // Drop shadow — a slightly larger, dark, semi-transparent rect underneath.
  gfx.beginFill(0x000000, 0.25);
  gfx.drawRect(3, 4, width, height);
  gfx.endFill();

  // Outline — drawn first so the fill sits on top and covers the inner edge.
  gfx.lineStyle(2, outlineColor, 1);
  gfx.beginFill(color, 1);
  gfx.drawRect(0, 0, width, height);
  gfx.endFill();
  gfx.lineStyle(0);

  // Inner highlight — a thin bright strip along the top edge to give the
  // rectangle a tiny bit of dimensionality without requiring a sprite.
  const highlightColor = _lighten(color, 1.5);
  gfx.beginFill(highlightColor, 0.35);
  gfx.drawRect(3, 2, width - 6, 4);
  gfx.endFill();

  return gfx;
}

/**
 * Multiply each RGB channel of a packed hex colour by `factor`.
 * Clamps each channel to [0, 255].
 *
 * @param {number} color  - Packed 0xRRGGBB integer.
 * @param {number} factor - Multiplier (< 1 darkens, > 1 lightens).
 * @returns {number} Packed 0xRRGGBB integer.
 */
function _darken(color, factor) {
  const r = Math.min(255, ((color >> 16) & 0xff) * factor) | 0;
  const g = Math.min(255, ((color >>  8) & 0xff) * factor) | 0;
  const b = Math.min(255, ( color        & 0xff) * factor) | 0;
  return (r << 16) | (g << 8) | b;
}

/**
 * Lighten a packed hex colour by multiplying channels by `factor`.
 * Alias for _darken with factor > 1 — kept separate for readability at
 * call sites.
 *
 * @param {number} color
 * @param {number} factor
 * @returns {number}
 */
function _lighten(color, factor) {
  return _darken(color, factor);
}