/**
 * network/MessageTypes.js
 * -----------------------------------------------------------------------
 * Every WebSocket message has a `type` field set to one of these strings.
 * Centralizing them here (and mirroring the same object literal in
 * index.html) avoids typo bugs like sending 'snapshot' on one side and
 * checking for 'snapshots' on the other.
 *
 * Naming convention: C2S_ = client-to-server, S2C_ = server-to-client.
 *
 * Multi-instance additions (gateway <-> client <-> world server):
 *   The original six message types (C2S_INPUT through S2C_PLAYER_LEFT)
 *   are byte-for-byte unchanged from the single-server foundation -- the
 *   world server's authoritative-movement protocol with an already
 *   connected client is untouched. Everything below GATEWAY/RECONNECT
 *   MESSAGES is new and only concerns the *handshake* that happens before
 *   (gateway assignment) or around (rejoin) that existing protocol.
 * -----------------------------------------------------------------------
 */

module.exports = {
  // --- Client -> Server (world) ------------------------------------------
  C2S_INPUT: 'input', // a single tick's worth of movement input
  C2S_PING: 'ping',   // latency probe, server echoes it back immediately

  // --- Server (world) -> Client --------------------------------------------------
  S2C_WELCOME: 'welcome',             // sent once, right after connecting
  S2C_SNAPSHOT: 'snapshot',           // periodic authoritative world state
  S2C_PONG: 'pong',                   // reply to C2S_PING
  S2C_PLAYER_JOINED: 'player_joined', // lightweight join notification
  S2C_PLAYER_LEFT: 'player_left',     // lightweight leave notification

  // --- Gateway -> Client ---------------------------------------------------
  C2S_REQUEST_WORLD: 'request_world', // optional first message: { worldType }
  S2C_REDIRECT: 'redirect',           // { serverId, worldId, worldType, wsUrl, tickRate }
  S2C_ASSIGNMENT_ERROR: 'assignment_error', // { reason } -- gateway couldn't place the player anywhere

  // --- World server -> Client: connection identity --------------------------
  // Sent immediately on socket open, BEFORE 'welcome'. Lets the client's
  // debug UI show which server/world it landed on even before the first
  // snapshot arrives, and carries the rejoin token used by C2S_REJOIN.
  S2C_CONNECTION_INFO: 'connection_info', // { serverId, worldId, worldType, tickRate, rejoinToken }

  // --- Client -> World server: reconnect ------------------------------------
  // NOTE: in this implementation, rejoin info travels as query params on
  // the WebSocket connection URL itself (?worldId=...&rejoinToken=...),
  // read by WorldServer.js at connect time -- BEFORE any message can be
  // sent or parsed. C2S_REJOIN is kept here for protocol documentation
  // / future use (e.g. a mid-session resync) but no code sends it today.
  C2S_REJOIN: 'rejoin',               // { worldId, rejoinToken } -- attempt to resume a recent session
  S2C_REJOIN_FAILED: 'rejoin_failed', // grace period expired / token unknown -- client should treat this as a fresh join
};
