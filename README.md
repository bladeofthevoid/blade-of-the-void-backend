# Blade of the Void — Multiplayer Foundation

A server-authoritative multiplayer browser game foundation -- third-person
WASD movement, client-side prediction, server reconciliation, and
snapshot interpolation -- expanded from a single-process prototype into a
**scalable multi-instance architecture**: a stateless Gateway that assigns
players to isolated game Worlds, hosted across any number of World Server
instances, each of which can host many Worlds at once.

No combat, no AI, no abilities, no inventory, no database -- still by
design. This is the netcode + infrastructure skeleton Fractura
Destinations, Hollow Hunts, Cleansings, Extractions, and PvP arenas get
built on top of later. See `MIGRATION.md` for exactly what changed from
the single-server prototype and why.

```
CLIENT
  │  (1. connect, optionally ?type=pvp)
  ▼
GATEWAY            -- registry + assignment only, never simulates gameplay
  │  (2. redirect: { serverId, worldId, wsUrl, tickRate })
  ▼
WORLD SERVER        -- one process, may host many Worlds
  │  (3. connect ?worldId=...)
  ▼
WORLD               -- fully isolated: own EntityManager, own SnapshotManager, own tick
```

## Running it

A gateway and at least one world server are both required -- the client
always goes through the gateway first.

```bash
npm install

# terminal 1
npm run gateway              # http://localhost:9000

# terminal 2
npm run world                # http://localhost:8080, registers itself with the gateway

# (optional) terminal 3 — a second instance, to see multi-instance load spreading
SERVER_ID=FRA-02 PORT=8081 npm run world
```

Then open **http://localhost:9000** (the gateway serves the page) in two
or more browser tabs. Add `?type=pvp` (or `hunt`/`cleansing`/`extraction`)
to the URL to request a specific world type; omitting it uses the
server's default (`destination`).

Controls: **WASD** to move, **left-click + drag** to orbit the camera,
**scroll** to zoom. The top-left HUD now shows which gateway/server/world
you landed on alongside the original ping/fps/correction readout.

`npm run dev:cluster` starts a gateway + two world servers together (via
`concurrently`) for quick local multi-instance testing.

## Project layout

```
gateway/                       accepts the FIRST connection, assigns a world, redirects. Never simulates.
  gateway.js                    entry point: HTTP (registration/heartbeat API) + WS (client assignment)
  WorldRegistry.js               bookkeeping: which server instances exist, what worlds/populations they report
  AssignmentService.js           placement decision: find room, or ask a server to create a new world

world/                          everything that actually simulates gameplay
  WorldServer.js                 entry point for ONE server instance (e.g. "FRA-01"); may host many Worlds
  WorldManager.js                 owns every World this instance hosts: create/destroy/auto-assign/capacity/GC
  World.js                        ONE isolated world: { id, type, players, entities, tick, settings }
  EntityManager.js                 per-world authoritative entity registry (moved from entities/, unchanged)
  SnapshotManager.js               per-world snapshot builder (moved from snapshots/, +worldId/serverId/tps)
  SimulationLoop.js                fixed-rate driver: `for (world of worlds) world.update()`

entities/                      entity *data* classes -- unchanged from the single-server foundation
  Entity.js                       base class (+worldId stamp, additive)
  Player.js                       + input queue, ack tracking, rejoin token
  Enemy.js / Projectile.js        structural stubs, still unimplemented

simulation/
  MovementSystem.js               pure, deterministic movement math -- byte-for-byte unchanged

network/
  MessageTypes.js                  wire-protocol constants (+ gateway/connection-info/rejoin additions)
  WebSocketServer.js                thin `ws` wrapper (+ connection-URL query parsing, + stale-connection sweep)

interfaces/                     hooks-only extensibility seams -- nothing implemented
  HookRegistry.js                  the no-op lifecycle hooks World.js actually calls
  CombatInterface.js, AbilityInterface.js, MissionInterface.js, LootInterface.js,
  EnemySystem.js, ProjectileSystem.js     documented future-system shapes, all throw if called

persistence/
  PersistenceManager.js            placeholder only -- no database, every method is a no-op

shared/                         small dependency-free helpers used by both gateway/ and world/
  httpJson.js                      POST-JSON / read-JSON-body / send-JSON over plain http
  staticServer.js                  serves index.html

config/
  constants.js                    tick rates, movement tuning, + WORLD_TYPES/SERVER_LIMITS/GATEWAY/RELIABILITY

index.html                      the entire client (no build step) -- see below

tests/                          self-contained Node scripts (no test framework), see tests/README.md
```

## How the multi-instance architecture fits together

### Gateway: registry + assignment, never gameplay
Every world server self-registers with the gateway on startup
(`POST /gateway/register`) and heartbeats its live population every few
seconds (`POST /gateway/heartbeat`). `WorldRegistry` is the gateway's only
state -- which servers exist, and what worlds/populations they last
reported. `AssignmentService` is the only thing that makes a placement
decision: look for an existing world of the requested type with room
(`WorldRegistry.findWorldWithCapacity`); if none exists, ask the
least-loaded eligible server to create one via its admin HTTP API
(`POST {adminUrl}/admin/worlds`) -- this is the literal
"Destination full → create Destination-02" behavior, just initiated by
whichever side actually has global visibility (the gateway), not any one
instance. The gateway never imports `World`, `EntityManager`, or
`MovementSystem` -- there is no tick loop anywhere in `gateway/`.

### World Server: many isolated Worlds per process
A `WorldServer` owns one `WorldManager`, which owns however many `World`
instances are currently live. `SimulationLoop` ticks every one of them at
a fixed rate (`for (world of worlds) world.update()`); each `World.update()`
only ever touches its own `EntityManager` -- there is no shared map, no
global entity list, anywhere a world could read another world's state.
Snapshots are broadcast the same way: a world's snapshot is sent only to
that world's own connected players (`wsServer.sendToMany`), never to the
whole instance.

### World transfer
1. Client opens a WS to the gateway (optionally `?type=pvp`).
2. Gateway sends exactly one message, `{ type: 'redirect', serverId,
   worldId, worldType, wsUrl, tickRate }`, then closes the socket itself.
3. Client opens a NEW WS directly to `${wsUrl}?worldId=${worldId}` -- this
   connection talks to the world server, never the gateway, for the rest
   of the session.
4. The world server's very first message back is `S2C_CONNECTION_INFO`
   (`{ serverId, worldId, worldType, tickRate, rejoinToken }`), sent
   *before* `S2C_WELCOME`, so the debug UI has identity info even before
   the first snapshot. `S2C_WELCOME` and everything after it is the
   original single-server protocol, untouched.

A `LoadingScreen` overlay (see `index.html`) covers steps 2–3; it's built
as a generic show/setMessage/hide component specifically so a future,
much slower loading sequence has somewhere to plug in without touching
any connection-handling code.

### Reliability
- **Heartbeat / timeout (server↔gateway):** a world server that stops
  heartbeating is evicted from the registry after
  `GATEWAY.SERVER_TIMEOUT_MS` -- the gateway simply stops assigning
  anyone to a dead instance's worlds.
- **Heartbeat / timeout (client↔world):** `WebSocketServer` tracks
  last-seen time per connection and terminates anything silent for
  `RELIABILITY.CONNECTION_TIMEOUT_MS`, catching drops that never fire a
  clean TCP close.
- **Reconnect:** every player gets a `rejoinToken` in `connection_info`.
  Disconnecting keeps their entity alive under that token for
  `RELIABILITY.REJOIN_GRACE_MS`; reconnecting with
  `?worldId=...&rejoinToken=...` resumes the *same* entity (position and
  all) under a brand-new connection id. The client (`NetworkManager` /
  `Game._handleWorldDisconnected`) retries directly against the same
  world a few times before falling all the way back to a fresh gateway
  assignment. See `tests/rejoin.smoke.test.js`.
- **World cleanup:** a world with zero players for
  `RELIABILITY.EMPTY_WORLD_GC_MS` is destroyed by `WorldManager`'s sweep
  -- worlds never linger as orphans just because they once existed.

### Extensibility (hooks only, nothing implemented)
`World.js` calls into a `HookRegistry` at well-defined lifecycle points
(`onWorldCreated`, `onWorldUpdate`, `onPlayerJoin/Leave`,
`onEntitySpawn/Remove`, `onWorldDestroy`) -- every method is a documented
no-op today. A future combat/AI/mission/loot/ability system subclasses
`HookRegistry` and overrides only what it needs; `World.js` itself never
has to change again. `interfaces/CombatInterface.js`,
`AbilityInterface.js`, `MissionInterface.js`, `LootInterface.js`,
`EnemySystem.js`, and `ProjectileSystem.js` document the *shape* those
future systems would take -- every method throws if actually called,
since none of this is implemented.

### Persistence (placeholder only)
`persistence/PersistenceManager.js` has no database -- every method is a
no-op. `World.removePlayer` already calls
`persistence.savePlayerState(...)` at exactly the point a real
implementation would need to; wiring a real database later is confined to
that one file.

## The original single-server netcode (unchanged)

1. **Client never sends position.** Every tick it sends a normalized
   movement *direction* plus a sequence number. The server is the only
   thing that ever computes a position (`simulation/MovementSystem.js`).
2. **Client predicts locally** by running the *exact same* movement math
   the server will run (`Predictor` in `index.html`).
3. **Each world ticks at 30Hz**, consuming exactly one queued input per
   player per tick (`World.update()`), regardless of when packets arrive.
4. **Each world broadcasts snapshots at 20Hz** (`world/SnapshotManager.js`)
   containing every entity's full state plus, per player, the input
   sequence number processed so far -- now also carrying `serverId`,
   `worldId`, `worldType`, `capacity`, and the measured `tps`.
5. **Client reconciles**: finds what it predicted at the acknowledged
   sequence, re-baselines on the authoritative result, replays every
   unconfirmed input.
6. **Remote players are never snapped** -- snapshots are buffered and
   interpolated (`Interpolator` in `index.html`).

## Debug overlay

```
Gateway:   connected
Server:    FRA-01
World:     destination-001 (destination)
Players:   3/24
Entities:  3
Ping:      24 ms
TPS:       30

fps:         60
server tick: 1842
correction:  0.012 m
```

## Extending this foundation

- **Combat / abilities / AI / missions / loot**: subclass
  `interfaces/HookRegistry.js` and pass an instance into
  `WorldManager.createWorld({ hooks })` -- see the header comment in that
  file for the exact shape. Don't bolt logic onto `World.js` directly.
- **Persistence**: implement the four methods in
  `persistence/PersistenceManager.js` against a real database; every call
  site that needs them already exists.
- **Many entities at once**: replace the per-entity `THREE.Mesh` in
  `EntityView` with `THREE.InstancedMesh`; nothing in `Interpolator`,
  `Predictor`, or `NetworkManager` needs to change.
- **A real multi-machine deployment**: set `PUBLIC_HOST` on each world
  server to its real reachable hostname/IP, and `GATEWAY_URL` on every
  world server to the gateway's real address. Nothing else changes.
