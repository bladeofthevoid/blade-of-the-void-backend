/**
 * player/MovementConfig.js
 * -----------------------------------------------------------------------
 * Single source of truth for client-side locomotion tuning.
 *
 * Architecture notes:
 *   - Phase thresholds are FRACTIONS of the server's MAX_SPEED so they
 *     scale automatically if server tuning changes. The server still owns
 *     absolute speed; we only describe when phases begin/end relative to it.
 *
 *   - PhaseConfig multipliers are applied to the server's flat movement
 *     config during client-side prediction only. The server runs its own
 *     unmodified config; reconciliation absorbs the small divergence.
 *     Multipliers are intentionally moderate so corrections stay within
 *     the visual-smoothing window (~50 ms, imperceptible).
 *
 *   - AnimConfig is purely visual — never read by any physics path.
 *     Safe to tune freely without affecting networking or prediction.
 *
 * Future extensions:
 *   - Combat stances: add to PhaseConfig / AnimConfig without touching
 *     LocomotionController or Animator internals.
 *   - Dodge: add DODGE_SPEED, DODGE_DURATION here; LocomotionController
 *     picks it up on a single condition branch.
 * -----------------------------------------------------------------------
 */

/** Canonical locomotion phase names. Used as Map keys throughout. */
export const LocomotionPhase = Object.freeze({
  IDLE:        'idle',
  DRIFT:       'drift',        // 0 – DRIFT_MAX of MAX_SPEED
  RUN:         'run',          // DRIFT_MAX – RUN_MAX
  BREAKSTRIDE: 'breakstride',  // RUN_MAX – 100 %  (committed movement)
  JUMP_START:  'jumpStart',    // reserved — jump squat frame
  JUMP:        'jump',         // reserved
  FALL:        'fall',         // reserved
  LAND:        'land',         // reserved
  DODGE:       'dodge',        // reserved — i-frame movement
});

/**
 * Speed band boundaries as fractions of the server's MAX_SPEED (0–1).
 * LocomotionController reads these; nothing else should.
 */
export const PhaseThresholds = Object.freeze({
  // Below this the character reads as idle even with a tiny velocity
  IDLE_MAX:   0.05,
  // Drift:       0 %  → DRIFT_MAX
  DRIFT_MAX:  0.45,
  // Run:         DRIFT_MAX → RUN_MAX
  // Raised to 0.86 so you must be at 86 % of max speed — not just
  // crossing the threshold, but genuinely committed to full running.
  RUN_MAX:    0.86,
  // Breakstride: RUN_MAX → 100 %  (no upper threshold — it's the top band)
});

/**
 * Per-phase multipliers applied to the server's base movement config
 * DURING CLIENT-SIDE PREDICTION. Reconciliation still uses the server
 * config verbatim, keeping authoritative state correct.
 *
 * Why moderate values?
 *   At 30 Hz with ~100 ms RTT there are ~3 pending inputs in flight.
 *   A 1.5× acceleration divergence over 3 ticks produces < 0.04 m of
 *   position error — well within visual smoothing. Values above ~2× would
 *   produce noticeable reconciliation pops.
 */
export const PhaseConfig = Object.freeze({
  [LocomotionPhase.IDLE]: {
    accelerationMult: 1.0,
    frictionMult:     1.25,   // snappier micro-stop than server default
    turnRateMult:     1.0,
  },
  [LocomotionPhase.DRIFT]: {
    accelerationMult: 1.55,   // rapid spin-up for repositioning / micro-steps
    frictionMult:     1.30,   // quick stop at low speed
    turnRateMult:     1.50,   // hyper-responsive direction changes
  },
  [LocomotionPhase.RUN]: {
    accelerationMult: 1.0,    // server baseline — no divergence here
    frictionMult:     1.0,
    turnRateMult:     1.0,
  },
  [LocomotionPhase.BREAKSTRIDE]: {
    accelerationMult: 0.70,   // committed — sluggish to re-accelerate
    frictionMult:     0.78,   // momentum carry — slower to stop
    turnRateMult:     0.55,   // committed direction — strafing costs momentum
  },
});

/**
 * Visual-only animation constants.
 * These values are NEVER read by the movement system or network code.
 * All times are in seconds; angles in radians; scales are multipliers.
 */
export const AnimConfig = Object.freeze({
  // ── State-transition blend durations (seconds) ─────────────────────────
  BLEND_IDLE_IN:           0.28,
  BLEND_DRIFT_IN:          0.10,   // drift must feel instant
  BLEND_RUN_IN:            0.20,
  BLEND_BREAKSTRIDE_IN:    0.30,   // slightly longer so the shift feels weighty
  BLEND_STOP:              0.22,

  // ── Hysteresis — minimum time before a phase transition fires ──────────
  // Prevents flickering at phase speed thresholds.
  MIN_IN_IDLE:        0.08,
  MIN_IN_DRIFT:       0.04,
  MIN_IN_RUN:         0.10,
  // How long you must stay in BREAKSTRIDE before you can leave it.
  // Keeps the exaggerated pose from flickering if speed dips briefly.
  MIN_IN_BREAKSTRIDE: 0.40,
  // ← KEY: how long you must SUSTAIN run-band speed before breakstride
  // fires. This is the guard that stops you hitting it in <1 second.
  // ~0.75 s of real running earns the transition.
  MIN_RUN_BEFORE_BREAK: 0.75,

  // ── Idle animation ─────────────────────────────────────────────────────
  // Very subtle — the Dead Star should feel contained, not human.
  IDLE_BREATHE_HZ:     0.25,   // 4-second inhale/exhale cycle
  IDLE_BREATHE_AMP:    0.008,  // chest Y-scale delta (tiny)
  IDLE_SWAY_HZ:        0.17,   // slow lateral rock (~6 s period)
  IDLE_SWAY_AMP:       0.004,  // root rotation.z amplitude
  IDLE_HEAD_HZ:        0.12,   // contemplative head drift (~8 s period)
  IDLE_HEAD_AMP:       0.055,  // head rotation.x amplitude
  IDLE_SHOULDER_DROP:  0.020,  // passive shoulder settlement (rotation.x)

  // ── Walk-cycle step frequencies (cycles / second) ──────────────────────
  // Lower = longer, more deliberate strides. The cycle is also scaled
  // by normalised speed in Animator so slow movement never looks like
  // marching in place — these are the FULL-SPEED frequencies.
  //
  //   Drift:       ~1 stride per 0.53 s  — measured repositioning steps
  //   Run:         ~1 stride per 0.43 s  — long deliberate running
  //   Breakstride: ~1 stride per 0.67 s  — massive, lunging power strides
  STEP_HZ_DRIFT:       1.90,
  STEP_HZ_RUN:         2.30,
  STEP_HZ_BREAKSTRIDE: 1.50,

  // ── Limb swing amplitudes (radians) ────────────────────────────────────
  // Significantly larger than before. Combined with the lower frequencies
  // above this produces long, sweeping strides rather than short quick ones.
  //
  // Breakstride is intentionally extreme — it should read as a committed,
  // almost lunging gait. The Dead Star's body commits hard to each stride.
  //
  //   Drift:       ~37 °  — visible but contained
  //   Run:         ~57 °  — unmistakably a real run
  //   Breakstride: ~89 °  — exaggerated, powerful, almost theatrical
  LEG_AMP_DRIFT:       0.65,
  LEG_AMP_RUN:         1.00,
  LEG_AMP_BREAKSTRIDE: 1.55,

  // Arms swing hard — the Dead Star uses its whole body at speed.
  ARM_AMP_RATIO:       0.60,   // arm swing = leg swing × this
  //   Drift arm:       ~22 °
  //   Run arm:         ~34 °
  //   Breakstride arm: ~53 °  — dramatic windmill at full commit
  KNEE_AMP_RATIO:      0.82,   // knee bend  = leg swing × this

  // ── Torso — stable in drift, progressively heavier lean at speed ───────
  // Dead Stars don't bounce, but they DO lean into their movement hard.
  TORSO_BOUNCE_RATIO:  0.028,  // vertical chest bob = leg amp × this
  TORSO_LEAN_DRIFT:    0.050,  // forward lean at drift  (~3 °)
  TORSO_LEAN_RUN:      0.130,  // forward lean at run    (~7.5 °)
  TORSO_LEAN_BREAK:    0.300,  // forward lean at break  (~17 °) — heavy commitment

  // ── Head levelling ─────────────────────────────────────────────────────
  // Counter-rotate head by this fraction of the torso's forward lean so
  // it stays visually level and the star keeps facing forward naturally.
  HEAD_LEVEL_FACTOR:   0.88,

  // Head Y spin is driven separately and preserved across pose updates.
  HEAD_SPIN_RATE:      0.78,   // rad/s
  HEAD_WOBBLE_HZ:      0.046,  // precession wobble frequency
  HEAD_WOBBLE_AMP:     0.14,   // precession wobble amplitude (rad)

  // ── Camera velocity anticipation ──────────────────────────────────────
  CAM_ANTICIPATION_MAX:  0.85,
  CAM_ANTICIPATION_LERP: 0.08,
});
