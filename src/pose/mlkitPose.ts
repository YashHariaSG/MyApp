import { KEYPOINT_NAMES } from './poseSkeleton';
import type { Keypoint } from './types';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Minimum confidence to treat a landmark as valid. */
const MIN_CONFIDENCE = 0.4;

/**
 * Angle (degrees) from vertical beyond which the spine is considered "bent".
 * Tune this value: 10° is strict, 20° is forgiving.
 */
const SPINE_BEND_THRESHOLD_DEG = 15;

/** Native ML Kit plugin keys (Android/iOS). */
const MLKIT_LANDMARKS: { key: string; index: number }[] = [
  { key: 'nosePosition',          index: 0  },
  { key: 'leftEyePosition',       index: 1  },
  { key: 'rightEyePosition',      index: 2  },
  { key: 'leftEarPosition',       index: 3  },
  { key: 'rightEarPosition',      index: 4  },
  { key: 'leftShoulderPosition',  index: 5  },
  { key: 'rightShoulderPosition', index: 6  },
  { key: 'leftElbowPosition',     index: 7  },
  { key: 'rightElbowPosition',    index: 8  },
  { key: 'leftWristPosition',     index: 9  },
  { key: 'rightWristPosition',    index: 10 },
  { key: 'leftHipPosition',       index: 11 },
  { key: 'rightHipPosition',      index: 12 },
  { key: 'leftKneePosition',      index: 13 },
  { key: 'rightKneePosition',     index: 14 },
  { key: 'leftAnklePosition',     index: 15 },
  { key: 'rightAnklePosition',    index: 16 },
];

const PAYLOAD_KEYS = MLKIT_LANDMARKS.map(l => l.key);

// ─── Types ────────────────────────────────────────────────────────────────────

type LandmarkPoint = { x: number; y: number; inFrameLikelihood?: number };

export type SpineStatus = {
  /** true = spine is roughly straight */
  isSpineStraight: boolean;
  /** Deviation angle from vertical in degrees (0 = perfect) */
  deviationDeg: number;
  /** Which landmarks were used (null if not visible) */
  debug: {
    shoulderMid: { x: number; y: number } | null;
    hipMid:      { x: number; y: number } | null;
  };
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

function readLandmark(
  pose: Record<string, unknown>,
  key: string,
): LandmarkPoint | null {
  const raw = pose[key] as LandmarkPoint | undefined;

  if (raw == null || typeof raw.x !== 'number' || typeof raw.y !== 'number') {
    return null;
  }

  // FIX: only skip (0,0) if confidence is also absent/zero — pure (0,0) with
  // a real confidence value is theoretically a valid top-left point.
  const conf = typeof raw.inFrameLikelihood === 'number' ? raw.inFrameLikelihood : 0;
  if (raw.x === 0 && raw.y === 0 && conf === 0) {
    return null;
  }

  // FIX: drop low-confidence landmarks instead of passing junk downstream
  if (conf > 0 && conf < MIN_CONFIDENCE) {
    return null;
  }

  return raw;
}

function midpoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// ─── Payload encode / decode ──────────────────────────────────────────────────

/**
 * Worklet-safe string payload for JS bridge.
 * Format: `<key>:<x>,<y>,<confidence>;...|<frameWidth>|<frameHeight>`
 */
export function mlkitPoseToPayload(
  pose: Record<string, unknown>,
  frameWidth: number,
  frameHeight: number,
): string {
  'worklet';
  if (pose == null) return '';

  let body = '';

  for (let i = 0; i < PAYLOAD_KEYS.length; i++) {
    const key  = PAYLOAD_KEYS[i];
    const lm   = pose[key] as LandmarkPoint | undefined;

    if (lm == null || lm.x == null || lm.y == null) continue;

    const conf = typeof lm.inFrameLikelihood === 'number' ? lm.inFrameLikelihood : 0;

    // FIX: apply confidence gate in worklet too
    if (conf > 0 && conf < MIN_CONFIDENCE) continue;
    if (lm.x === 0 && lm.y === 0 && conf === 0) continue;

    if (body.length > 0) body += ';';
    body += `${key}:${lm.x},${lm.y},${conf}`;
  }

  return body.length === 0 ? '' : `${body}|${frameWidth}|${frameHeight}`;
}

/** Parse ML Kit payload → 17 keypoints normalised to frame (0–1). */
export function keypointsFromMlkitPayload(payload: string): Keypoint[] {
  const pipe = payload.indexOf('|');
  if (pipe < 0) return [];

  const body        = payload.slice(0, pipe);
  const meta        = payload.slice(pipe + 1).split('|');
  const frameWidth  = Number(meta[0]);
  const frameHeight = Number(meta[1]);

  if (!Number.isFinite(frameWidth) || !Number.isFinite(frameHeight)) return [];

  const pose: Record<string, LandmarkPoint> = {};

  for (const part of body.split(';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;

    const key    = part.slice(0, colon);
    const coords = part.slice(colon + 1).split(',');
    const x      = Number(coords[0]);
    const y      = Number(coords[1]);
    const conf   = coords.length >= 3 ? Number(coords[2]) : 0;

    if (Number.isFinite(x) && Number.isFinite(y)) {
      pose[key] = { x, y, inFrameLikelihood: Number.isFinite(conf) ? conf : 0 };
    }
  }

  const empty: Keypoint = { name: '', x: 0, y: 0, score: 0 };
  const keypoints: Keypoint[] = Array.from({ length: 17 }, (_, i) => ({
    ...empty,
    name: KEYPOINT_NAMES[i] ?? `kp_${i}`,
  }));

  for (const { key, index } of MLKIT_LANDMARKS) {
    const lm = readLandmark(pose, key);
    if (lm == null) continue;

    keypoints[index] = {
      name:  KEYPOINT_NAMES[index] ?? key,
      x:     lm.x / frameWidth,
      y:     lm.y / frameHeight,
      score: typeof lm.inFrameLikelihood === 'number' ? lm.inFrameLikelihood : 0,
    };
  }

  return keypoints;
}

// ─── Spine analysis ───────────────────────────────────────────────────────────

/**
 * Analyses whether the person's spine is straight.
 *
 * Strategy
 * --------
 * 1. Compute shoulder midpoint  (avg of left + right shoulder).
 * 2. Compute hip midpoint       (avg of left + right hip).
 * 3. The spine vector goes from hip → shoulder.
 * 4. Measure the angle between that vector and the vertical axis.
 *    - 0°  = perfectly upright
 *    - 90° = lying flat
 * 5. If the angle exceeds SPINE_BEND_THRESHOLD_DEG, spine is bent.
 *
 * Coordinates are expected to be normalised (0–1) as returned by
 * `keypointsFromMlkitPayload`.  Works equally well with raw pixel coords.
 *
 * @param keypoints  Output of `keypointsFromMlkitPayload`
 * @param minScore   Override the minimum keypoint score (default 0.4)
 */
export function analyseSpine(
  keypoints: Keypoint[],
  minScore = MIN_CONFIDENCE,
): SpineStatus {
  const kp = (index: number): Keypoint | null => {
    const k = keypoints[index];
    return k && k.score >= minScore ? k : null;
  };

  // Indices per COCO/MoveNet layout (matches MLKIT_LANDMARKS above)
  const leftShoulder  = kp(5);
  const rightShoulder = kp(6);
  const leftHip       = kp(11);
  const rightHip      = kp(12);

  const shoulderMid =
    leftShoulder && rightShoulder
      ? midpoint(leftShoulder, rightShoulder)
      : leftShoulder ?? rightShoulder ?? null;

  const hipMid =
    leftHip && rightHip
      ? midpoint(leftHip, rightHip)
      : leftHip ?? rightHip ?? null;

  if (!shoulderMid || !hipMid) {
    // Not enough data visible
    return {
      isSpineStraight: false,
      deviationDeg:    0,
      debug:           { shoulderMid, hipMid },
    };
  }

  // Vector from hip to shoulder (spine direction)
  const dx = shoulderMid.x - hipMid.x;   // horizontal offset
  const dy = shoulderMid.y - hipMid.y;   // vertical offset (y grows downward)

  // Angle from vertical: atan2(|dx|, |dy|)
  // |dy| because in normalised coords shoulder.y < hip.y (top of screen = 0)
  const deviationRad = Math.atan2(Math.abs(dx), Math.abs(dy));
  const deviationDeg = (deviationRad * 180) / Math.PI;

  return {
    isSpineStraight: deviationDeg <= SPINE_BEND_THRESHOLD_DEG,
    deviationDeg,
    debug:           { shoulderMid, hipMid },
  };
}

// ─── Usage example ────────────────────────────────────────────────────────────
/*
  const keypoints = keypointsFromMlkitPayload(payload);
  const spine     = analyseSpine(keypoints);

  if (!spine.isSpineStraight) {
    console.warn(`Spine bent by ${spine.deviationDeg.toFixed(1)}° — please straighten up!`);
  }
*/