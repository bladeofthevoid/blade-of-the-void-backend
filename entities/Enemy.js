/**
 * entities/Enemy.js
 * -----------------------------------------------------------------------
 * Placeholder entity type for future AI-driven combatants.
 *
 * Nothing spawns an Enemy yet, and none of the requested features
 * (combat, abilities, AI) are implemented here -- that's explicitly out
 * of scope for this foundation. This class exists purely so the rest of
 * the pipeline (EntityManager, SnapshotManager, the client's renderer)
 * already understands a non-player entity type before any AI logic is
 * written, which means adding real enemies later is additive instead of
 * requiring a refactor of the networking/snapshot layers.
 *
 * Expected future expansion:
 *   - an update(dt) method, called automatically by EntityManager.update()
 *     (the hook already exists, see EntityManager.js)
 *   - health / stagger / aggro state
 *   - a reference to a behavior/AI controller that decides movement input
 *     the same shape a Player's network input would have, so it can reuse
 *     MovementSystem.step() unchanged
 * -----------------------------------------------------------------------
 */

const Entity = require('./Entity');

class Enemy extends Entity {
  constructor(id, spawnPosition) {
    super(id, 'enemy');
    this.position = { ...spawnPosition };
  }
}

module.exports = Enemy;
