/**
 * player/LocomotionController.js
 * -----------------------------------------------------------------------
 * Locomotion state machine.
 *
 * Reads speed + input presence each fixed tick and maintains:
 *   - current locomotion phase (LocomotionPhase enum value)
 *   - blend weight (0 = fully prev state, 1 = fully current state)
 *   - time-in-phase counter
 *
 * Does NOT own physics. Does NOT modify velocity. Pure classify + track.
 *
 * Hysteresis rationale:
 *   Without minimum-time guards, a player walking exactly at the
 *   DRIFT_MAX threshold would oscillate between DRIFT and RUN every
 *   other frame. MIN_IN_* values create dead-zones that prevent this
 *   without adding perceptible lag to intentional transitions.
 *
 * Future extension points:
 *   - JUMP_START / JUMP / FALL / LAND: add a jumpPressed flag input and
 *     branch before the speed classification in update().
 *   - DODGE:  inject a dodgeConsumed flag; guard it the same way.
 *   - Lock-on strafing: only affects which animation plays, not which
 *     phase the controller reports — add a separate isStrafeActive flag.
 * -----------------------------------------------------------------------
 */

import { LocomotionPhase, PhaseThresholds, AnimConfig } from './MovementConfig.js';

export class LocomotionController {
  constructor() {
    /** @type {string} Current canonical locomotion phase */
    this.phase       = LocomotionPhase.IDLE;

    /** @type {string} Phase we were in before the most recent transition */
    this.prevPhase   = LocomotionPhase.IDLE;

    /**
     * 0 = fully in prevPhase  →  1 = fully in phase.
     * AnimationGraph reads this to blend between the two states.
     */
    this.blendWeight    = 1.0;
    this.blendDuration  = AnimConfig.BLEND_IDLE_IN;

    /** Accumulated time (seconds) spent in the current phase. */
    this.timeInPhase = 0;

    /** Smoothed normalised speed (0–1) — lags slightly to avoid jitter. */
    this.smoothNorm  = 0;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Advance the state machine one tick.
   *
   * @param {number}  speed     Horizontal speed in m/s (Math.hypot(vx, vz))
   * @param {number}  maxSpeed  Server MAX_SPEED — used to normalise speed
   * @param {boolean} hasInput  True while movement keys are held
   * @param {number}  dt        Fixed-tick delta (seconds)
   */
  update(speed, maxSpeed, hasInput, dt) {
    this.timeInPhase += dt;

    // Lightly smooth the normalised speed to soften threshold crossings.
    const raw        = maxSpeed > 0 ? speed / maxSpeed : 0;
    this.smoothNorm  = this.smoothNorm + (raw - this.smoothNorm) * Math.min(1, dt * 12);

    const desired = this._classify(this.smoothNorm, hasInput);

    if (desired !== this.phase && this._canTransition(desired)) {
      this._transition(desired);
    }

    // Advance blend toward 1
    if (this.blendWeight < 1.0) {
      this.blendWeight = Math.min(
        1.0,
        this.blendWeight + dt / Math.max(this.blendDuration, 0.001)
      );
    }
  }

  /**
   * One-word debug string e.g. "run (72% ←breakstride)"
   * @returns {string}
   */
  debugString() {
    const pct = Math.round(this.blendWeight * 100);
    if (pct < 100 && this.prevPhase !== this.phase) {
      return `${this.phase} (${pct}% ←${this.prevPhase})`;
    }
    return this.phase;
  }

  // ── Private ─────────────────────────────────────────────────────────────

  /**
   * Classify desired phase from smoothed normalised speed and input state.
   * @param {number}  norm      Smoothed speed fraction (0–1)
   * @param {boolean} hasInput
   * @returns {string}
   */
  _classify(norm, hasInput) {
    if (!hasInput && norm <= PhaseThresholds.IDLE_MAX) return LocomotionPhase.IDLE;
    if (norm <= PhaseThresholds.DRIFT_MAX)             return LocomotionPhase.DRIFT;
    if (norm <= PhaseThresholds.RUN_MAX)               return LocomotionPhase.RUN;
    return LocomotionPhase.BREAKSTRIDE;
  }

  /**
   * Hysteresis guard — enforce minimum time in current phase before
   * allowing a transition. Prevents threshold-boundary flickering.
   * @param {string} desired  The phase we want to move to
   * @returns {boolean}
   */
  _canTransition(desired) {
    const mins = {
      [LocomotionPhase.IDLE]:        AnimConfig.MIN_IN_IDLE,
      [LocomotionPhase.DRIFT]:       AnimConfig.MIN_IN_DRIFT,
      [LocomotionPhase.RUN]:         AnimConfig.MIN_IN_RUN,
      [LocomotionPhase.BREAKSTRIDE]: AnimConfig.MIN_IN_BREAKSTRIDE,
    };
    return this.timeInPhase >= (mins[this.phase] ?? 0.05);
  }

  /**
   * Execute a state transition, resetting the blend weight so the
   * AnimationGraph blends from the previous state pose.
   * @param {string} newPhase
   */
  _transition(newPhase) {
    this.prevPhase     = this.phase;
    this.phase         = newPhase;
    this.timeInPhase   = 0;
    this.blendWeight   = 0;
    this.blendDuration = this._blendDuration(newPhase);
  }

  /**
   * Blend duration for entering the given phase.
   * @param {string} phase
   * @returns {number} seconds
   */
  _blendDuration(phase) {
    return {
      [LocomotionPhase.IDLE]:        AnimConfig.BLEND_IDLE_IN,
      [LocomotionPhase.DRIFT]:       AnimConfig.BLEND_DRIFT_IN,
      [LocomotionPhase.RUN]:         AnimConfig.BLEND_RUN_IN,
      [LocomotionPhase.BREAKSTRIDE]: AnimConfig.BLEND_BREAKSTRIDE_IN,
    }[phase] ?? 0.15;
  }
}
