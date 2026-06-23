/**
 * persistence/PersistenceManager.js
 * -----------------------------------------------------------------------
 * NOT IMPLEMENTED. No database exists in this project, by design. This
 * class exists purely as the interface future persistence would plug
 * into, and as a documented set of call sites (see World.js and
 * world/WorldManager.js, search "persistence.") where those calls would
 * be made -- every method below is a no-op today.
 *
 * Why a no-op class instead of nothing at all:
 *   World.js and WorldManager.js already call persistence.save*()/load*()
 *   at the points where a real implementation would need to (player
 *   leave, world destroy, player join). Wiring those call sites now,
 *   against a no-op, means adding a real database later is a change
 *   confined to this one file -- nothing in World.js, WorldManager.js, or
 *   WorldServer.js needs to change.
 *
 * Expected future shape (illustrative, not implemented):
 *   class PersistenceManager {
 *     async savePlayerState(playerId, state) { await db.players.upsert(...); }
 *     async loadPlayerState(playerId) { return db.players.findOne(...); }
 *     async saveWorldState(worldId, state) { await db.worlds.upsert(...); }
 *   }
 * -----------------------------------------------------------------------
 */

class PersistenceManager {
  /** Would persist one player's entity/progression state. No-op today. */
  async savePlayerState(playerId, state) {
    return null;
  }

  /** Would load a previously-persisted player state, if any. Always null today. */
  async loadPlayerState(playerId) {
    return null;
  }

  /** Would persist whole-world state (e.g. mission progress). No-op today. */
  async saveWorldState(worldId, state) {
    return null;
  }

  /** Would load previously-persisted world state, if any. Always null today. */
  async loadWorldState(worldId) {
    return null;
  }
}

module.exports = PersistenceManager;
