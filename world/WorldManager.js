/**
 * world/WorldManager.js
 * -----------------------------------------------------------------------
 * Owns every World hosted by ONE server-instance process. This is what
 * makes "each server instance may host multiple worlds" true in code --
 * there is exactly one WorldManager per WorldServer process, and it is
 * the only thing in the codebase allowed to create or destroy a World.
 *
 * Responsibilities (per the architecture brief):
 *   - createWorld({ type, capacity })
 *   - destroyWorld(id)
 *   - autoAssignPlayer(type) -- find (or create) a world of `type` with
 *     room, e.g. "Destination full -> create Destination-02"
 *   - capacity management (maxWorlds / maxPlayers / maxEntities) so one
 *     instance can't be overloaded
 *   - periodic GC of worlds that have been empty too long, so a world
 *     never lingers forever as dead weight ("prevent orphan worlds")
 *
 * This class never simulates gameplay itself -- it delegates every tick
 * to the World instances it holds (see world/SimulationLoop.js) and
 * never reaches into one World's state on behalf of another, preserving
 * isolation.
 * -----------------------------------------------------------------------
 */

const Config = require('../config/constants');
const World = require('./World');

class WorldManager {
  /**
   * @param {string} serverId - this server instance's id, e.g. 'FRA-01'
   * @param {object} [limits] - overrides for Config.SERVER_LIMITS
   * @param {PersistenceManager} [persistence]
   */
  constructor(serverId, limits, persistence) {
    this.serverId = serverId;
    this.limits = { ...Config.SERVER_LIMITS, ...limits };
    this.persistence = persistence || null;

    /** @type {Map<string, World>} worldId -> World */
    this.worlds = new Map();

    /** @type {Map<string, number>} worldType -> next numeric suffix to use */
    this._worldCounters = new Map();

    this._gcTimer = setInterval(
      () => this._sweepEmptyWorlds(),
      Config.RELIABILITY.WORLD_GC_SWEEP_INTERVAL_MS
    );
    this._rejoinGcTimer = setInterval(
      () => {
        for (const world of this.worlds.values()) world.gcExpiredRejoinSessions();
      },
      Config.RELIABILITY.WORLD_GC_SWEEP_INTERVAL_MS
    );
  }

  get totalPlayers() {
    let total = 0;
    for (const world of this.worlds.values()) total += world.playerCount;
    return total;
  }

  get totalWorlds() {
    return this.worlds.size;
  }

  /** True if this instance is already at its configured world or player ceiling. */
  get isAtCapacity() {
    return this.totalWorlds >= this.limits.MAX_WORLDS || this.totalPlayers >= this.limits.MAX_PLAYERS;
  }

  _nextWorldId(type) {
    const next = (this._worldCounters.get(type) || 0) + 1;
    this._worldCounters.set(type, next);
    // e.g. destination-001, hunt-004 -- zero-padded to 3 digits per the
    // server-identification convention in the architecture brief.
    return `${type}-${String(next).padStart(3, '0')}`;
  }

  /**
   * Creates a new, empty World of the given type on this instance.
   * Returns null (rather than throwing) if this instance is already at
   * MAX_WORLDS -- capacity enforcement is a normal, expected outcome
   * here, not an error condition, since callers (WorldServer's admin API,
   * autoAssignPlayer) are expected to handle "no room" gracefully.
   *
   * @param {object} opts
   * @param {string} opts.type - one of Config.WORLD_TYPES' keys
   * @param {number} [opts.capacity] - overrides the type's default capacity
   * @param {HookRegistry} [opts.hooks]
   */
  createWorld({ type, capacity, hooks } = {}) {
    const resolvedType = Config.WORLD_TYPES[type] ? type : Config.DEFAULT_WORLD_TYPE;
    if (this.totalWorlds >= this.limits.MAX_WORLDS) return null;

    const id = this._nextWorldId(resolvedType);
    const settings = capacity ? { capacity } : undefined;

    const world = new World({
      id,
      type: resolvedType,
      serverId: this.serverId,
      settings,
      hooks,
      persistence: this.persistence,
    });

    this.worlds.set(id, world);
    return world;
  }

  /** Destroys a world by id. Safe to call on an unknown id (no-op). */
  destroyWorld(id) {
    const world = this.worlds.get(id);
    if (!world) return false;
    world.destroy();
    this.worlds.delete(id);
    return true;
  }

  getWorld(id) {
    return this.worlds.get(id);
  }

  getAllWorlds() {
    return Array.from(this.worlds.values());
  }

  getWorldsByType(type) {
    return this.getAllWorlds().filter((w) => w.type === type);
  }

  /**
   * Finds a non-full world of `type` with room for one more player,
   * creating one if none exists and this instance has room to host it.
   * This is the "Destination full -> create Destination-02" behavior
   * from the architecture brief, scoped to worlds already living on THIS
   * instance. The gateway's AssignmentService is what decides *which
   * instance* to ask in the first place (see gateway/AssignmentService.js)
   * -- WorldManager only ever reasons about its own worlds.
   */
  autoAssignPlayer(type) {
    const resolvedType = Config.WORLD_TYPES[type] ? type : Config.DEFAULT_WORLD_TYPE;

    const candidate = this.getWorldsByType(resolvedType).find((w) => !w.isFull);
    if (candidate) return candidate;

    return this.createWorld({ type: resolvedType });
  }

  /** Compact status for the gateway heartbeat / local admin inspection. */
  serializeStatus() {
    return {
      serverId: this.serverId,
      maxWorlds: this.limits.MAX_WORLDS,
      maxPlayers: this.limits.MAX_PLAYERS,
      maxEntities: this.limits.MAX_ENTITIES,
      totalPlayers: this.totalPlayers,
      totalWorlds: this.totalWorlds,
      worlds: this.getAllWorlds().map((w) => w.serializeStatus()),
    };
  }

  /**
   * Destroys any world that has had zero players for longer than
   * RELIABILITY.EMPTY_WORLD_GC_MS. This is the "prevent orphan worlds"
   * requirement -- a world isn't kept alive just because it once existed.
   */
  _sweepEmptyWorlds() {
    const now = Date.now();
    for (const world of this.getAllWorlds()) {
      if (world.isEmpty && now - world.lastActivityAt > Config.RELIABILITY.EMPTY_WORLD_GC_MS) {
        this.destroyWorld(world.id);
      }
    }
  }

  /** Stops this manager's background timers. Used on graceful shutdown. */
  shutdown() {
    clearInterval(this._gcTimer);
    clearInterval(this._rejoinGcTimer);
  }
}

module.exports = WorldManager;
