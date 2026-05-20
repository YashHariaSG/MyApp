import type { Keypoint, PresenceResult } from './types';

/** ML Kit's `inFrameLikelihood` — values above this are considered visible. */
const MIN_SCORE = 0.5;
/** Lower bar for leg landmarks (ML Kit drops these more often). */
const LEG_MIN_SCORE = 0.38;
const FACE_SCORE = 0.58;
const FACE_EDGE_MARGIN = 0.06;
const BODY_EDGE_MARGIN = 0.03;

const SITTING_OK_FRAME = 72;
const SITTING_BAD_FRAME = 45;

const STRAIGHT_LEG_ANGLE = 165;
const BENT_LEG_ANGLE = 150;

function kp(keypoints: Keypoint[], index: number): Keypoint | null {
  const point = keypoints[index];
  if (!point || point.score < MIN_SCORE) {
    return null;
  }
  return point;
}

function kpLeg(keypoints: Keypoint[], index: number): Keypoint | null {
  const point = keypoints[index];
  if (!point || point.score < LEG_MIN_SCORE) {
    return null;
  }
  return point;
}

function mid(a: Keypoint, b: Keypoint): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function dist(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Interior angle at `vertex` (degrees). */
function angleAt(
  a: { x: number; y: number },
  vertex: { x: number; y: number },
  c: { x: number; y: number },
): number {
  const bax = a.x - vertex.x;
  const bay = a.y - vertex.y;
  const bcx = c.x - vertex.x;
  const bcy = c.y - vertex.y;
  const dot = bax * bcx + bay * bcy;
  const mag = Math.hypot(bax, bay) * Math.hypot(bcx, bcy);
  if (mag < 1e-6) {
    return 180;
  }
  return (Math.acos(Math.min(1, Math.max(-1, dot / mag))) * 180) / Math.PI;
}

export type PostureMeasure = {
  sittingScore: number;
  standingScore: number;
  torsoLen: number;
};

function torsoLength(keypoints: Keypoint[]): number | null {
  const lSh = kp(keypoints, 5);
  const rSh = kp(keypoints, 6);
  const lHip = kp(keypoints, 11);
  const rHip = kp(keypoints, 12);

  let shoulder: { x: number; y: number } | null = null;
  if (lSh && rSh) {
    shoulder = mid(lSh, rSh);
  } else if (lSh) {
    shoulder = lSh;
  } else if (rSh) {
    shoulder = rSh;
  } else {
    const nose = kp(keypoints, 0);
    if (nose) {
      shoulder = nose;
    }
  }

  let hip: { x: number; y: number } | null = null;
  if (lHip && rHip) {
    hip = mid(lHip, rHip);
  } else if (lHip) {
    hip = lHip;
  } else if (rHip) {
    hip = rHip;
  }

  if (!shoulder || !hip) {
    return null;
  }

  return Math.max(dist(shoulder, hip), 0.06);
}

function isInsideFrame(p: Keypoint, margin: number): boolean {
  return (
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    p.x >= margin &&
    p.x <= 1 - margin &&
    p.y >= margin &&
    p.y <= 1 - margin
  );
}

/**
 * Face quality proxy for "clearly visible":
 * - nose + both eyes confident
 * - all three inside frame margin (not cropped)
 */
export function hasClearFace(keypoints: Keypoint[]): boolean {
  const nose = keypoints[0];
  const leftEye = keypoints[1];
  const rightEye = keypoints[2];

  if (
    !nose ||
    !leftEye ||
    !rightEye ||
    nose.score < FACE_SCORE ||
    leftEye.score < FACE_SCORE ||
    rightEye.score < FACE_SCORE
  ) {
    return false;
  }

  return (
    isInsideFrame(nose, FACE_EDGE_MARGIN) &&
    isInsideFrame(leftEye, FACE_EDGE_MARGIN) &&
    isInsideFrame(rightEye, FACE_EDGE_MARGIN)
  );
}

/**
 * Full upper-body in frame:
 * - face + both shoulders + both hips all visible and inside frame.
 */
export function hasFullUpperBodyInFrame(keypoints: Keypoint[]): boolean {
  const required = [0, 5, 6, 11, 12]
    .map(i => keypoints[i])
    .filter((p): p is Keypoint => p != null);

  if (required.length < 5) {
    return false;
  }

  return required.every(p => p.score >= MIN_SCORE && isInsideFrame(p, BODY_EDGE_MARGIN));
}

/**
 * Strict person validation using ML Kit confidence:
 *   - Nose must be visible AND high-confidence (face actually in frame).
 *   - Both shoulders must be visible.
 *   - Aggregate confidence of core landmarks (face + shoulders + hips)
 *     must clear a threshold — this rejects hallucinated landmarks the
 *     ML Kit emits when pointed at walls/ceilings.
 */
export function hasUpperBody(keypoints: Keypoint[]): boolean {
  const nose = keypoints[0];
  const lSh = keypoints[5];
  const rSh = keypoints[6];
  const lHip = keypoints[11];
  const rHip = keypoints[12];

  if (!hasClearFace(keypoints)) {
    return false;
  }

  // Both shoulders must be at least moderately visible.
  if (!lSh || lSh.score < MIN_SCORE || !rSh || rSh.score < MIN_SCORE) {
    return false;
  }

  const core = [nose, lSh, rSh, lHip, rHip];
  const coreConfSum = core.reduce(
    (s, p) => s + (p && typeof p.score === 'number' ? p.score : 0),
    0,
  );
  if (coreConfSum < 2.0) {
    return false;
  }

  // At least 6 landmarks with real confidence for reliable posture inference.
  const visible = keypoints.filter(p => p.score >= MIN_SCORE).length;
  return visible >= 6;
}

export function isClearlyOutOfFrame(keypoints: Keypoint[]): boolean {
  const visible = keypoints.filter(p => p.score >= MIN_SCORE).length;
  if (visible < 5) {
    return true;
  }

  // Need at least 3 of the core 5 (face + shoulders + hips) visible.
  const coreVisible = [0, 5, 6, 11, 12].filter(
    i => kp(keypoints, i) != null,
  ).length;
  return coreVisible < 3;
}

export function isPersonInFrame(keypoints: Keypoint[]): boolean {
  return hasUpperBody(keypoints) && !isClearlyOutOfFrame(keypoints);
}

type LegAngles = {
  left: number | null;
  right: number | null;
  count: number;
  minAngle: number | null;
  maxAngle: number | null;
  avg: number | null;
};

/** Per-leg knee angles (deg). null = full leg chain not visible. */
function legKneeAngles(keypoints: Keypoint[]): LegAngles {
  function angleFor(hi: number, ki: number, ai: number): number | null {
    const hip = kpLeg(keypoints, hi);
    const knee = kpLeg(keypoints, ki);
    const ankle = kpLeg(keypoints, ai);
    if (!hip || !knee || !ankle) return null;
    return angleAt(hip, knee, ankle);
  }

  const left = angleFor(11, 13, 15);
  const right = angleFor(12, 14, 16);
  const angles = [left, right].filter((v): v is number => v != null);
  const minAngle = angles.length ? Math.min(...angles) : null;
  const maxAngle = angles.length ? Math.max(...angles) : null;
  const avg = angles.length
    ? angles.reduce((s, v) => s + v, 0) / angles.length
    : null;
  return { left, right, count: angles.length, minAngle, maxAngle, avg };
}

/**
 * Standing = at least one leg is fully extended (straight knee) AND ankle is
 * far below hip vertically.
 */
export function isStanding(keypoints: Keypoint[]): boolean {
  const { maxAngle } = legKneeAngles(keypoints);
  if (maxAngle == null) {
    return false;
  }

  const torso = torsoLength(keypoints);
  if (torso == null) {
    return false;
  }

  const hipMid = (() => {
    const l = kp(keypoints, 11);
    const r = kp(keypoints, 12);
    if (l && r) return mid(l, r);
    return l || r;
  })();
  const ankleMid = (() => {
    const l = kp(keypoints, 15);
    const r = kp(keypoints, 16);
    if (l && r) return mid(l, r);
    return l || r;
  })();

  if (!hipMid || !ankleMid) {
    return false;
  }

  const legSpan = (ankleMid.y - hipMid.y) / torso;
  // Even one straight leg + large vertical leg extension = standing-like.
  return maxAngle >= STRAIGHT_LEG_ANGLE && legSpan > 1.2;
}

/**
 * "Mixed posture" — one leg bent, one extended. Not proper sitting.
 * E.g. user has one leg folded and the other stretched out.
 */
export function hasMixedLegs(keypoints: Keypoint[]): boolean {
  const { left, right } = legKneeAngles(keypoints);
  if (left == null || right == null) {
    return false;
  }
  const bent = (a: number) => a <= BENT_LEG_ANGLE;
  const straight = (a: number) => a >= STRAIGHT_LEG_ANGLE - 5;
  return (
    (bent(left) && straight(right)) || (bent(right) && straight(left))
  );
}

/**
 * Cross-legged / sukhasana detection.
 * Signature traits:
 *   - Knees spread WIDER than hips (knee-knee distance > hip-hip distance).
 *   - Knees roughly at hip vertical level (not far below).
 *   - Both knees clearly bent.
 *   - Optional: ankles between knees (crossed in front).
 */
export function isCrossLegged(keypoints: Keypoint[]): boolean {
  const lHip = kpLeg(keypoints, 11);
  const rHip = kpLeg(keypoints, 12);
  const lKnee = kpLeg(keypoints, 13);
  const rKnee = kpLeg(keypoints, 14);
  if (!lHip || !rHip || !lKnee || !rKnee) {
    return false;
  }

  const torso = torsoLength(keypoints);
  if (torso == null) {
    return false;
  }

  const hipWidth = Math.abs(lHip.x - rHip.x);
  const kneeWidth = Math.abs(lKnee.x - rKnee.x);

  // Knees significantly wider than hips → spread outward.
  const wideKnees = kneeWidth > Math.max(hipWidth * 1.15, 0.04);

  // Knees near hip Y-level (within ~0.4 torso heights, on either side).
  const hipMidY = (lHip.y + rHip.y) / 2;
  const kneeMidY = (lKnee.y + rKnee.y) / 2;
  const kneesNearHips = Math.abs(kneeMidY - hipMidY) / torso < 0.45;

  // Both knees bent (when ankles visible).
  const { left, right, count } = legKneeAngles(keypoints);
  let bothBent = true;
  if (count === 2) {
    bothBent =
      (left as number) <= BENT_LEG_ANGLE + 10 &&
      (right as number) <= BENT_LEG_ANGLE + 10;
  }

  return wideKnees && kneesNearHips && bothBent;
}

/**
 * Compute sitting confidence (0–100). STRICT.
 *
 * Hard requirements (any failure → 0):
 *   - Upper body + face visible.
 *   - Not standing.
 *   - Both hips AND both knees must be visible.
 *   - No mixed posture (one straight + one bent).
 *
 * Score buckets:
 *   - Cross-legged geometry           → 95
 *   - Both knees bent (ankles in view)→ 85
 *   - Both knees near hip level w/ wide spread (no ankles) → 70
 *   - One leg ankle visible, bent     → 60
 *   - Both knees moderate (150°–165°) → 30
 *   - Anything else                   → 0
 */
export function getSittingScore(keypoints: Keypoint[]): number {
  if (!hasUpperBody(keypoints)) {
    return 0;
  }
  if (isClearlyOutOfFrame(keypoints)) {
    return 0;
  }
  if (isStanding(keypoints)) {
    return 0;
  }

  const lHip = kpLeg(keypoints, 11);
  const rHip = kpLeg(keypoints, 12);
  const lKnee = kpLeg(keypoints, 13);
  const rKnee = kpLeg(keypoints, 14);

  if (!lHip || !rHip || !lKnee || !rKnee) {
    // Legs briefly lost — not proof of bad posture.
    return -1;
  }

  if (hasMixedLegs(keypoints)) {
    return 0;
  }

  if (isCrossLegged(keypoints)) {
    return 95;
  }

  const angles = legKneeAngles(keypoints);

  if (angles.count === 2 && angles.left != null && angles.right != null) {
    const bothBent =
      angles.left <= BENT_LEG_ANGLE && angles.right <= BENT_LEG_ANGLE;
    const bothModerate =
      angles.left < STRAIGHT_LEG_ANGLE && angles.right < STRAIGHT_LEG_ANGLE;

    if (bothBent) {
      return 85;
    }
    if (bothModerate) {
      return 30;
    }
    return 0;
  }

  if (angles.count === 1) {
    const a = angles.minAngle as number;
    if (a <= BENT_LEG_ANGLE) {
      return 60;
    }
    return 0;
  }

  // No ankles visible — fall back to knee-vs-hip geometry.
  const torso = torsoLength(keypoints);
  if (torso == null) {
    return 0;
  }

  const hipMidY = (lHip.y + rHip.y) / 2;
  const kneeMidY = (lKnee.y + rKnee.y) / 2;
  const hipWidth = Math.abs(lHip.x - rHip.x);
  const kneeWidth = Math.abs(lKnee.x - rKnee.x);

  const kneeDrop = (kneeMidY - hipMidY) / torso;
  const kneesNearHips = kneeDrop < 0.5 && kneeDrop > -0.3;
  const kneesSpread = kneeWidth > Math.max(hipWidth * 1.1, 0.04);

  if (kneesNearHips && kneesSpread) {
    return 70;
  }
  if (kneesNearHips) {
    return 35;
  }
  return 0;
}

/** Approx scale-invariant posture summary (kept for compatibility). */
export function measurePosture(keypoints: Keypoint[]): PostureMeasure | null {
  const torso = torsoLength(keypoints);
  if (torso == null) {
    return null;
  }
  const sitting = getSittingScore(keypoints);
  const standing = isStanding(keypoints) ? 100 : 0;
  return { sittingScore: sitting, standingScore: standing, torsoLen: torso };
}

export function hasLegsInView(keypoints: Keypoint[]): boolean {
  return (
    kp(keypoints, 11) != null &&
    kp(keypoints, 12) != null &&
    kp(keypoints, 13) != null &&
    kp(keypoints, 14) != null
  );
}

export function hasChinVisible(keypoints: Keypoint[]): boolean {
  return kp(keypoints, 0) != null;
}

export function hasAnkleVisible(keypoints: Keypoint[]): boolean {
  return kp(keypoints, 15) != null || kp(keypoints, 16) != null;
}

export function hasChinOrAnkleVisible(keypoints: Keypoint[]): boolean {
  return hasChinVisible(keypoints) || hasAnkleVisible(keypoints);
}

/** Both knees (when visible) must be bent — no mixed posture. */
export function areLegsFolded(keypoints: Keypoint[]): boolean {
  const { left, right, count } = legKneeAngles(keypoints);
  if (count === 0) {
    return false;
  }
  if (count === 1) {
    const a = (left ?? right) as number;
    return a <= BENT_LEG_ANGLE;
  }
  return (
    (left as number) <= BENT_LEG_ANGLE &&
    (right as number) <= BENT_LEG_ANGLE
  );
}

function buildResult(
  status: PresenceResult['status'],
  visibleCount: number,
  isInFrame: boolean,
  isSitting: boolean,
  hasClearFaceCheck: boolean,
  noCropCheck: boolean,
  title: string,
  message: string,
): PresenceResult {
  return {
    status,
    visibleCount,
    isInFrame,
    isSitting,
    title,
    message,
    checks: [
      { id: 'visible', label: 'Person in sitting frame', passed: isInFrame },
      { id: 'sitting', label: 'Legs folded / crossed', passed: isSitting },
      { id: 'face', label: 'Face clearly visible', passed: hasClearFaceCheck },
      { id: 'no_crop', label: 'No face/upper-body cropping', passed: noCropCheck },
    ],
  };
}

export function evaluateFramePresence(
  keypoints: Keypoint[],
  smoothedSitting: number,
  sittingLocked: boolean,
): PresenceResult {
  const visibleCount = keypoints.filter(p => p.score >= MIN_SCORE).length;
  const faceClear = hasClearFace(keypoints);
  const noCrop = hasFullUpperBodyInFrame(keypoints);

  if (!hasUpperBody(keypoints)) {
    return buildResult(
      'no_person',
      visibleCount,
      false,
      false,
      false,
      false,
      'No one in view',
      'Sit in front of the camera with your face clearly visible.',
    );
  }

  if (isClearlyOutOfFrame(keypoints)) {
    return buildResult(
      'out_of_frame',
      visibleCount,
      false,
      false,
      faceClear,
      noCrop,
      'Out of frame',
      'Move so your full face and upper body are inside the frame.',
    );
  }

  if (!faceClear) {
    return buildResult(
      'out_of_frame',
      visibleCount,
      false,
      false,
      false,
      noCrop,
      'Show your face',
      'Keep your face clear, forward, and unobstructed.',
    );
  }

  if (!noCrop) {
    return buildResult(
      'out_of_frame',
      visibleCount,
      false,
      false,
      true,
      false,
      'No cropping',
      'Keep full face and upper body inside the frame.',
    );
  }

  if (isStanding(keypoints)) {
    return buildResult(
      'not_sitting',
      visibleCount,
      true,
      false,
      faceClear,
      noCrop,
      'Please sit down',
      'You are standing — please sit.',
    );
  }

  // STRICT: hips + knees must be visible for any sitting verdict.
  const lHip = kpLeg(keypoints, 11);
  const rHip = kpLeg(keypoints, 12);
  const lKnee = kpLeg(keypoints, 13);
  const rKnee = kpLeg(keypoints, 14);

  if (!lHip || !rHip) {
    return buildResult(
      'not_sitting',
      visibleCount,
      true,
      false,
      faceClear,
      noCrop,
      'Show your hips',
      'Move back so your hips are clearly visible in the frame.',
    );
  }

  if (!lKnee || !rKnee) {
    return buildResult(
      'not_sitting',
      visibleCount,
      true,
      false,
      faceClear,
      noCrop,
      'Show your legs',
      'Move back so both knees are visible in the frame.',
    );
  }

  if (hasMixedLegs(keypoints)) {
    return buildResult(
      'not_sitting',
      visibleCount,
      true,
      false,
      faceClear,
      noCrop,
      'Fold both legs',
      'One leg is straight and the other is bent. Fold both legs the same way.',
    );
  }

  if (isCrossLegged(keypoints) && smoothedSitting >= SITTING_BAD_FRAME) {
    return buildResult(
      'ok',
      visibleCount,
      true,
      true,
      true,
      true,
      'All good',
      'Cross-legged sitting detected — perfect!',
    );
  }

  // Detect "legs straight" (both knees nearly straight but not standing).
  const angles = legKneeAngles(keypoints);
  if (
    angles.count === 2 &&
    angles.left != null &&
    angles.right != null &&
    angles.left >= STRAIGHT_LEG_ANGLE - 10 &&
    angles.right >= STRAIGHT_LEG_ANGLE - 10
  ) {
    return buildResult(
      'not_sitting',
      visibleCount,
      true,
      false,
      faceClear,
      noCrop,
      'Fold your legs',
      'Your legs are straight. Fold them (cross-legged) to sit properly.',
    );
  }

  const frameSitting = getSittingScore(keypoints);

  // Legs not measurable this frame => not valid for final "ok".
  if (frameSitting < 0) {
    return buildResult(
      'not_sitting',
      visibleCount,
      true,
      false,
      faceClear,
      noCrop,
      'Hold still',
      'Keep your legs in view while we detect your posture.',
    );
  }

  const sittingOk =
    frameSitting >= SITTING_OK_FRAME &&
    smoothedSitting >= SITTING_BAD_FRAME &&
    !hasMixedLegs(keypoints);

  if (sittingOk) {
    return buildResult(
      'ok',
      visibleCount,
      true,
      true,
      true,
      true,
      'All good',
      'You are sitting properly in frame.',
    );
  }

  return buildResult(
    'not_sitting',
    visibleCount,
    true,
    false,
    faceClear,
    noCrop,
    'Sit properly',
    'Sit cross-legged with both knees bent and visible.',
  );
}
