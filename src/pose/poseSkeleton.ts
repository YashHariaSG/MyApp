import type { BodyPosition, Keypoint } from './types';

export const KEYPOINT_NAMES = [
  'nose',
  'left_eye',
  'right_eye',
  'left_ear',
  'right_ear',
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
] as const;

/** Body skeleton lines (17-keypoint layout). */
export const POSE_CONNECTIONS: [number, number][] = [
  [0, 5],
  [0, 6],
  [5, 6],
  [5, 7],
  [7, 9],
  [6, 8],
  [8, 10],
  [5, 11],
  [6, 12],
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
];

const MIN_SCORE = 0.25;

export function getBodyPosition(keypoints: Keypoint[]): BodyPosition | null {
  const leftHip = keypoints[11];
  const rightHip = keypoints[12];

  if (!leftHip || !rightHip) {
    return null;
  }

  if (leftHip.score < MIN_SCORE && rightHip.score < MIN_SCORE) {
    return null;
  }

  const totalScore = leftHip.score + rightHip.score;
  const weightLeft = totalScore > 0 ? leftHip.score / totalScore : 0.5;
  const weightRight = totalScore > 0 ? rightHip.score / totalScore : 0.5;

  return {
    x: leftHip.x * weightLeft + rightHip.x * weightRight,
    y: leftHip.y * weightLeft + rightHip.y * weightRight,
    confidence: Math.max(leftHip.score, rightHip.score),
  };
}
