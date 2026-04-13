// main.go — Phase 5 "Breaking and Placing" WebSocket server for "You Are Not Alone".
// Changes from Phase 3:
//   - tileSand (3) tile type + sand deposit world generation
//   - server-side pickup tracking (PickupEntity, Hub.pickups)
//   - world mutation mutex (worldMu) guards all tile reads/writes in handlers
//   - BREAK_TILE, PLACE_TILE, PICKUP_COLLECT inbound message handlers
//   - TILE_UPDATE, PICKUP_SPAWN, PICKUP_COLLECT outbound messages
//   - Pickups included in WELCOME message

package main

import (
	"encoding/json"
	"log"
	"math"
	"math/rand"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/net/websocket"
)

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const (
	sendBufSize = 256
	maxMsgBytes = 8 * 1024

	// Tile types
	tileAir   = 0
	tileDirt  = 1
	tileStone = 2
	tileSand  = 3

	// World dimensions
	worldTileW = 600
	worldTileH = 450
	tileSize   = 32

	// Mining
	miningRangePx = 192.0
	miningRangeSq = miningRangePx * miningRangePx

	// Pickup collection validation (server-authoritative)
	pickupCollectRangePx = 56.0
	pickupCollectRangeSq = pickupCollectRangePx * pickupCollectRangePx
)

var playerColors = [...]string{
	"#4a9eff", // blue
	"#ff6b4a", // coral
	"#4aff8a", // mint
	"#ff4adb", // pink
	"#ffdd4a", // yellow
	"#c04aff", // violet
	"#4af0ff", // cyan
	"#ff9f4a", // amber
}

// -----------------------------------------------------------------------------
// World
// -----------------------------------------------------------------------------

type WorldData struct {
	Width    int   `json:"width"`
	Height   int   `json:"height"`
	TileSize int   `json:"tileSize"`
	Tiles    []int `json:"tiles"` // row-major
}

var gameWorld *WorldData

// worldMu guards all reads and writes to gameWorld.Tiles inside request handlers.
// (initWorld runs single-threaded so it does not need the lock.)
var worldMu sync.Mutex

func initWorld() {
	tiles := make([]int, worldTileW*worldTileH)

	// Re-usable surface height calculator (avoids duplicating the formula).
	computeSurfaceY := func(col int) int {
		fx := float64(col) / float64(worldTileW)
		h := 0.42 +
			0.02*math.Sin(fx*2*math.Pi*1.5) +
			0.01*math.Sin(fx*2*math.Pi*3.0+1.5)
		sy := max(int(h*float64(worldTileH)), 0)
		if sy >= worldTileH {
			sy = worldTileH - 1
		}
		return sy
	}

	// --- Pass 1: base terrain (air / dirt / stone) ---
	for x := 0; x < worldTileW; x++ {
		surfaceY := computeSurfaceY(x)
		for y := 0; y < worldTileH; y++ {
			idx := y*worldTileW + x
			switch {
			case y < surfaceY:
				tiles[idx] = tileAir
			case y < surfaceY+4:
				tiles[idx] = tileDirt
			default:
				tiles[idx] = tileStone
			}
		}
	}

	// --- Pass 2: sand pockets every ~30 columns ---
	for x := 0; x < worldTileW; x++ {
		if x%30 == 0 {
			patchW := rand.Intn(4) + 4 // 4–7 tiles wide
			for px := x; px < x+patchW && px < worldTileW; px++ {
				pSurfaceY := computeSurfaceY(px)
				for py := pSurfaceY - 1; py <= pSurfaceY+2; py++ {
					if py >= 0 && py < worldTileH {
						tiles[py*worldTileW+px] = tileSand
					}
				}
			}
		}
	}

	gameWorld = &WorldData{
		Width:    worldTileW,
		Height:   worldTileH,
		TileSize: tileSize,
		Tiles:    tiles,
	}
}

func surfaceAt(tx int) int {
	if tx < 0 {
		tx = 0
	}
	if tx >= worldTileW {
		tx = worldTileW - 1
	}
	for ty := 0; ty < worldTileH; ty++ {
		if gameWorld.Tiles[ty*worldTileW+tx] != tileAir {
			return ty
		}
	}
	return worldTileH - 1
}

func clampWorldX(x float64) float64 {
	maxX := float64(worldTileW * tileSize)
	if x < 0 {
		return 0
	}
	if x > maxX {
		return maxX
	}
	return x
}

func clampWorldY(y float64) float64 {
	maxY := float64(worldTileH * tileSize)
	if y < 0 {
		return 0
	}
	if y > maxY {
		return maxY
	}
	return y
}

// -----------------------------------------------------------------------------
// Pickup entity
// -----------------------------------------------------------------------------

type PickupEntity struct {
	ID       int     `json:"id"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	TileType int     `json:"tileType"`
}

// -----------------------------------------------------------------------------
// Wire message types — outbound
// -----------------------------------------------------------------------------

type PlayerSnapshot struct {
	ID    int     `json:"id"`
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	Color string  `json:"color"`
}

type WelcomeMsg struct {
	Type     string           `json:"type"`
	PlayerID int              `json:"playerId"`
	Color    string           `json:"color"`
	X        float64          `json:"x"`
	Y        float64          `json:"y"`
	Players  []PlayerSnapshot `json:"players"`
	World    *WorldData       `json:"world"`
	Pickups  []PickupEntity   `json:"pickups"`
}

type SpawnPlayerMsg struct {
	Type     string  `json:"type"`
	PlayerID int     `json:"playerId"`
	Color    string  `json:"color"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
}

type DespawnPlayerMsg struct {
	Type     string `json:"type"`
	PlayerID int    `json:"playerId"`
}

type MoveMsg struct {
	Type     string  `json:"type"`
	EntityID int     `json:"entityId"`
	DX       float64 `json:"dx"`
	DY       float64 `json:"dy"`
}

type JumpMsg struct {
	Type     string `json:"type"`
	EntityID int    `json:"entityId"`
}

type JumpReleaseMsg struct {
	Type     string `json:"type"`
	EntityID int    `json:"entityId"`
}

type BoostMsg struct {
	Type     string `json:"type"`
	EntityID int    `json:"entityId"`
}

type PositionMsg struct {
	Type     string  `json:"type"`
	EntityID int     `json:"entityId"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	VX       float64 `json:"vx"`
	VY       float64 `json:"vy"`
}

type TileUpdateMsg struct {
	Type     string `json:"type"` // "TILE_UPDATE"
	TX       int    `json:"tx"`
	TY       int    `json:"ty"`
	TileType int    `json:"tileType"`
}

type PickupSpawnMsg struct {
	Type     string  `json:"type"` // "PICKUP_SPAWN"
	ID       int     `json:"id"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	TileType int     `json:"tileType"`
}

type PickupCollectMsg struct {
	Type     string `json:"type"` // "PICKUP_COLLECT"
	PickupID int    `json:"pickupId"`
}

// -----------------------------------------------------------------------------
// Wire message types — inbound
// -----------------------------------------------------------------------------

type inboundEnvelope struct {
	Type string `json:"type"`
}

type inboundMove struct {
	Type     string   `json:"type"`
	EntityID *int     `json:"entityId"`
	DX       *float64 `json:"dx"`
}

type inboundJump struct {
	Type     string `json:"type"`
	EntityID *int   `json:"entityId"`
}

type inboundJumpRelease struct {
	Type     string `json:"type"`
	EntityID *int   `json:"entityId"`
}

type inboundBoost struct {
	Type     string `json:"type"`
	EntityID *int   `json:"entityId"`
}

type inboundPosition struct {
	Type     string   `json:"type"`
	EntityID *int     `json:"entityId"`
	X        *float64 `json:"x"`
	Y        *float64 `json:"y"`
	VX       *float64 `json:"vx"`
	VY       *float64 `json:"vy"`
}

type inboundBreakTile struct {
	Type     string `json:"type"`
	EntityID *int   `json:"entityId"`
	TX       *int   `json:"tx"`
	TY       *int   `json:"ty"`
}

type inboundPlaceTile struct {
	Type     string `json:"type"`
	EntityID *int   `json:"entityId"`
	TX       *int   `json:"tx"`
	TY       *int   `json:"ty"`
	TileType *int   `json:"tileType"`
}

type inboundPickupCollect struct {
	Type     string `json:"type"`
	EntityID *int   `json:"entityId"`
	PickupID *int   `json:"pickupId"`
}

// -----------------------------------------------------------------------------
// Hub / Client
// -----------------------------------------------------------------------------

type Client struct {
	ws    *websocket.Conn
	id    int
	x, y  float64
	color string
	send  chan string
}

type Hub struct {
	mu           sync.RWMutex
	conns        map[int]*Client
	nextID       atomic.Int32
	pickups      map[int]*PickupEntity
	nextPickupID atomic.Int32
}

func NewHub() *Hub {
	return &Hub{
		conns:   make(map[int]*Client),
		pickups: make(map[int]*PickupEntity),
	}
}

func (h *Hub) allocID() int {
	return int(h.nextID.Add(1)) - 1
}

func (h *Hub) allocPickupID() int {
	return int(h.nextPickupID.Add(1)) - 1
}

func (h *Hub) add(c *Client) {
	h.mu.Lock()
	h.conns[c.id] = c
	h.mu.Unlock()
}

func (h *Hub) remove(id int) *Client {
	h.mu.Lock()
	c := h.conns[id]
	delete(h.conns, id)
	h.mu.Unlock()
	return c
}

func (h *Hub) count() int {
	h.mu.RLock()
	n := len(h.conns)
	h.mu.RUnlock()
	return n
}

func (h *Hub) snapshot() []PlayerSnapshot {
	h.mu.RLock()
	out := make([]PlayerSnapshot, 0, len(h.conns))
	for _, c := range h.conns {
		out = append(out, PlayerSnapshot{
			ID:    c.id,
			X:     c.x,
			Y:     c.y,
			Color: c.color,
		})
	}
	h.mu.RUnlock()
	return out
}

func (h *Hub) updatePos(id int, x, y float64) {
	h.mu.Lock()
	if c, ok := h.conns[id]; ok {
		c.x, c.y = x, y
	}
	h.mu.Unlock()
}

func (h *Hub) addPickup(p *PickupEntity) {
	h.mu.Lock()
	h.pickups[p.ID] = p
	h.mu.Unlock()
}

func (h *Hub) tryCollectPickup(id int, px, py, maxRangeSq float64) bool {
	h.mu.Lock()
	defer h.mu.Unlock()

	p, ok := h.pickups[id]
	if !ok {
		return false
	}
	if distSq(px, py, p.X, p.Y) > maxRangeSq {
		return false
	}

	delete(h.pickups, id)
	return true
}

func (h *Hub) snapshotPickups() []PickupEntity {
	h.mu.RLock()
	out := make([]PickupEntity, 0, len(h.pickups))
	for _, p := range h.pickups {
		out = append(out, *p)
	}
	h.mu.RUnlock()
	return out
}

func (h *Hub) broadcastJSON(v any, excludeID int) {
	raw, err := json.Marshal(v)
	if err != nil {
		log.Printf("warn: marshal broadcast failed: %v", err)
		return
	}
	h.broadcastRaw(string(raw), excludeID)
}

func (h *Hub) broadcastRaw(raw string, excludeID int) {
	h.mu.RLock()
	for id, c := range h.conns {
		if id == excludeID {
			continue
		}
		select {
		case c.send <- raw:
		default:
			log.Printf("warn: dropped message to player %d (send buffer full)", id)
		}
	}
	h.mu.RUnlock()
}

var hub = NewHub()

// -----------------------------------------------------------------------------
// Validation helpers
// -----------------------------------------------------------------------------

func finite(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0)
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func decodeInbound(raw string, v any) bool {
	if len(raw) == 0 || len(raw) > maxMsgBytes {
		return false
	}
	if err := json.Unmarshal([]byte(raw), v); err != nil {
		return false
	}
	return true
}

func distSq(ax, ay, bx, by float64) float64 {
	dx := ax - bx
	dy := ay - by
	return dx*dx + dy*dy
}

// -----------------------------------------------------------------------------
// WebSocket session handler
// -----------------------------------------------------------------------------

func handleWS(ws *websocket.Conn) {
	id := hub.allocID()
	color := playerColors[id%len(playerColors)]

	// Spawn around centre with small horizontal spread.
	spawnTileX := worldTileW/2 + (rand.Intn(20) - 10)
	surfaceY := surfaceAt(spawnTileX)

	spawnX := float64(spawnTileX*tileSize) + float64(tileSize)/2
	spawnY := float64(surfaceY*tileSize) - 15.0

	c := &Client{
		ws:    ws,
		id:    id,
		x:     spawnX,
		y:     spawnY,
		color: color,
		send:  make(chan string, sendBufSize),
	}

	others := hub.snapshot()
	hub.add(c)

	log.Printf("+ player %d joined color=%s pos=(%.0f,%.0f) online=%d",
		id, color, spawnX, spawnY, hub.count())

	// Writer goroutine — sole owner of websocket writes.
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for msg := range c.send {
			if err := websocket.Message.Send(c.ws, msg); err != nil {
				return
			}
		}
	}()

	// WELCOME — includes current world state and all existing pickups.
	welcomeRaw, _ := json.Marshal(WelcomeMsg{
		Type:     "WELCOME",
		PlayerID: id,
		Color:    color,
		X:        spawnX,
		Y:        spawnY,
		Players:  others,
		World:    gameWorld,
		Pickups:  hub.snapshotPickups(),
	})
	c.send <- string(welcomeRaw)

	// SPAWN_PLAYER to all other connected clients.
	hub.broadcastJSON(SpawnPlayerMsg{
		Type:     "SPAWN_PLAYER",
		PlayerID: id,
		Color:    color,
		X:        spawnX,
		Y:        spawnY,
	}, id)

	// Reader loop.
	for {
		var raw string
		if err := websocket.Message.Receive(c.ws, &raw); err != nil {
			break
		}
		handleInboundFromClient(c, raw)
	}

	// Cleanup on disconnect.
	removed := hub.remove(id)
	if removed != nil {
		close(removed.send)
	}
	wg.Wait()

	log.Printf("- player %d left online=%d", id, hub.count())

	hub.broadcastJSON(DespawnPlayerMsg{
		Type:     "DESPAWN_PLAYER",
		PlayerID: id,
	}, -1)
}

// -----------------------------------------------------------------------------
// Inbound message dispatcher
// -----------------------------------------------------------------------------

func handleInboundFromClient(c *Client, raw string) {
	var env inboundEnvelope
	if !decodeInbound(raw, &env) || env.Type == "" {
		log.Printf("warn: invalid envelope from player %d", c.id)
		return
	}

	switch env.Type {

	// ---- existing actions -----------------------------------------------

	case "MOVE":
		var in inboundMove
		if !decodeInbound(raw, &in) || in.EntityID == nil || in.DX == nil {
			log.Printf("warn: invalid MOVE from player %d", c.id)
			return
		}
		if *in.EntityID != c.id {
			log.Printf("warn: spoofed MOVE from player %d (entityId=%d)", c.id, *in.EntityID)
			return
		}
		if !finite(*in.DX) {
			return
		}
		hub.broadcastJSON(MoveMsg{
			Type:     "MOVE",
			EntityID: c.id,
			DX:       clamp(*in.DX, -1, 1),
			DY:       0,
		}, c.id)

	case "JUMP":
		var in inboundJump
		if !decodeInbound(raw, &in) || in.EntityID == nil {
			log.Printf("warn: invalid JUMP from player %d", c.id)
			return
		}
		if *in.EntityID != c.id {
			log.Printf("warn: spoofed JUMP from player %d (entityId=%d)", c.id, *in.EntityID)
			return
		}
		hub.broadcastJSON(JumpMsg{
			Type:     "JUMP",
			EntityID: c.id,
		}, c.id)

	case "JUMP_RELEASE":
		var in inboundJumpRelease
		if !decodeInbound(raw, &in) || in.EntityID == nil {
			log.Printf("warn: invalid JUMP_RELEASE from player %d", c.id)
			return
		}
		if *in.EntityID != c.id {
			log.Printf("warn: spoofed JUMP_RELEASE from player %d (entityId=%d)", c.id, *in.EntityID)
			return
		}
		hub.broadcastJSON(JumpReleaseMsg{
			Type:     "JUMP_RELEASE",
			EntityID: c.id,
		}, c.id)

	case "BOOST":
		var in inboundBoost
		if !decodeInbound(raw, &in) || in.EntityID == nil {
			log.Printf("warn: invalid BOOST from player %d", c.id)
			return
		}
		if *in.EntityID != c.id {
			log.Printf("warn: spoofed BOOST from player %d (entityId=%d)", c.id, *in.EntityID)
			return
		}
		hub.broadcastJSON(BoostMsg{
			Type:     "BOOST",
			EntityID: c.id,
		}, c.id)

	case "POSITION":
		var in inboundPosition
		if !decodeInbound(raw, &in) || in.EntityID == nil || in.X == nil || in.Y == nil {
			log.Printf("warn: invalid POSITION from player %d", c.id)
			return
		}
		if *in.EntityID != c.id {
			log.Printf("warn: spoofed POSITION from player %d (entityId=%d)", c.id, *in.EntityID)
			return
		}
		if !finite(*in.X) || !finite(*in.Y) {
			return
		}

		vx := 0.0
		vy := 0.0
		if in.VX != nil && finite(*in.VX) {
			vx = *in.VX
		}
		if in.VY != nil && finite(*in.VY) {
			vy = *in.VY
		}

		x := clampWorldX(*in.X)
		y := clampWorldY(*in.Y)
		hub.updatePos(c.id, x, y)

		hub.broadcastJSON(PositionMsg{
			Type:     "POSITION",
			EntityID: c.id,
			X:        x,
			Y:        y,
			VX:       vx,
			VY:       vy,
		}, c.id)

	// ---- Phase 5: breaking ----------------------------------------------

	case "BREAK_TILE":
		var in inboundBreakTile
		if !decodeInbound(raw, &in) || in.EntityID == nil || in.TX == nil || in.TY == nil {
			log.Printf("warn: invalid BREAK_TILE from player %d", c.id)
			return
		}
		if *in.EntityID != c.id {
			log.Printf("warn: spoofed BREAK_TILE from player %d (entityId=%d)", c.id, *in.EntityID)
			return
		}

		tx := *in.TX
		ty := *in.TY
		if tx < 0 || tx >= worldTileW || ty < 0 || ty >= worldTileH {
			return
		}

		// Range check against the player's last known position.
		tileX := (float64(tx) + 0.5) * float64(tileSize)
		tileY := (float64(ty) + 0.5) * float64(tileSize)
		if distSq(c.x, c.y, tileX, tileY) > miningRangeSq {
			return
		}

		worldMu.Lock()

		if gameWorld.Tiles[ty*worldTileW+tx] == tileAir {
			worldMu.Unlock()
			return
		}
		brokenTileType := gameWorld.Tiles[ty*worldTileW+tx]
		gameWorld.Tiles[ty*worldTileW+tx] = tileAir

		// Collect every tile that changes so we can broadcast them all.
		type tileChange struct{ tx, ty, tileType int }
		changes := []tileChange{{tx, ty, tileAir}}

		// Sand cascade: contiguous sand directly above the broken tile falls one step.
		for checkY := ty - 1; checkY >= 0; checkY-- {
			if gameWorld.Tiles[checkY*worldTileW+tx] == tileSand {
				gameWorld.Tiles[(checkY+1)*worldTileW+tx] = tileSand
				gameWorld.Tiles[checkY*worldTileW+tx] = tileAir
				changes = append(changes, tileChange{tx, checkY, tileAir})
				changes = append(changes, tileChange{tx, checkY + 1, tileSand})
			} else {
				break
			}
		}

		worldMu.Unlock()

		// Broadcast every tile mutation.
		for _, ch := range changes {
			hub.broadcastJSON(TileUpdateMsg{
				Type:     "TILE_UPDATE",
				TX:       ch.tx,
				TY:       ch.ty,
				TileType: ch.tileType,
			}, -1)
		}

		// Spawn a pickup at the centre of the broken tile.
		pickupID := hub.allocPickupID()
		px := (float64(tx) + 0.5) * float64(tileSize)
		py := float64(ty)*float64(tileSize) - 8.0
		pickup := &PickupEntity{ID: pickupID, X: px, Y: py, TileType: brokenTileType}
		hub.addPickup(pickup)
		hub.broadcastJSON(PickupSpawnMsg{
			Type:     "PICKUP_SPAWN",
			ID:       pickupID,
			X:        px,
			Y:        py,
			TileType: brokenTileType,
		}, -1)

	// ---- Phase 5: placing -----------------------------------------------

	case "PLACE_TILE":
		var in inboundPlaceTile
		if !decodeInbound(raw, &in) || in.EntityID == nil || in.TX == nil || in.TY == nil || in.TileType == nil {
			log.Printf("warn: invalid PLACE_TILE from player %d", c.id)
			return
		}
		if *in.EntityID != c.id {
			log.Printf("warn: spoofed PLACE_TILE from player %d (entityId=%d)", c.id, *in.EntityID)
			return
		}

		tt := *in.TileType
		if tt != tileDirt && tt != tileStone && tt != tileSand {
			log.Printf("warn: invalid tileType %d in PLACE_TILE from player %d", tt, c.id)
			return
		}

		tx := *in.TX
		ty := *in.TY
		if tx < 0 || tx >= worldTileW || ty < 0 || ty >= worldTileH {
			return
		}

		// Range check.
		tileX := (float64(tx) + 0.5) * float64(tileSize)
		tileY := (float64(ty) + 0.5) * float64(tileSize)
		if distSq(c.x, c.y, tileX, tileY) > miningRangeSq {
			return
		}

		worldMu.Lock()
		if gameWorld.Tiles[ty*worldTileW+tx] != tileAir {
			worldMu.Unlock()
			return
		}
		gameWorld.Tiles[ty*worldTileW+tx] = tt
		worldMu.Unlock()

		hub.broadcastJSON(TileUpdateMsg{
			Type:     "TILE_UPDATE",
			TX:       tx,
			TY:       ty,
			TileType: tt,
		}, -1)

	// ---- Phase 5: pickup collection -------------------------------------

	case "PICKUP_COLLECT":
		var in inboundPickupCollect
		if !decodeInbound(raw, &in) || in.EntityID == nil || in.PickupID == nil {
			log.Printf("warn: invalid PICKUP_COLLECT from player %d", c.id)
			return
		}
		if *in.EntityID != c.id {
			log.Printf("warn: spoofed PICKUP_COLLECT from player %d (entityId=%d)", c.id, *in.EntityID)
			return
		}

		pickupID := *in.PickupID
		if !hub.tryCollectPickup(pickupID, c.x, c.y, pickupCollectRangeSq) {
			return
		}

		// Relay to all OTHER clients so they remove the pickup from their scene.
		hub.broadcastJSON(PickupCollectMsg{
			Type:     "PICKUP_COLLECT",
			PickupID: pickupID,
		}, c.id)

	default:
		// Ignore unknown message types for forward compatibility.
	}
}

// -----------------------------------------------------------------------------
// main
// -----------------------------------------------------------------------------

func main() {
	rand.Seed(time.Now().UnixNano()) //nolint:staticcheck
	initWorld()

	log.Printf("world initialized: %dx%d tiles (%dx%d px)",
		worldTileW, worldTileH, worldTileW*tileSize, worldTileH*tileSize)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.Dir("../")))
	mux.Handle("/ws", websocket.Server{
		Handshake: func(_ *websocket.Config, _ *http.Request) error { return nil },
		Handler:   handleWS,
	})

	addr := ":" + port
	log.Printf("game server ready -> http://localhost%s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}
