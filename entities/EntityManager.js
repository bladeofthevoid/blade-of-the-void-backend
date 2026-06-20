/**
 * entities/EntityManager.js
 * -----------------------------------------------------------------------
 * Owns the authoritative collection of every entity on the server
 * (players, and eventually enemies/projectiles). Nothing else in the
 * codebase should reach into a raw Map of entities directly -- always go
 * through this class, so the storage strategy can change later (e.g. to
 * spatial partitioning / chunking for large player counts) without
 * touching SimulationWorld, SnapshotManager, or server.js.
 * -----------------------------------------------------------------------
 */

class EntityManager {
  constructor() {
    /** @type {Map<string, Entity>} */
    this._entities = new Map();
  }

  addEntity(entity) {
    this._entities.set(entity.id, entity);
  }

  removeEntity(id) {
    this._entities.delete(id);
  }

  getEntity(id) {
    return this._entities.get(id);
  }

  getAllEntities() {
    return Array.from(this._entities.values());
  }

  getEntitiesByType(type) {
    return this.getAllEntities().filter((e) => e.type === type);
  }

  get count() {
    return this._entities.size;
  }

  /**
   * Per-tick hook for entities that drive their own behavior (future
   * Enemy AI, Projectile flight/lifetime). Currently every shipped entity
   * type (just Player) is moved exclusively by SimulationWorld using
   * network input, so this is a no-op in practice today -- but the hook
   * is here so that adding a self-updating entity type later is a change
   * confined to that entity's class, not to SimulationWorld.
   */
  update(dt) {
    for (const entity of this._entities.values()) {
      if (typeof entity.update === 'function') {
        entity.update(dt);
      }
    }
  }
}

module.exports = EntityManager;
