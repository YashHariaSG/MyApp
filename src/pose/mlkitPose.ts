import { KEYPOINT_NAMES } from './poseSkeleton';
import type { Keypoint } from './types';

/** Native ML Kit plugin keys (Android/iOS). */
const MLKIT_LANDMARKS: { key: string; index: number }[] = [
  { key: 'nosePosition', index: 0 },
  { key: 'leftShoulderPosition', index: 5 },
  { key: 'rightShoulderPosition', index: 6 },
  { key: 'leftElbowPosition', index: 7 },
  { key: 'rightElbowPosition', index: 8 },
  { key: 'leftWristPosition', index: 9 },
  { key: 'rightWristPosition', index: 10 },
  { key: 'leftHipPosition', index: 11 },
  { key: 'rightHipPosition', index: 12 },
  { key: 'leftKneePosition', index: 13 },
  { key: 'rightKneePosition', index: 14 },
  { key: 'leftAnklePosition', index: 15 },
  { key: 'rightAnklePosition', index: 16 },
];

const PAYLOAD_KEYS = MLKIT_LANDMARKS.map(l => l.key);

type LandmarkPoint = { x: number; y: number };

function readLandmark(
  pose: Record<string, unknown>,
  key: string,
): LandmarkPoint | null {
  const raw = pose[key] as LandmarkPoint | undefined;
  if (raw == null || typeof raw.x !== 'number' || typeof raw.y !== 'number') {
    return null;
  }
  if (raw.x === 0 && raw.y === 0) {
    return null;
  }
  return raw;
}

/** Worklet-safe string payload for JS bridge. */
export function mlkitPoseToPayload(
  pose: Record<string, unknown>,
  frameWidth: number,
  frameHeight: number,
): string {
  'worklet';

  if (pose == null) {
    return '';
  }

  let body = '';
  for (let i = 0; i < PAYLOAD_KEYS.length; i++) {
    const key = PAYLOAD_KEYS[i];
    const lm = pose[key] as LandmarkPoint | undefined;
    if (lm == null || lm.x == null || lm.y == null) {
      continue;
    }
    if (lm.x === 0 && lm.y === 0) {
      continue;
    }
    if (body.length > 0) {
      body += ';';
    }
    body += `${key}:${lm.x},${lm.y}`;
  }

  if (body.length === 0) {
    return '';
  }

  return `${body}|${frameWidth}|${frameHeight}`;
}

/** Parse ML Kit payload → 17 keypoints normalized to frame (0–1). */
export function keypointsFromMlkitPayload(payload: string): Keypoint[] {
  const pipe = payload.indexOf('|');
  if (pipe < 0) {
    return [];
  }

  const body = payload.slice(0, pipe);
  const meta = payload.slice(pipe + 1).split('|');
  const frameWidth = Number(meta[0]);
  const frameHeight = Number(meta[1]);

  if (!Number.isFinite(frameWidth) || !Number.isFinite(frameHeight)) {
    return [];
  }

  const pose: Record<string, LandmarkPoint> = {};
  for (const part of body.split(';')) {
    const colon = part.indexOf(':');
    if (colon < 0) {
      continue;
    }
    const key = part.slice(0, colon);
    const coords = part.slice(colon + 1).split(',');
    const x = Number(coords[0]);
    const y = Number(coords[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      pose[key] = { x, y };
    }
  }

  const empty: Keypoint = { name: '', x: 0, y: 0, score: 0 };
  const keypoints: Keypoint[] = Array.from({ length: 17 }, (_, i) => ({
    ...empty,
    name: KEYPOINT_NAMES[i] ?? `kp_${i}`,
  }));

  for (const { key, index } of MLKIT_LANDMARKS) {
    const lm = readLandmark(pose, key);
    if (lm == null) {
      continue;
    }
    keypoints[index] = {
      name: KEYPOINT_NAMES[index] ?? key,
      x: lm.x / frameWidth,
      y: lm.y / frameHeight,
      score: 0.85,
    };
  }

  return keypoints;
}
