/**
 * player/Animator.js
 * -----------------------------------------------------------------------
 * Drives the Dead Star character mesh joints each render frame.
 *
 * Responsibilities:
 *   1. Own an AnimationGraph populated with locomotion states (idle,
 *      drift, run, breakstride).
 *   2. Advance the shared walk-cycle phase in sync with actual speed.
 *   3. Maintain the head's continuous Y-spin independently of pose
 *      updates (so transitions never cause a spin-speed jump).
 *   4. Write joint rotations / scales via _applyPose() — all writes
 *      are absolute (SET, never accumulate) so every frame is a clean
 *      state regardless of previous values.
 *
 * Joint contract (mesh._joints must contain):
 *   root           — root group for whole-body lean
 *   chest          — chest group for breathing / bounce scale
 *   head           — head group (Y spin preserved; X tilt written here)
 *   leftShoulder,  rightShoulder
 *   leftHip,       rightHip
 *   leftKnee,      rightKnee
 *
 * Future extensions:
 *   - Attacks: call graph.transitionTo('attack_light') from combat code.
 *     The graph's FROM→TO blend handles the seamless crossfade.
 *   - Stances: parameterise weapon-socket transforms via context.stance.
 *   - IK foot planting: post-process _applyPose output before writing
 *     to joints (no change to the graph needed).
 *   - Head tracking: override headRotX/Y after _applyPose with a lerped
 *     look-at target.
 *   - Effect anchors: read j.chest.getWorldPosition() etc. after apply.
 * -----------------------------------------------------------------------
 */

import { AnimConfig, LocomotionPhase } from './MovementConfig.js';
import { AnimationGraph, AnimationState, BodyMask } from './AnimationController.js';

/** Convenience: sine wave at frequency Hz. */
const sw = (t, hz, phaseRad = 0) =>
  Math.sin(t * hz * Math.PI * 2 + phaseRad);

export class Animator {
  /**
   * @param {THREE.Group} mesh  The Dead Star root group from EntityView.
   *                            mesh._joints must exist.
   */
  constructor(mesh) {
    this.mesh  = mesh;
    this.graph = new AnimationGraph();

    /** Walk cycle phase accumulator (radians, 0–2π). */
    this._walkPhase = 0;

    /** Used to preserve head Y spin across _applyPose calls. */
    this._headSpinY = 0;

    /** Track last phase so we only call transitionTo on changes. */
    this._lastPhase = LocomotionPhase.IDLE;

    this._buildGraph();
    this.graph.snap('idle');
  }

  // ── Graph construction ──────────────────────────────────────────────────

  _buildGraph() {
    // ── IDLE ──────────────────────────────────────────────────────────────
    // Contained, non-human. Small chest breath, slow root sway, slow head.
    // Shoulders settle slightly downward. No leg movement.
    this.graph.addState(new AnimationState(
      LocomotionPhase.IDLE,
      BodyMask.FULL,
      (t, dt, ctx) => ({
        rootRotX:       0,
        rootRotZ:       sw(t, AnimConfig.IDLE_SWAY_HZ) * AnimConfig.IDLE_SWAY_AMP,
        chestScaleY:    1.0 + sw(t, AnimConfig.IDLE_BREATHE_HZ) * AnimConfig.IDLE_BREATHE_AMP,
        headRotX:       sw(t, AnimConfig.IDLE_HEAD_HZ, Math.PI * 0.3) * AnimConfig.IDLE_HEAD_AMP,
        leftShoulderX:   AnimConfig.IDLE_SHOULDER_DROP,
        rightShoulderX:  AnimConfig.IDLE_SHOULDER_DROP,
        leftHipX:  0, rightHipX:  0,
        leftKneeX: 0, rightKneeX: 0,
      })
    ));

    // ── DRIFT ─────────────────────────────────────────────────────────────
    // Micro-movement / repositioning. Short steps, minimal lean.
    this.graph.addState(new AnimationState(
      LocomotionPhase.DRIFT,
      BodyMask.FULL,
      (t, dt, ctx) => this._locomotionPose(ctx, LocomotionPhase.DRIFT)
    ));

    // ── RUN ───────────────────────────────────────────────────────────────
    // Standard combat movement. Long, deliberate steps. Stable torso.
    this.graph.addState(new AnimationState(
      LocomotionPhase.RUN,
      BodyMask.FULL,
      (t, dt, ctx) => this._locomotionPose(ctx, LocomotionPhase.RUN)
    ));

    // ── BREAKSTRIDE ───────────────────────────────────────────────────────
    // Committed fast movement. Lower posture, widest swing, head stays level.
    this.graph.addState(new AnimationState(
      LocomotionPhase.BREAKSTRIDE,
      BodyMask.FULL,
      (t, dt, ctx) => this._locomotionPose(ctx, LocomotionPhase.BREAKSTRIDE)
    ));
  }

  // ── Locomotion pose producer ────────────────────────────────────────────

  /**
   * Produces the PoseData for any locomotion phase.
   * Uses the shared _walkPhase accumulated in update() so blended states
   * are always cycle-coherent — blending between two phases never
   * produces a mismatched-cycle artefact.
   *
   * Speed-scaling:
   *   Amplitude is multiplied by normalised speed so the character
   *   actually looks stationary when barely moving, without hard-switching
   *   to the idle pose. The blend handles the crossfade.
   *
   * @param {object} ctx    Shared context (walkPhase, speed, maxSpeed)
   * @param {string} phase  LocomotionPhase constant
   * @returns {object}      PoseData
   */
  _locomotionPose(ctx, phase) {
    const norm  = Math.min(ctx.speed / Math.max(ctx.maxSpeed, 0.001), 1.0);
    // Fade amplitude in from 0 so slow starts don't look like full strides.
    const scale = Math.min(norm * 2.2, 1.0);
    const cycle = Math.sin(ctx.walkPhase);

    // Per-phase parameters
    let legAmp, lean;
    switch (phase) {
      case LocomotionPhase.DRIFT:
        legAmp = AnimConfig.LEG_AMP_DRIFT;
        lean   = AnimConfig.TORSO_LEAN_DRIFT;
        break;
      case LocomotionPhase.RUN:
        legAmp = AnimConfig.LEG_AMP_RUN;
        lean   = AnimConfig.TORSO_LEAN_RUN;
        break;
      case LocomotionPhase.BREAKSTRIDE:
        legAmp = AnimConfig.LEG_AMP_BREAKSTRIDE;
        lean   = AnimConfig.TORSO_LEAN_BREAK;
        break;
      default:
        legAmp = AnimConfig.LEG_AMP_DRIFT;
        lean   = AnimConfig.TORSO_LEAN_DRIFT;
    }

    legAmp *= scale;
    lean   *= scale;
    const armAmp  = legAmp * AnimConfig.ARM_AMP_RATIO;
    const kneeAmp = legAmp * AnimConfig.KNEE_AMP_RATIO;

    return {
      rootRotX:       lean,
      rootRotZ:       0,
      chestScaleY:    1.0 + legAmp * AnimConfig.TORSO_BOUNCE_RATIO,
      // Counter-lean the head so it stays visually level despite torso lean.
      headRotX:       -lean * AnimConfig.HEAD_LEVEL_FACTOR,
      leftShoulderX:  -cycle * armAmp,
      rightShoulderX:  cycle * armAmp,
      leftHipX:         cycle * legAmp,
      rightHipX:       -cycle * legAmp,
      // Knee bends on the trailing leg (when leg swings back = negative cycle)
      leftKneeX:        Math.max(0, -cycle) * kneeAmp,
      rightKneeX:       Math.max(0,  cycle) * kneeAmp,
    };
  }

  // ── Public update ───────────────────────────────────────────────────────

  /**
   * Drive the animator one render frame.
   * Call AFTER predictor.updateVisual() so speed reflects the smoothed
   * velocity, not the raw physics value.
   *
   * @param {number} dt       Frame delta (seconds, variable)
   * @param {string} phase    Current LocomotionPhase
   * @param {number} speed    Current horizontal speed (m/s)
   * @param {number} maxSpeed Server MAX_SPEED
   */
  update(dt, phase, speed, maxSpeed) {
    // Advance shared walk phase, scaled by normalised speed.
    // When speed = 0 the phase stops advancing — no marching in place.
    const norm    = Math.min(speed / Math.max(maxSpeed, 0.001), 1.0);
    const stepHz  = this._stepHz(phase);
    this._walkPhase = (this._walkPhase + dt * stepHz * Math.PI * 2 * Math.min(norm * 2, 1)) % (Math.PI * 2);

    // Trigger graph transitions only on phase changes (safe to call each frame).
    if (phase !== this._lastPhase) {
      this.graph.transitionTo(phase, this._blendDuration(phase));
      this._lastPhase = phase;
    }

    // Build context for state update functions
    const context = {
      walkPhase: this._walkPhase,
      speed,
      maxSpeed,
      phase,
    };

    // Tick the graph and apply the resulting pose
    const pose = this.graph.tick(dt, context);
    this._applyPose(pose);

    // Head Y-spin is managed here, separately from the pose system,
    // so transitions never cause spin-speed discontinuities.
    const now = performance.now() * 0.001;
    this._headSpinY = (this._headSpinY + dt * AnimConfig.HEAD_SPIN_RATE) % (Math.PI * 2);
    const j = this.mesh._joints;
    if (j?.head) {
      j.head.rotation.y = this._headSpinY;
      // X tilt: gentle precession wobble ON TOP of the pose's headRotX.
      // The pose's headRotX is already written by _applyPose, so we read
      // it back and add the wobble rather than overwriting.
      const wobble = Math.sin(now * AnimConfig.HEAD_WOBBLE_HZ * Math.PI * 2)
                   * AnimConfig.HEAD_WOBBLE_AMP;
      j.head.rotation.x = (pose.headRotX ?? 0) + wobble;
    }
  }

  // ── Pose application ────────────────────────────────────────────────────

  /**
   * Write PoseData to mesh joints.
   * Every write is an absolute SET — idempotent, never accumulates.
   * Missing pose keys fall back to 0 (neutral / identity).
   * @param {object} pose PoseData
   */
  _applyPose(pose) {
    const j = this.mesh._joints;
    if (!j) return;

    // Whole-body lean (root group)
    if (j.root) {
      j.root.rotation.x = pose.rootRotX ?? 0;
      j.root.rotation.z = pose.rootRotZ ?? 0;
    }

    // Chest breathing / bounce (Y scale only; X/Z scale is group-level)
    if (j.chest) {
      j.chest.scale.y = pose.chestScaleY ?? 1.0;
    }

    // Head tilt — Y spin is handled separately above (preserved across calls)
    if (j.head) {
      j.head.rotation.x = pose.headRotX ?? 0;
    }

    // Shoulders
    if (j.leftShoulder)  j.leftShoulder.rotation.x  = pose.leftShoulderX  ?? 0;
    if (j.rightShoulder) j.rightShoulder.rotation.x = pose.rightShoulderX ?? 0;

    // Hips
    if (j.leftHip)  j.leftHip.rotation.x  = pose.leftHipX  ?? 0;
    if (j.rightHip) j.rightHip.rotation.x = pose.rightHipX ?? 0;

    // Knees
    if (j.leftKnee)  j.leftKnee.rotation.x  = pose.leftKneeX  ?? 0;
    if (j.rightKnee) j.rightKnee.rotation.x = pose.rightKneeX ?? 0;
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  _stepHz(phase) {
    return {
      [LocomotionPhase.DRIFT]:       AnimConfig.STEP_HZ_DRIFT,
      [LocomotionPhase.RUN]:         AnimConfig.STEP_HZ_RUN,
      [LocomotionPhase.BREAKSTRIDE]: AnimConfig.STEP_HZ_BREAKSTRIDE,
    }[phase] ?? AnimConfig.STEP_HZ_DRIFT;
  }

  _blendDuration(phase) {
    return {
      [LocomotionPhase.IDLE]:        AnimConfig.BLEND_IDLE_IN,
      [LocomotionPhase.DRIFT]:       AnimConfig.BLEND_DRIFT_IN,
      [LocomotionPhase.RUN]:         AnimConfig.BLEND_RUN_IN,
      [LocomotionPhase.BREAKSTRIDE]: AnimConfig.BLEND_BREAKSTRIDE_IN,
    }[phase] ?? 0.15;
  }
}
