# Migration Notes — Single Server → Gateway + Multi-Instance World Servers

This document is the precise diff between "what existed before" and "what
exists now": which files moved, which were retired, which are genuinely
new, and which were left completely untouched. If you have anything built
against the old single-server foundation, this is the file to read before
upgrading it.

## TL;DR

- **Nothing about movement, prediction, reconciliation, or interpolation
  changed.** `simulation/MovementSystem.js` is byte-for-byte identical.
  The client's `Predictor`/`Interpolator`/`EntityView`/`ClientEntityManager`
  classes are untouched.
- **`server.js` is gone**, replaced by `world/WorldServer.js` +
  `world/WorldManager.js` + `world/SimulationLoop.js`. Its responsibilities
  were split apart, not rewritten -- see the mapping table below.
- **A new process type exists**: the gateway (`gateway/gateway.js`). Every
  deployment now needs at least one gateway and at least one world server,
  instead of just one server.
- **The client no longer connects directly to a hardcoded backend URL.**
  It always goes through the gateway first. If you had
  `HARDCODED_SERVER_URL` set to a real backend, that needs to become a
  gateway URL instead (`HARDCODED_GATEWAY_URL`), and that backend needs to
  actually run as a gateway + ≥1 world server.

## File-by-file mapping

| Old file | New location | What happened |
|---|---|---|
| `server.js` | `world/WorldServer.js`, `world/WorldManager.js`, `world/SimulationLoop.js` | Decomposed. The HTTP/WS wiring and per-connection handlers became `WorldServer.js`; "which world does this connection belong to, and how many worlds exist" became `WorldManager.js`; the `setInterval(() => sim.tick(), ...)` loop became `SimulationLoop.js`. |
| `entities/EntityManager.js` | `world/EntityManager.js` | Moved, logic **unchanged**. Used to be one global instance; now one instance per `World` (this is what makes worlds isolated). |
| `snapshots/SnapshotManager.js` | `world/SnapshotManager.js` | Moved + extended. Snapshot shape gained `serverId`, `worldId`, `worldType`, `capacity`, `tps`. Everything else (`tick`, `entities`, `players[].lastProcessedInputSeq`) is unchanged. |
| `simulation/SimulationWorld.js` | `world/World.js` (`update()` method) | **Retired as a standalone file.** Its per-tick movement-consumption loop now lives in `World.update()`, scoped to one world's players instead of a single global list. The actual math it calls (`MovementSystem.step`) is unchanged. |
| `simulation/MovementSystem.js` | unchanged, same path | Not touched at all. |
| `entities/Entity.js` | unchanged path | One additive field: `worldId` (set once, by `World`, never mutated), included in `serialize()`. |
| `entities/Player.js` | unchanged path | One additive field: `rejoinToken` (used by the new reconnect flow). |
| `entities/Enemy.js`, `entities/Projectile.js` | unchanged | Not touched. Still unimplemented stubs, as before. |
| `network/MessageTypes.js` | unchanged path | Additive only: `S2C_REDIRECT`, `S2C_ASSIGNMENT_ERROR`, `S2C_CONNECTION_INFO`, `C2S_REJOIN` (reserved, see below), `S2C_REJOIN_FAILED`. All six original message types are untouched. |
| `network/WebSocketServer.js` | unchanged path | Additive only: `onConnect` now also receives the connection URL's parsed query string (`{worldId, type, rejoinToken}`), and a periodic stale-connection sweep was added. `send`/`broadcast`/the wire format are untouched; `sendToMany` was added (broadcast to a subset of clients, needed so a world's snapshot doesn't go to other worlds' players on the same instance). |
| *(nothing)* | `gateway/gateway.js`, `gateway/WorldRegistry.js`, `gateway/AssignmentService.js` | New. |
| *(nothing)* | `world/World.js`, `world/WorldManager.js`, `world/SimulationLoop.js` | New (see `server.js` row above for what they replaced). |
| *(nothing)* | `interfaces/*` | New. Hooks/interfaces only, nothing implemented. |
| *(nothing)* | `persistence/PersistenceManager.js` | New. Placeholder only, no database. |
| *(nothing)* | `shared/httpJson.js`, `shared/staticServer.js` | New. Small helpers shared by `gateway/` and `world/` so they don't each duplicate the same `http` boilerplate. |
| `index.html` | unchanged path | See "Client changes" below -- this is the one file with substantial, though still additive, changes. |

## Client changes (`index.html`)

Everything under `MovementSystem`, `InputManager`, `CameraController`,
`EntityView`, `ClientEntityManager`, `EntityInterpolationBuffer`,
`Interpolator`, `Predictor`, and the render/fixed-timestep loop in `Game`
is **unchanged**. What changed:

1. **`HARDCODED_SERVER_URL` → `HARDCODED_GATEWAY_URL`.** The client now
   always connects to a gateway first; there is no longer a concept of
   connecting directly to "the" backend. If your deployment hardcoded a
   specific backend URL before, point that constant at your gateway's URL
   instead (or leave it blank to use the same origin the page was served
   from -- the normal case, since the gateway serves `index.html`).
2. **`NetworkManager.connect(url)` → `connectToGateway()` /
   `connectToWorld()`.** Two explicit phases instead of one. The message
   switch gained cases for `S2C_REDIRECT`, `S2C_ASSIGNMENT_ERROR`,
   `S2C_CONNECTION_INFO`, and `S2C_REJOIN_FAILED`; the original cases
   (`S2C_WELCOME`, `S2C_SNAPSHOT`, `S2C_PLAYER_JOINED`,
   `S2C_PLAYER_LEFT`, `S2C_PONG`) are untouched. A new
   `onWorldDisconnected` hook fires only when the **world** connection
   drops unexpectedly -- never for the gateway's own intentional
   post-redirect close.
3. **`Game` gained a small connection-stage state machine**
   (`CONNECTING_GATEWAY` → `CONNECTING_WORLD` → `IN_WORLD`, plus
   `RECONNECTING`/`ERROR`) and a `LoadingScreen` overlay component for it.
   `start()` now kicks off `connectToGateway()` instead of calling
   `connect()` on a hardcoded URL.
4. **`Game._resetForNewWorld()`** is new, called at the top of every
   `_handleWelcome`. It disposes every `EntityView`, replaces the
   `Interpolator`, and clears the `Predictor` -- this is the client-side
   half of world isolation: a transfer (or a reconnect that happens to
   land in a different world) can never render an entity left over from
   the previous world. Nothing about *how* an `EntityView` is created,
   disposed, or rendered changed -- only *when* a batch of them gets
   cleared.
5. **`Game._handleWorldDisconnected()`** is new: a few direct reconnect
   attempts against the same world (using the remembered `rejoinToken`)
   with exponential backoff, then falls back to a fresh
   `connectToGateway()` call if those are exhausted.
6. **`DebugUI`** gained the gateway/server/world/capacity/entity/tps
   fields; the original ping/tick/fps/correction lines are still there,
   unchanged, just appended below the new ones.

`C2S_REJOIN` is defined in `MessageTypes` on both sides for protocol
documentation completeness, but nothing actually sends it as a runtime
message -- rejoin info travels as query parameters on the WebSocket
connection URL itself (`?worldId=...&rejoinToken=...`), because the
server needs to resolve it before it can process any message at all. If
you're integrating a different client, use the query-string form, not a
`C2S_REJOIN` message.

## Deployment changes

**Before:** one process, one port, `npm start`.

**Now:** at minimum, one gateway process + one world-server process, on
two different ports. They find each other over plain HTTP
(`GATEWAY_URL` env var on the world server side); neither hardcodes the
other's identity beyond that URL.

```bash
node gateway/gateway.js                                   # GATEWAY_PORT (default 9000)
SERVER_ID=FRA-01 PORT=8080 GATEWAY_URL=http://localhost:9000 node world/WorldServer.js
```

Scaling out is "start another world server with a different `SERVER_ID`
and `PORT`, pointed at the same `GATEWAY_URL`" -- nothing about the
gateway or any existing world server needs to change or restart.
`PUBLIC_HOST` should be set to each world server's real reachable
hostname once this is running across more than one machine (it defaults
to `localhost`, which only works when the gateway and world server share
a machine, since `wsUrl` is what gets handed to a remote client's browser).

## What did NOT change (by explicit project requirement)

- No combat, AI, abilities, inventory, matchmaking UI, or database were
  added. Every relevant extension point is a documented no-op/throwing
  stub (`interfaces/`, `persistence/PersistenceManager.js`).
- No change to the Three.js scene graph, camera, lighting, or ground
  setup beyond what was already rebuilt once `WorldBounds` arrives from
  the server (pre-existing behavior, unchanged).
- The wire format for the core gameplay messages
  (`input`/`welcome`/`snapshot`/`ping`/`pong`/`player_joined`/`player_left`)
  is unchanged; only new, additional message types and fields were
  introduced.

## Deploying to Render (backend) + GitHub Pages (frontend)

This is a fully supported split-hosting setup, but it requires three
things this codebase didn't originally handle, because they only matter
once something runs behind a TLS-terminating host instead of on bare
localhost ports. All three are already fixed in this codebase:

1. **The gateway must bind to Render's `PORT`.** Render injects `PORT`
   (default `10000`) and expects your process to bind to it;
   `config/constants.js`'s `GATEWAY.PORT` now reads `PORT` first, falling
   back to the local-dev-only `GATEWAY_PORT` / `9000`. (`world/WorldServer.js`
   already read `PORT` directly — only the gateway needed this fix.)
2. **Server-to-server calls must support `https://`.** Render's public
   URLs are HTTPS-only with no port in them. `shared/httpJson.js`'s
   `postJson` now dispatches to Node's `https` module (and the correct
   default port, 443) for `https://` URLs instead of always using `http`.
3. **A world server's advertised URL must not include its internal
   port.** `https://yourservice.onrender.com` is what's externally
   reachable — `PORT` is only what Render forwards to *internally*.
   `world/WorldServer.js` now builds its advertised admin/WS base URL from
   `RENDER_EXTERNAL_URL` (which Render sets automatically) instead of
   always assuming `host:PORT` is publicly reachable.

### Steps

1. **Push this repo to GitHub** (if it isn't already).
2. **Deploy the backend on Render** — either:
   - **Blueprint (recommended):** in the Render Dashboard, **New +** →
     **Blueprint** → select this repo. `render.yaml` at the repo root
     creates both `blade-gateway` and `blade-world-fra-01` as web
     services and wires `GATEWAY_URL` between them automatically.
   - **Manual:** create two separate Web Services from the same repo:
     - *Gateway*: Build Command `npm install`, Start Command
       `npm run gateway`. No environment variables required.
     - *World server*: Build Command `npm install`, Start Command
       `npm run world`. Set `SERVER_ID` (e.g. `FRA-01`) and `GATEWAY_URL`
       to the gateway service's public URL (e.g.
       `https://blade-gateway.onrender.com`) once it's deployed.
3. **Note the gateway's public URL** (`https://blade-gateway.onrender.com`).
4. **Point GitHub Pages at it.** In `index.html`, set:
   ```js
   const HARDCODED_GATEWAY_URL = 'wss://blade-gateway.onrender.com';
   ```
   Use `wss://`, not `https://` — this is a WebSocket URL, and it must be
   secure (`wss`, not `ws`) because a page served over HTTPS (which
   GitHub Pages always is) will refuse to open an insecure WebSocket to
   it (mixed-content blocking). Commit and push; GitHub Pages redeploys
   automatically.
5. **Open your GitHub Pages URL.** The client connects to the gateway,
   gets redirected to the world server, and you're playing.

### Things to expect on Render's free tier

- **Cold starts.** A free web service spins down after 15 minutes
  with no inbound traffic and takes about a minute to wake back up on
  the next connection or HTTP request. The first player after a quiet
  period will see the loading screen sit for longer than usual; this is
  Render waking the service up, not a bug. Upgrade to a paid instance
  type for an always-on deployment.
- **Independent spin-down.** The gateway and each world server spin down
  independently. World servers already retry registration/heartbeats on
  a timer and treat failures as non-fatal, so a sleeping gateway waking
  back up mid-session doesn't crash anything — a heartbeat just succeeds
  again once it's awake.
- **Scaling out.** Add another world server by creating one more Render
  web service (Start Command `npm run world`, a different `SERVER_ID`,
  the same `GATEWAY_URL`). Nothing about the gateway or any existing
  world server needs to change.
- **Going further (optional):** if you put the gateway on a paid plan,
  world servers can reach it over Render's private network instead of
  the public internet (faster, free, doesn't count toward bandwidth) by
  setting `GATEWAY_URL` to the gateway's internal `hostport` instead of
  its public URL. The world server's own advertised `wsUrl` (what
  browsers connect to) must stay public regardless, since browsers are
  never on Render's private network.



`tests/run-all.sh` runs the full suite (unit tests with no server needed,
plus end-to-end smoke tests against a real gateway + world server) and
exits non-zero on any failure. Run it after pulling this change before
assuming a deployment is healthy.
