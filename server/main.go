// main.go — Phase 3 WebSocket server for "You Are Not Alone".
// Refactor highlights:
//   - cleaner hub/client architecture
//   - validated inbound actions (anti-spoof + sanity checks)
//   - canonical action relay (server re-emits normalized JSON)
//   - immutable shared world payload in WELCOME

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

	// World dimensions
	worldTileW = 600
	worldTileH = 450
	tileSize   = 32
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

func initWorld() {
	tiles := make([]int, worldTileW*worldTileH)

	for x := 0; x < worldTileW; x++ {
		fx := float64(x) / float64(worldTileW)

		// Much flatter terrain with minimal variation.
		h := 0.42 +
			0.02*math.Sin(fx*2*math.Pi*1.5) +
			0.01*math.Sin(fx*2*math.Pi*3.0+1.5)

		surfaceY := max(int(h * float64(worldTileH)), 0)

		if surfaceY >= worldTileH {
			surfaceY = worldTileH - 1
		}

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
// Wire message types
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

// Inbound typed payloads (pointers allow strict "field required" checks).
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
	mu     sync.RWMutex
	conns  map[int]*Client
	nextID atomic.Int32
}

func NewHub() *Hub {
	return &Hub{
		conns: make(map[int]*Client),
	}
}

func (h *Hub) allocID() int {
	return int(h.nextID.Add(1)) - 1
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
// Validation / canonicalization
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

// -----------------------------------------------------------------------------
// WebSocket session handler
// -----------------------------------------------------------------------------

func handleWS(ws *websocket.Conn) {
	id := hub.allocID()
	color := playerColors[id%len(playerColors)]

	// Spawn around center with small horizontal spread.
	spawnTileX := worldTileW/2 + (rand.Intn(20) - 10)
	surfaceY := surfaceAt(spawnTileX)

	spawnX := float64(spawnTileX*tileSize) + float64(tileSize)/2
	// Keep center slightly above terrain top (half player height = 14px).
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

	// Writer goroutine (single owner of websocket writes).
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

	// WELCOME to self (single-recipient handshake).
	// Send directly to self (avoid accidental fanout by using channel directly).
	welcomeRaw, _ := json.Marshal(WelcomeMsg{
		Type:     "WELCOME",
		PlayerID: id,
		Color:    color,
		X:        spawnX,
		Y:        spawnY,
		Players:  others,
		World:    gameWorld,
	})
	c.send <- string(welcomeRaw)

	// SPAWN_PLAYER to others.
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

	// Cleanup
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

func handleInboundFromClient(c *Client, raw string) {
	var env inboundEnvelope
	if !decodeInbound(raw, &env) || env.Type == "" {
		log.Printf("warn: invalid envelope from player %d", c.id)
		return
	}

	switch env.Type {
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

		msg := MoveMsg{
			Type:     "MOVE",
			EntityID: c.id,
			DX:       clamp(*in.DX, -1, 1),
			DY:       0,
		}
		hub.broadcastJSON(msg, c.id)

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

		msg := JumpMsg{
			Type:     "JUMP",
			EntityID: c.id,
		}
		hub.broadcastJSON(msg, c.id)

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

		msg := JumpReleaseMsg{
			Type:     "JUMP_RELEASE",
			EntityID: c.id,
		}
		hub.broadcastJSON(msg, c.id)

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

		msg := PositionMsg{
			Type:     "POSITION",
			EntityID: c.id,
			X:        x,
			Y:        y,
			VX:       vx,
			VY:       vy,
		}
		hub.broadcastJSON(msg, c.id)

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

	default:
		// Ignore unknown messages (forward compatibility).
	}
}

// -----------------------------------------------------------------------------
// main
// -----------------------------------------------------------------------------

func main() {
	rand.Seed(time.Now().UnixNano())
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
