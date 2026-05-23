import {
  hasClearFace,
  hasUpperBody,
  isClearlyOutOfFrame,
} from './framePresence';
import type { Keypoint } from './types';

const CORE_INDICES = [0, 1, 2, 5, 6, 11, 12] as const;
const CORE_NAMES = [
  'nose',
  'leftEye',
  'rightEye',
  'leftShoulder',
  'rightShoulder',
  'leftHip',
  'rightHip',
] as const;

export type UpperBodyDiag = {
  hasUpperBody: boolean;
  hasClearFace: boolean;
  outOfFrame: boolean;
  visibleHigh: number;
  coreConfSum: number;
  failures: string[];
  landmarks: string;
};

/** Why personDetected() rejected this frame (for Metro console). */
export function diagnoseUpperBody(keypoints: Keypoint[]): UpperBodyDiag {
  const failures: string[] = [];
  const nose = keypoints[0];
  const leftEye = keypoints[1];
  const rightEye = keypoints[2];
  const lSh = keypoints[5];
  const rSh = keypoints[6];
  const lHip = keypoints[11];
  const rHip = keypoints[12];

  const faceOk = hasClearFace(keypoints);
  if (!faceOk) {
    failures.push(
      `face: nose=${fmt(nose)} leftEye=${fmt(leftEye)} rightEye=${fmt(rightEye)} (need score≥0.58, in margin)`,
    );
  }

  if (!lSh || lSh.score < 0.5) {
    failures.push(`leftShoulder: ${fmt(lSh)} (need score≥0.5)`);
  }
  if (!rSh || rSh.score < 0.5) {
    failures.push(`rightShoulder: ${fmt(rSh)} (need score≥0.5)`);
  }

  const core = [nose, lSh, rSh, lHip, rHip];
  const coreConfSum = core.reduce(
    (s, p) => s + (p && typeof p.score === 'number' ? p.score : 0),
    0,
  );
  if (coreConfSum < 2.0) {
    failures.push(`coreConfSum=${coreConfSum.toFixed(2)} (need ≥2.0)`);
  }

  const visibleHigh = keypoints.filter(p => p.score >= 0.5).length;
  if (visibleHigh < 6) {
    failures.push(`visibleHigh=${visibleHigh} (need ≥6 landmarks with score≥0.5)`);
  }

  const upper = hasUpperBody(keypoints);
  const out = isClearlyOutOfFrame(keypoints);
  if (upper && out) {
    failures.push('upper body ok but isClearlyOutOfFrame=true');
  }

  const landmarks = CORE_INDICES.map((idx, i) => {
    const p = keypoints[idx];
    return `${CORE_NAMES[i]}=${fmt(p)}`;
  }).join(' ');

  return {
    hasUpperBody: upper,
    hasClearFace: faceOk,
    outOfFrame: out,
    visibleHigh,
    coreConfSum,
    failures,
    landmarks,
  };
}

function fmt(p: Keypoint | undefined): string {
  if (!p || (p.x === 0 && p.y === 0 && p.score === 0)) {
    return '—';
  }
  return `(${p.x.toFixed(3)},${p.y.toFixed(3)},s=${p.score.toFixed(2)})`;
}

export function formatUpperBodyDiag(diag: UpperBodyDiag): string {
  if (diag.failures.length === 0) {
    return `ok ${diag.landmarks}`;
  }
  return `${diag.failures.join(' | ')} || ${diag.landmarks}`;
}
