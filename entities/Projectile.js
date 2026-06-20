/**
 * entities/Projectile.js
 * -----------------------------------------------------------------------
 * Placeholder entity type for future ranged-combat objects (arrows,
 * thrown weapons, spell effects, etc). Same rationale as Enemy.js: no
 * combat logic lives here yet, but the type exists so the networking and
 * rendering pipeline already know how to carry and draw a fast-moving,
 * short-lived entity.
 *
 * Expected future expansion:
 *   - an update(dt) method (linear motion + lifetime expiry), invoked via
 *     the same EntityManager.update() hook Enemy will use
 *   - collision / hit-detection against Player and Enemy entities
 *   - an owner/source id so damage can be attributed
 * -----------------------------------------------------------------------
 */

const Entity = require('./Entity');

class Projectile extends Entity {
  constructor(id, spawnPosition, initialVelocity) {
    super(id, 'projectile');
    this.position = { ...spawnPosition };
    this.velocity = { ...initialVelocity };
  }
}

module.exports = Projectile;
