/**
 * world/SimulationLoop.js
 * -----------------------------------------------------------------------
 * The authoritative tick loop for an entire server instance. Exactly the
 * pattern from the architecture brief:
 *
 *   for (world of worlds) {
 *     world.update()
 *   }
 *
 * ...run on a fixed interval (SERVER_TICK_RATE). This replaces the single
 * `setInterval(() => simulationWorld.tick(), ...)` loop that used to live
 * directly in server.js -- the only difference is it now iterates every
 * World a WorldManager is holding instead of ticking one global
 * simulation. Each World.update() call is fully self-contained (see
 * World.js); this loop does not, and must not, share any state between
 * worlds -- it is purely "for each world, advance it by one tick".
 * -----------------------------------------------------------------------
 */

const Config = require('../config/constants');

class SimulationLoop {
  /** @param {WorldManager} worldManager */
  constructor(worldManager) {
    this.worldManager = worldManager;
    this._timer = null;
  }

  start() {
    if (this._timer) return;
    const intervalMs = 1000 / Config.SERVER_TICK_RATE;
    this._timer = setInterval(() => this._tickAllWorlds(), intervalMs);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _tickAllWorlds() {
    for (const world of this.worldManager.getAllWorlds()) {
      world.update();
    }
  }
}

module.exports = SimulationLoop;
