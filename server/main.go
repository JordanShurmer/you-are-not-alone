// main.go — Phase 3 WebSocket server for "You Are Not Alone".
//
// New in Phase 3:
//   - Procedural world generation (2-D heightmap, dirt + stone layers)
//   - World is generated once at startup; all players share the same terrain.
//   - WELCOME now carries the world grid so clients can build the tile map.
//   - Players spawn on the terrain surface instead of at the canvas centre.

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

// ---------------------------------------------------------------------------
// Constants & palette
// ---------------------------------------------------------------------------

const (
	sendBufSize = 256

	// Tile types
	tileAir   = 0
	tileDirt   = 1
	tileStone  = 2

	// World size (tiles)
	worldTileW = 200
	worldTileH = 60
	tileSize   = 32 // pixels per tile
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

// ---------------------------------------------------------------------------
// World generation
// ---------------------------------------------------------------------------

// WorldData is the immutable terrain grid broadcast to every joining player.
type WorldData struct {
	Width    int   `json:"width"`
	Height   int   `json:"height"`
	TileSize int   `json:"tileSize"`
	Tiles    []int `json:"tiles"` // row-major; 0=air 1=dirt 2=stone
}

// gameWorld is generated once in main() and never mutated afterwards.
var gameWorld *WorldData

// initWorld builds a rolling 2-D heightmap from layered sine waves.
func initWorld() {
	tiles := make([]int, worldTileW*worldTileH)

	for x := 0; x < worldTileW; x++ {
		fx := float64(x) / float64(worldTileW)

		// Four harmonics → gently varied, never perfectly flat terrain.
		h := 0.42 +
			0.09*math.Sin(fx*2*math.Pi*3.0) +
			0.06*math.Sin(fx*2*math.Pi*7.0+1.5) +
			0.03*math.Sin(fx*2*math.Pi*13.0+0.7) +
			0.02*math.Sin(fx*2*math.Pi*23.0+2.1)

		surfaceY := int(h * float64(worldTileH))

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

// surfaceAt returns the tile-Y of the topmost solid tile in column tx.
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

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

// Msg is a flexible JSON envelope for all server ↔ client messages.
type Msg map[string]any

// PlayerSnapshot carries a player's last-known state for WELCOME.
type PlayerSnapshot struct {
	ID    int     `json:"id"`
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	Color string  `json:"color"`
}

// ---------------------------------------------------------------------------
// Conn — one live WebSocket connection / player
// ---------------------------------------------------------------------------

type Conn struct {
	ws    *websocket.Conn
	id    int
	x, y  float64
	color string
	send  chan string
}

// ---------------------------------------------------------------------------
// Hub
// ---------------------------------------------------------------------------

var hub struct {
	sync.RWMutex
	conns  map[int]*Conn
	nextID int32
}

func init() { hub.conns = make(map[int]*Conn) }

func allocID() int { return int(atomic.AddInt32(&hub.nextID, 1)) - 1 }

func addConn(c *Conn)   { hub.Lock(); hub.conns[c.id] = c; hub.Unlock() }
func removeConn(id int) { hub.Lock(); delete(hub.conns, id); hub.Unlock() }
func connCount() int    { hub.RLock(); defer hub.RUnlock(); return len(hub.conns) }

func snapshot() []PlayerSnapshot {
	hub.RLock()
	defer hub.RUnlock()
	s := make([]PlayerSnapshot, 0, len(hub.conns))
	for _, c := range hub.conns {
		s = append(s, PlayerSnapshot{ID: c.id, X: c.x, Y: c.y, Color: c.color})
	}
	return s
}

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
			log.Printf("warn: dropped message to player %d (buffer full)", id)
		}
	}
}

func updatePos(id int, x, y float64) {
	hub.Lock()
	if c, ok := hub.conns[id]; ok {
		c.x, c.y = x, y
	}
	hub.Unlock()
}

// ---------------------------------------------------------------------------
// WebSocket handler
// ---------------------------------------------------------------------------

func handleWS(ws *websocket.Conn) {
	id    := allocID()
	color := playerColors[id%len(playerColors)]

	// Spawn near the world centre, on the terrain surface.
	// ±10 tile spread so simultaneous joins don't stack exactly.
	spawnTileX := worldTileW/2 + (rand.Intn(20) - 10)
	surfaceY   := surfaceAt(spawnTileX)
	x := float64(spawnTileX*tileSize) + float64(tileSize)/2
	// Centre 24 px above the surface so the player isn't initially embedded.
	y := float64(surfaceY*tileSize) - 24.0

	c := &Conn{
		ws:    ws,
		id:    id,
		x:     x,
		y:     y,
		color: color,
		send:  make(chan string, sendBufSize),
	}

	others := snapshot()
	addConn(c)

	log.Printf("+ player %d joined  color=%s  pos=(%.0f,%.0f)  online=%d",
		id, color, x, y, connCount())

	// WELCOME — includes the immutable world grid.
	welcome, _ := json.Marshal(Msg{
		"type":     "WELCOME",
		"playerId": id,
		"color":    color,
		"x":        x,
		"y":        y,
		"players":  others,
		"world":    gameWorld,
	})
	c.send <- string(welcome)

	// SPAWN_PLAYER to everyone already connected.
	spawn, _ := json.Marshal(Msg{
		"type":     "SPAWN_PLAYER",
		"playerId": id,
		"color":    color,
		"x":        x,
		"y":        y,
	})
	broadcast(string(spawn), id)

	// Sender goroutine — owns all writes to ws.
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for msg := range c.send {
			if err := websocket.Message.Send(ws, msg); err != nil {
				log.Printf("send error player %d: %v", id, err)
				return
			}
		}
	}()

	// Receive loop.
	for {
		var raw string
		if err := websocket.Message.Receive(ws, &raw); err != nil {
			break
		}

		var msg Msg
		if err := json.Unmarshal([]byte(raw), &msg); err != nil {
			log.Printf("invalid JSON from player %d: %v", id, err)
			continue
		}

		if msgType, _ := msg["type"].(string); msgType == "POSITION" {
			if px, ok := msg["x"].(float64); ok {
				if py, ok := msg["y"].(float64); ok {
					updatePos(id, px, py)
				}
			}
		}

		broadcast(raw, id)
	}

	// Cleanup.
	removeConn(id)
	close(c.send)
	wg.Wait()

	log.Printf("- player %d left  online=%d", id, connCount())

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

	initWorld()
	log.Printf("world: %dx%d tiles  (%d×%d px)",
		worldTileW, worldTileH, worldTileW*tileSize, worldTileH*tileSize)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	http.Handle("/", http.FileServer(http.Dir("../")))
	http.Handle("/ws", websocket.Server{
		Handshake: func(_ *websocket.Config, _ *http.Request) error { return nil },
		Handler:   handleWS,
	})

	log.Printf("game server ready  →  http://localhost:%s", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatal(err)
	}
}
