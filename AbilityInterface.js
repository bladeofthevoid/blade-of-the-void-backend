/**
 * interfaces/AbilityInterface.js
 * -----------------------------------------------------------------------
 * NOT IMPLEMENTED. Documents the shape a future ability/skill system
 * would expose. Per project scope, abilities are explicitly excluded --
 * do not implement these methods.
 *
 * Expected future shape:
 *   class AbilitySystem {
 *     castAbility(player, abilityId, target) {}
 *     getCooldown(player, abilityId) {}
 *     onTick(world) {}   // would be wired into HookRegistry.onWorldUpdate
 *   }
 * -----------------------------------------------------------------------
 */

class AbilityInterface {
  castAbility(player, abilityId, target) {
    throw new Error('AbilityInterface.castAbility is not implemented (out of scope).');
  }
}

module.exports = AbilityInterface;
