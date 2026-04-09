# You Are Not Alone — Development Phases

Each phase produces a playable end-to-end experience. No phase is "just infrastructure" — you can always open the browser and *do something*.

Multiplayer is the soul of this game, so it's established immediately. Every feature after Phase 2 is built multiplayer-first.

---

## Phase 1: A Person in the Void

**Goal:** A colored rectangle moves around an empty PixiJS canvas via keyboard input.

- Set up the project (HTML + vanilla JS, PixiJS)
- Implement the entity array (fat struct) with one entity: the player
- Implement the game loop: process input → update → render
- Implement the action queue; keyboard presses enqueue movement actions
- Player entity has `.position`, `.velocity`, `.image` (a colored rectangle), `.box` (collision rect)
- Arrow keys / WASD move the player around freely

**Playable result:** You open the browser, you see a rectangle, you move it around. That's the game.

---

## Phase 2: You Are Not Alone

**Goal:** A second player can join instantly and you see each other moving around the void.

- Set up a lightweight WebSocket server (golang with x/net/websocket)
- Quick-join: no lobbies, no menus. Open the URL, you're in
- Player actions flow through the action queue — local keyboard input and remote network messages use the exact same path
- The server receives actions and broadcasts them to all clients
- Each connected player is an entity in every client's entity array
- Players see each other as differently-colored rectangles moving in real time

**Playable result:** Send a friend the link. They appear. Two rectangles in the void. You move around together. The action queue has proven it handles both local and networked input identically. *You are not alone.*

---

## Phase 3: Ground Beneath Your Feet

**Goal:** A procedurally generated strip of terrain you both walk on with gravity.

- Add terrain entities (tiles) — simple colored rectangles for now (dirt, stone, sky)
- Implement gravity (applied to entities with `.physics`)
- Implement collision detection between `.box` entities (player vs terrain)
- Players land on ground, can walk left/right and jump
- Simple camera that follows the local player
- Generate a basic 2D heightmap world on the server; sync to clients on join
- World state is shared — both players see the same terrain

**Playable result:** A multiplayer side-scrolling platformer. You and a friend run and jump across the same terrain. A tiny Terraria with no features but two players.

---

## Phase 4: Darkness and Light

**Goal:** The world is dark. Each player carries a light. Being together means seeing more.

- Render a full-screen darkness overlay
- Player entities get `.lightsource` with a radius
- Implement light rendering — cut circular/soft holes in the darkness around lightsource entities
- Darkness is the default; only what's near a lightsource is visible
- Two players near each other see significantly more than one alone — the multiplayer payoff is immediate
- Tweak light falloff so the edges feel moody, not hard-clipped

**Playable result:** The same multiplayer platformer, but now it *feels* like something. Two small lights in a dark world. Walk apart and you each see less. Walk together and the world opens up. The game's thesis is now tangible.

---

## Phase 5: Breaking and Placing

**Goal:** Players can dig into the world and place blocks, and everyone sees the changes.

- Click/tap on a tile near the player to break it (enqueue a "break" action)
- Broken tiles drop a pickup entity; walking over it adds to a simple hotbar inventory
- Select an inventory slot and click to place that block back into the world
- Basic UI: hotbar at the bottom of the screen showing what you're carrying
- All block changes flow through the action queue → server → all clients (already works by design)

**Playable result:** Dig tunnels together, build walls together. One player digs while the other lights the way. Cooperation already feels natural.

---

## Phase 6: Home and Hearth

**Goal:** Build a rudimentary village with crafting, torches, and shelter.

- Add a "workbench" entity that can be crafted (combine wood blocks) and placed
- Interacting with the workbench opens a simple craft menu (e.g., wood → torch, wood → door)
- Torches are placeable lightsource entities — they stay lit and push back the dark permanently
- Doors are entities with togglable collision (open/close)
- Add trees to world generation (breakable, yield wood)
- Craft a simple sword from wood/stone
- Add a simple day/night cycle that affects ambient light level (night = darker, more dangerous feeling)

**Playable result:** Gather wood, craft torches, a door, and a sword. Build a lit shelter together before nightfall. You have a shared home and a weapon.

---

## Phase 7: Slay the Dragon

**Goal:** A complete game loop — enemies threaten you, a dragon attacks, you kill it, you win.

- Add basic enemy entities with `.ai` — move toward players, deal damage on contact
- Players and enemies get `.health`; taking damage flashes the entity, zero health = death
- Player respawns at home (or world spawn)
- Enemies spawn from dark areas and world edges, more at night
- Add a simple melee attack action (swing in a direction, damages enemies in a small arc)
- A dragon spawns after a set time or trigger — a larger enemy that flies and breathes fire (projectile entities)
- Kill the dragon → **end game screen** with stats (time survived, blocks placed, enemies killed, dragon slain together or solo)
- **Leaderboard** — persisted server-side, shows fastest dragon kills, best teams, and key stats
- After the end screen, players can start a new run or keep playing in the world

**Playable result:** A complete game from start to finish. Build, prepare, survive, kill the dragon, see your score, check the leaderboard. Send the link to friends and compete. This is a *shippable game*.

---

## Phase 8: Stronger Together

**Goal:** Co-op is mechanically essential for hard content; solo play has its own quieter loop.

- Enemies scale in difficulty with distance from spawn — venturing far alone is suicide
- Two players near each other deal bonus damage or gain a defense aura
- Add farming: place tilled soil, plant seeds, crops grow over time (solo-friendly loop)
- Add aesthetic building blocks (crafted at workbench): fences, lanterns, banners, colored walls
- Tinkering bench: craft better tools (pickaxe = faster mining, sword = more damage, lantern = bigger light)
- Solo players can farm, decorate, and tinker. Pushing into dangerous territory requires friends

**Playable result:** A richer gameplay loop. Farm and build when alone. Call in a friend for dragon attacks and deep exploration. Progress is real — your village grows, your gear improves, and doing it together is always better.

---

## Phase 9: The World Feels Alive

**Goal:** NPCs, a family, and a reason to care about your village.

- Add NPC villager entities that wander your village, seek shelter at night, and have names
- One NPC is your "family member" — they have dialogue (simple text bubbles) and give quests ("gather 10 wood", "build a wall here")
- NPCs can be lost to dragon attacks (they respawn slowly or must be rescued)
- Add biomes to world generation: forest, cave, mountain — each with distinct tiles and resources
- Add rare resources in deep/dangerous areas that unlock better crafting recipes
- Dragon attacks target your village — damaged buildings, scared NPCs

**Playable result:** You care about your village. NPCs make it feel lived-in. Dragon attacks feel personal. Exploring far-off biomes is a co-op adventure.

---

## Phase 10: Art and Soul

**Goal:** Replace programmer art with the whimsical hand-drawn style. Polish everything.

- Replace all rectangle sprites with hand-drawn PNGs (Midjourney with `--sref 658225328 1389363564`)
- Add particle effects: torch flicker, dust when mining, embers from dragon fire
- Add sound: ambient music, footsteps, mining sounds, dragon roar, crackling torches
- Smooth animations: walk cycles, attack swings, enemy movement
- UI polish: styled menus, inventory, health bars, quest tracker
- Add a title screen with the game name and immediate "Play" button (quick join)
- Performance pass: spatial partitioning for collision, render culling, entity pooling

**Playable result:** The game looks and sounds like a real game. The whimsical style shines. Everything from Phase 1–9 is still there, just beautiful now.

---

## Phase 11: The Dragon War

**Goal:** An endgame with depth. Escalating difficulty and a final boss worth fighting.

- Dragon raids escalate over time — bigger dragons, more minions, fire spreading across terrain
- Add a dragon boss with multiple attack phases and real mechanics (requires coordination)
- Add a progression system: defeating enemies grants experience → unlock abilities (dash, shield, light burst)
- A "victory" condition: defeat the elder dragon, your village is safe (but you can keep playing)
- Expanded leaderboard: village showcase, screenshots of what you built, hall of fame
- Multiple difficulty tiers for replayability

**Playable result:** A complete game. Build, survive, cooperate, fight, win. Then show off your village and do it again harder.

---

## Summary

| Phase | You Can... | Key System |
|-------|-----------|------------|
| 1 | Move a rectangle | Entity system, game loop, action queue |
| 2 | See a friend join instantly | Multiplayer via action queue, WebSocket |
| 3 | Run and jump on shared terrain | Physics, collision, world gen, camera |
| 4 | Carry light together through darkness | Lighting, co-op visibility |
| 5 | Dig and build together | Block interaction, inventory |
| 6 | Craft, shelter, and arm up | Crafting, placeable objects, day/night |
| 7 | Kill the dragon and hit the leaderboard | Combat, enemies, AI, end game, leaderboard |
| 8 | Progress and specialize | Co-op scaling, farming, tinkering |
| 9 | Care about your village | NPCs, quests, biomes |
| 10 | Marvel at the art | Visual and audio polish |
| 11 | Save the day (for real) | Boss phases, progression, escalation |

---

## Optional / Future Ideas

Things to explore once the core game is solid:

- **Seasonal or rotating challenges** — weekly dragon variants, limited-time biomes, community goals
- **Player-driven economy** — trade resources between villages, shared marketplaces
- **PvP dragon riders** — tamed dragons as mounts, competitive arena modes
- **Procedural quests** — generated quest chains that span biomes and require multi-player coordination
- **Modding support** — let players define new entities, blocks, and crafting recipes
- **Mobile support** — touch controls, simplified UI for smaller screens
