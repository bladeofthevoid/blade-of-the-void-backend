/**
 * entities/Player.js
 * -----------------------------------------------------------------------
 * A player-controlled entity. Adds exactly the state the simulation and
 * reconciliation protocol need on top of the base Entity:
 *
 *   - inputQueue: input commands received from this player's client,
 *     waiting to be consumed one-per-tick by SimulationWorld. Buffering
 *     inputs (rather than applying them the instant they arrive) is what
 *     makes the simulation tick-rate the source of truth for movement,
 *     independent of exactly when packets happen to arrive.
 *
 *   - lastProcessedInputSeq: the sequence number of the most recent input
 *     this player's movement has actually incorporated. Echoed back to
 *     the client in every snapshot so it knows which of its predicted
 *     inputs are now confirmed and can be dropped from its own replay
 *     buffer (see index.html's Predictor.reconcile).
 * -----------------------------------------------------------------------
 */

const Entity = require('./Entity');

class Player extends Entity {
  constructor(id, spawnPosition) {
    super(id, 'player');
    this.position = { ...spawnPosition };

    this.inputQueue = [];
    this.lastProcessedInputSeq = 0;

    // Free-form slot for future per-player combat state (health, stamina,
    // lock-on target, combo state, ...). Left empty deliberately -- this
    // project's scope explicitly excludes combat, but the field exists so
    // that feature can be added without restructuring Player itself.
    this.combat = null;
  }
}

module.exports = Player;
