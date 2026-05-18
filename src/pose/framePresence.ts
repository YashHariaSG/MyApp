import type { Keypoint, PresenceResult } from './types';

const MIN_SCORE = 0.25;
const SITTING_ENTER = 45;
const SITTING_LEAVE = 36;

function kp(keypoints: Keypoint[], index: number): Keypoint | null {
  const point = keypoints[index];
  if (!point || point.score < MIN_SCORE) {
    return null;
  }
  return point;
}

function avgY(points: Keypoint[]): number {
  return points.reduce((sum, p) => sum + p.y, 0) / points.length;
}

export function hasUpperBody(keypoints: Keypoint[]): boolean {
  const hasHeadOrShoulders =
    kp(keypoints, 0) != null ||
    kp(keypoints, 5) != null ||
    kp(keypoints, 6) != null;
  const hasHips = kp(keypoints, 11) != null || kp(keypoints, 12) != null;
  return hasHeadOrShoulders && hasHips;
}

export function isStanding(keypoints: Keypoint[]): boolean {
  const lHip = kp(keypoints, 11);
  const rHip = kp(keypoints, 12);
  const lKnee = kp(keypoints, 13);
  const rKnee = kp(keypoints, 14);
  const lAnkle = kp(keypoints, 15);
  const rAnkle = kp(keypoints, 16);
  const nose = kp(keypoints, 0);

  if (!lHip || !rHip || !lKnee || !rKnee) {
    return false;
  }

  const hipY = avgY([lHip, rHip]);
  const kneeY = avgY([lKnee, rKnee]);
  const thighDrop = kneeY - hipY;

  if (lAnkle && rAnkle) {
    const leftShin = lAnkle.y - lKnee.y;
    const rightShin = rAnkle.y - rKnee.y;
    if (leftShin > 0.12 && rightShin > 0.12) {
      return true;
    }
    const ankleY = avgY([lAnkle, rAnkle]);
    if (nose && ankleY - nose.y > 0.52 && thighDrop > 0.15) {
      return true;
    }
  }

  return thighDrop > 0.26;
}

export function getSittingScore(keypoints: Keypoint[]): number {
  if (!hasUpperBody(keypoints) || isStanding(keypoints)) {
    return 0;
  }

  let score = 0;
  const lHip = kp(keypoints, 11);
  const rHip = kp(keypoints, 12);
  const lKnee = kp(keypoints, 13);
  const rKnee = kp(keypoints, 14);
  const lShoulder = kp(keypoints, 5);
  const rShoulder = kp(keypoints, 6);
  const lAnkle = kp(keypoints, 15);
  const rAnkle = kp(keypoints, 16);
  const nose = kp(keypoints, 0);

  if (!lHip || !rHip) {
    return 0;
  }

  const hipY = avgY([lHip, rHip]);

  if (lShoulder && rShoulder) {
    if (avgY([lShoulder, rShoulder]) < hipY - 0.03) {
      score += 25;
    }
  } else if (nose && nose.y < hipY) {
    score += 15;
  }

  if (lKnee && rKnee) {
    const thighDrop = avgY([lKnee, rKnee]) - hipY;
    if (thighDrop > 0.02 && thighDrop < 0.26) {
      score += 35;
    }
    if (lAnkle && rAnkle) {
      const avgShin =
        (lAnkle.y - lKnee.y + (rAnkle.y - rKnee.y)) / 2;
      if (avgShin < 0.12) {
        score += 30;
      } else if (avgShin < 0.15) {
        score += 18;
      }
    } else {
      score += 22;
    }
  } else {
    score += 8;
  }

  return Math.min(100, score);
}

function buildResult(
  status: PresenceResult['status'],
  visibleCount: number,
  isInFrame: boolean,
  isSitting: boolean,
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
      { id: 'visible', label: 'Visible in frame', passed: isInFrame },
      { id: 'sitting', label: 'Sitting posture', passed: isSitting },
    ],
  };
}

export function evaluateFramePresence(
  keypoints: Keypoint[],
  smoothedScore: number,
  sittingLocked: boolean,
): PresenceResult {
  const visibleCount = keypoints.filter(p => p.score >= MIN_SCORE).length;
  const inFrame = hasUpperBody(keypoints);

  if (!inFrame) {
    return buildResult(
      'no_person',
      visibleCount,
      false,
      false,
      'No one in view',
      'Sit in front of the camera.',
    );
  }

  if (isStanding(keypoints)) {
    return buildResult(
      'not_sitting',
      visibleCount,
      true,
      false,
      'Please sit down',
      'You are standing — please sit down.',
    );
  }

  const isSitting = sittingLocked
    ? smoothedScore >= SITTING_LEAVE
    : smoothedScore >= SITTING_ENTER;

  if (isSitting) {
    return buildResult(
      'ok',
      visibleCount,
      true,
      true,
      'All good',
      'You are sitting and visible in the frame.',
    );
  }

  return buildResult(
    'not_sitting',
    visibleCount,
    true,
    false,
    'Sit properly',
    'Sit down with knees bent and face the camera.',
  );
}
