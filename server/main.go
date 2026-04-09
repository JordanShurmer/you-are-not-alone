// main.go — Phase 2 WebSocket server for "You Are Not Alone".
//
// Responsibilities:
//   - Serve static game files from the project root (../ relative to this dir)
//   - Accept WebSocket connections at /ws
//   - Assign each player a unique integer ID and a colour
//   - Send WELCOME to the joining player with their info + a snapshot of
//     everyone already connected
//   - Broadcast SPAWN_PLAYER to all existing players when someone arrives
//   - Broadcast DESPAWN_PLAYER to everyone remaining when someone leaves
//   - Forward every other message (MOVE, POSITION) verbatim to all other
//     players so the client action queue receives remote events identically
//     to local keyboard events
//
// Run from the server/ directory:
//
//	go run main.go
//
// Then open http://localhost:8080 in your browser.
// Set PORT environment variable to override the default port.

package main

import (
	"encoding/json"
	"log"
	"math/rand"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/net/websocket"
)

// ---------------------------------------------------------------------------
// Constants & palette
// ---------------------------------------------------------------------------

const (
	canvasWidth  = 900.0
	canvasHeight = 600.0

	// sendBufSize is the number of outbound messages we'll buffer per player
	// before dropping. Large enough for a burst; small enough to fail fast.
	sendBufSize = 128
)

// playerColors is the cyclic colour palette assigned to players in join order.
// The first entry matches Phase 1's default blue so the experience feels
// continuous when you're the first (or only) player.
var playerColors = [...]string{
	"#4a9eff", // blue    (matches Phase 1 default)
	"#ff6b4a", // coral
	"#4aff8a", // mint
	"#ff4adb", // pink
	"#ffdd4a", // yellow
	"#c04aff", // violet
	"#4af0ff", // cyan
	"#ff9f4a", // amber
}

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

// Msg is a flexible JSON envelope for all server ↔ client messages.
// Using map[string]any avoids defining a struct per message type and lets us
// forward opaque client payloads without inspecting every field.
type Msg map[string]any

// PlayerSnapshot carries the state the server knows about a player, used when
// serialising the "players" array inside a WELCOME message.
type PlayerSnapshot struct {
	ID    int     `json:"id"`
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	Color string  `json:"color"`
}

// ---------------------------------------------------------------------------
// Conn — one live WebSocket connection / player
// ---------------------------------------------------------------------------

// Conn bundles the websocket, the player's current server-side state, and the
// outbound send channel that its dedicated sender goroutine drains.
type Conn struct {
	ws    *websocket.Conn
	id    int
	x, y  float64
	color string
	send  chan string // serialised JSON strings ready to write
}

// ---------------------------------------------------------------------------
// Hub — the central registry of all live connections
// ---------------------------------------------------------------------------

// hub is a package-level singleton.  We keep the lock, the map, and the ID
// counter together in an anonymous struct for clarity.
var hub struct {
	sync.RWMutex
	conns  map[int]*Conn
	nextID int32 // accessed via atomic ops
}

func init() {
	hub.conns = make(map[int]*Conn)
}

// allocID returns a unique, monotonically increasing player ID.
func allocID() int {
	return int(atomic.AddInt32(&hub.nextID, 1)) - 1
}

func addConn(c *Conn) {
	hub.Lock()
	hub.conns[c.id] = c
	hub.Unlock()
}

func removeConn(id int) {
	hub.Lock()
	delete(hub.conns, id)
	hub.Unlock()
}

func connCount() int {
	hub.RLock()
	defer hub.RUnlock()
	return len(hub.conns)
}

// snapshot returns a slice of every currently-connected player's state.
// Call this BEFORE addConn for the new joiner so they don't appear in their
// own "players" list.
func snapshot() []PlayerSnapshot {
	hub.RLock()
	defer hub.RUnlock()
	s := make([]PlayerSnapshot, 0, len(hub.conns))
	for _, c := range hub.conns {
		s = append(s, PlayerSnapshot{
			ID:    c.id,
			X:     c.x,
			Y:     c.y,
			Color: c.color,
		})
	}
	return s
}

// broadcast serialises and queues msg for every player except excludeID.
// The send is non-blocking: if a player's buffer is full we drop the message
// and log a warning rather than stalling every other player.
// Pass excludeID = -1 to broadcast to absolutely everyone.
func broadcast(msg string, excludeID int) {
	hub.RLock()
	defer hub.RUnlock()
	for id, c := range hub.conns {
		if id == excludeID {
			continue
		}
		select {
		case c.send <- msg:
		default:
			log.Printf("warn: dropped outbound message to player %d (buffer full)", id)
		}
	}
}

// updatePos stores the latest known position for a player so that new joiners
// receive an accurate snapshot rather than the spawn-time position.
func updatePos(id int, x, y float64) {
	hub.Lock()
	if c, ok := hub.conns[id]; ok {
		c.x, c.y = x, y
	}
	hub.Unlock()
}

// ---------------------------------------------------------------------------
// WebSocket handler — one goroutine per connection
// ---------------------------------------------------------------------------

func handleWS(ws *websocket.Conn) {
	// ── Assign identity ──────────────────────────────────────────────────────
	id := allocID()
	color := playerColors[id%len(playerColors)]

	// Spawn near the canvas centre with a small random spread so players
	// don't stack exactly on top of each other at the same moment.
	x := canvasWidth/2 + (rand.Float64()-0.5)*160
	y := canvasHeight/2 + (rand.Float64()-0.5)*80

	c := &Conn{
		ws:    ws,
		id:    id,
		x:     x,
		y:     y,
		color: color,
		send:  make(chan string, sendBufSize),
	}

	// Capture the existing player list BEFORE registering the new player.
	others := snapshot()
	addConn(c)

	log.Printf("+ player %d joined  color=%s  pos=(%.0f,%.0f)  online=%d",
		id, color, x, y, connCount())

	// ── WELCOME ──────────────────────────────────────────────────────────────
	// Sent only to the joining player; tells them their assigned ID, colour,
	// starting position, and the state of every player already in the game.
	welcome, _ := json.Marshal(Msg{
		"type":     "WELCOME",
		"playerId": id,
		"color":    color,
		"x":        x,
		"y":        y,
		"players":  others,
	})
	c.send <- string(welcome)

	// ── SPAWN_PLAYER ─────────────────────────────────────────────────────────
	// Broadcast to every *other* connected player so they add a new entity.
	spawn, _ := json.Marshal(Msg{
		"type":     "SPAWN_PLAYER",
		"playerId": id,
		"color":    color,
		"x":        x,
		"y":        y,
	})
	broadcast(string(spawn), id)

	// ── Sender goroutine ─────────────────────────────────────────────────────
	// Owns all writes to ws.  Drains c.send until the channel is closed.
	// We use a WaitGroup so we can guarantee the sender has finished before
	// handleWS returns and the websocket is torn down.
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for msg := range c.send {
			if err := websocket.Message.Send(ws, msg); err != nil {
				// Connection is gone; the receive loop below will also error
				// and trigger cleanup.
				log.Printf("send error player %d: %v", id, err)
				return
			}
		}
	}()

	// ── Receive loop ─────────────────────────────────────────────────────────
	// Blocks until the client disconnects or a read error occurs.
	for {
		var raw string
		if err := websocket.Message.Receive(ws, &raw); err != nil {
			// Normal close or network error — either way, we're done.
			break
		}

		var msg Msg
		if err := json.Unmarshal([]byte(raw), &msg); err != nil {
			log.Printf("invalid JSON from player %d: %v", id, err)
			continue
		}

		// Track position server-side so new joiners get an accurate snapshot.
		// All other message types are forwarded without inspection.
		if msgType, _ := msg["type"].(string); msgType == "POSITION" {
			if px, ok := msg["x"].(float64); ok {
				if py, ok := msg["y"].(float64); ok {
					updatePos(id, px, py)
				}
			}
		}

		// Forward the raw payload verbatim to all other players.
		// The client's action queue will treat it identically to a local event.
		broadcast(raw, id)
	}

	// ── Cleanup ───────────────────────────────────────────────────────────────
	removeConn(id)
	close(c.send) // signals the sender goroutine to exit after draining
	wg.Wait()     // wait for in-flight sends to complete before closing ws

	log.Printf("- player %d left  online=%d", id, connCount())

	// Notify every remaining player so they remove the departed entity.
	despawn, _ := json.Marshal(Msg{
		"type":     "DESPAWN_PLAYER",
		"playerId": id,
	})
	broadcast(string(despawn), -1)
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

func main() {
	rand.Seed(time.Now().UnixNano())

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Serve the game's static files (index.html, src/*.js) from the project
	// root, which is one directory above this server/ package.
	http.Handle("/", http.FileServer(http.Dir("../")))

	// WebSocket endpoint.
	// We supply a no-op Handshake to bypass the default same-origin check —
	// the server itself serves the page, so origins will always match in
	// normal use, but this avoids surprising failures during local development
	// with non-standard setups.
	http.Handle("/ws", websocket.Server{
		Handshake: func(_ *websocket.Config, _ *http.Request) error {
			return nil
		},
		Handler: handleWS,
	})

	log.Printf("game server ready  →  http://localhost:%s", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatal(err)
	}
}