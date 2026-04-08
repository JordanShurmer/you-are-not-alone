# AGENTS.md

## Project Overview

Atmospheric co-op browser game built for Levels IO's vibe game jam. No build step, no bundler, no framework — open `index.html` directly in a browser or serve locally.

## Running the Game

```bash
# Any static file server works, e.g.:
npx serve .
python3 -m http.server
```

Then open `http://localhost:<port>` in a browser. There is no build, compile, or install step.

## File Structure

```
index.html   — Layout, CSS (all inline), loads game.js as an ES module
game.js      — All game logic (canvas rendering, entity state, input handling)
wiz.png      — Player sprite (wizard, facing right)
wiz2.png     — Second wizard sprite (unused so far)
```

## Architecture

Single-file JS game loop pattern:

- **`everything[]`** — flat array holding all game entities as plain objects with a `type` field
- **`gameLoop()`** — `requestAnimationFrame` loop: calls `updateMovement()`, clears canvas, then iterates `everything` and renders each entity by `type` via a `switch`
- Entity shape (player): `{ type, label, forward, maxSpeed, acceleration, deceleration, x, y, vision: { direction, distance, angle, x, y } }`
- `local1` is a direct reference into `everything` — the locally-controlled player

## Input & Controls

| Input | Effect |
|-------|--------|
| Mouse move | Rotates vision cone to face cursor |
| W / S | Accelerate / decelerate forward (moves in vision direction) |
| A / D | Rotate vision direction left/right |

Controls fieldset in HTML is `hidden` by default (dev debugging aid). The `#controls` fieldset drives live vision tweaks via `input` events.

## Rendering

- Canvas is sized to its parent element on load (not responsive after resize — no `ResizeObserver` yet)
- Theme colors are read from CSS custom properties every frame (`--theme`, `--game-dark`, `--game-light`) so they react to `prefers-color-scheme`
- Vision cone is drawn as a canvas arc: center offset by `(vx, vy)` relative to the player, rotated to `vision.direction`, arc spanning `±vision.angle` at radius `vision.distance`
- `qd()` is a debug helper that draws a row of small colored rectangles — not wired to anything meaningful yet

## Conventions & Gotchas

- **No modules/bundler**: `game.js` is loaded as `type="module"` purely for top-level `const` scoping — there are no imports or exports. Don't add a bundler unless the project grows to multiple files that need it.
- **Entity mutation is direct**: input handlers and `updateMovement` mutate entity objects in place; there is no state management layer.
- **`wiz2.png` is unused** — a second sprite asset exists but isn't referenced in code yet.
- **Canvas is not responsive**: width/height set once on load. If you add window resize support, update both `canvas.width`/`canvas.height` and recalculate entity positions.
- **Vision arc quirk**: the arc is drawn with `arc(vx, vy, distance, angle, -angle)` — note the angles are absolute (not delta), passed as `+angle` and `-angle` relative to the already-rotated context. The `lineTo(0,0)` closes it into a pie-wedge shape.
- **Movement is vision-direction-locked**: W/S move in the direction the player is looking (mouse aim), not in a separate heading. A/D rotate the aim, which also changes movement direction.
