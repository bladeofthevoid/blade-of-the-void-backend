/**
 * world/SnapshotManager.js
 * -----------------------------------------------------------------------
 * Builds the payload broadcast to every client in ONE world at
 * SNAPSHOT_RATE (20Hz), which is intentionally a different rate than the
 * simulation's tick rate (30Hz, see World.js). The simulation can advance
 * fidelity independently of how often state actually goes over the wire.
 *
 * Snapshot shape (additions over the single-server foundation marked):
 *   {
 *     type: 'snapshot',
 *     tick: <this world's tick this snapshot was built at>,
 *     serverTime: <Date.now(), informational/debugging only>,
 *     serverId: <this server instance's id, e.g. 'FRA-01'>,        // NEW
 *     worldId: <this world's id, e.g. 'destination-001'>,          // NEW
 *     worldType: <'destination' | 'hunt' | ...>,                   // NEW
 *     capacity: <max players for this world>,                     // NEW
 *     tps: <measured simulation ticks/sec for this world>,         // NEW
 *     entities: [ Entity.serialize(), ... ],   // every entity's full state (now includes worldId per-entity, see entities/Entity.js)
 *     players: { [playerId]: { lastProcessedInputSeq } }
 *   }
 *
 * `players[id].lastProcessedInputSeq` is what lets each client's own
 * Predictor know which of its buffered inputs the server has already
 * incorporated, and therefore which it can stop replaying during
 * reconciliation (see index.html, Predictor.reconcile).
 *
 * Multi-instance note: one instance of this class now belongs to each
 * World (see World.js) instead of one per process -- a player only ever
 * receives entities from their own world, which is what "no shared
 * gameplay state" means at the wire-protocol level, not just in memory.
 * -----------------------------------------------------------------------
 */

const MessageTypes = require('../network/MessageTypes');

class SnapshotManager {
  /**
   * @param {EntityManager} entityManager
   * @param {World} world - back-reference for tick/id/type/capacity/tps.
   *   Kept as a loose duck-typed reference (just reads world.currentTick,
   *   world.id, etc.) rather than importing World.js, to avoid a circular
   *   require between World.js and SnapshotManager.js.
   */
  constructor(entityManager, world) {
    this.entityManager = entityManager;
    this.world = world;
  }

  buildSnapshot() {
    const entities = this.entityManager.getAllEntities().map((e) => e.serialize());

    const players = {};
    for (const player of this.entityManager.getEntitiesByType('player')) {
      players[player.id] = { lastProcessedInputSeq: player.lastProcessedInputSeq };
    }

    return {
      type: MessageTypes.S2C_SNAPSHOT,
      tick: this.world.currentTick,
      serverTime: Date.now(),
      serverId: this.world.serverId,
      worldId: this.world.id,
      worldType: this.world.type,
      capacity: this.world.settings.capacity,
      tps: this.world.measuredTps,
      entities,
      players,
    };
  }
}

module.exports = SnapshotManager;
