import { Worklets } from 'react-native-worklets-core';
import {
  evaluateFramePresence,
  getSittingScore,
  hasUpperBody,
  isStanding,
} from './framePresence';
import { keypointsFromMlkitPayload } from './mlkitPose';
import type { Keypoint, PresenceResult } from './types';

export type PoseUpdate = {
  presence: PresenceResult;
};

type PoseListener = (update: PoseUpdate) => void;

type PreviewConfig = {
  width: number;
  height: number;
  mirror: boolean;
};

let listener: PoseListener | null = null;
let pushPosePayloadFn: ((payload: string) => void) | null = null;
let pushNoPersonFn: (() => void) | null = null;
let lastUiMs = 0;
let cachedPresence: PresenceResult | null = null;

let smoothedScore = 0;
let okStreak = 0;
let standingStreak = 0;
let sittingLocked = false;

const UI_INTERVAL_MS = 50;
const SCORE_SMOOTHING = 0.3;
const OK_FRAMES_NEEDED = 4;
const STANDING_FRAMES = 2;

export function setPreviewConfig(_config: PreviewConfig): void {}

export function setPoseListener(fn: PoseListener | null): void {
  listener = fn;
  if (fn == null) {
    cachedPresence = null;
    smoothedScore = 0;
    okStreak = 0;
    standingStreak = 0;
    sittingLocked = false;
  }
}

export function getPushPosePayload(): (payload: string) => void {
  if (pushPosePayloadFn == null) {
    pushPosePayloadFn = Worklets.createRunOnJS(applyPosePayload);
  }
  return pushPosePayloadFn;
}

export function getPushNoPerson(): () => void {
  if (pushNoPersonFn == null) {
    pushNoPersonFn = Worklets.createRunOnJS(applyNoPerson);
  }
  return pushNoPersonFn;
}

function resetStability(): void {
  smoothedScore = 0;
  okStreak = 0;
  standingStreak = 0;
  sittingLocked = false;
}

function updateStablePresence(keypoints: Keypoint[]): PresenceResult {
  const frameScore = getSittingScore(keypoints);
  smoothedScore =
    smoothedScore * (1 - SCORE_SMOOTHING) + frameScore * SCORE_SMOOTHING;

  if (isStanding(keypoints)) {
    standingStreak += 1;
  } else {
    standingStreak = 0;
  }

  if (standingStreak >= STANDING_FRAMES) {
    sittingLocked = false;
    okStreak = 0;
    return evaluateFramePresence(keypoints, smoothedScore, false);
  }

  if (sittingLocked) {
    if (smoothedScore < 36) {
      sittingLocked = false;
      okStreak = 0;
    }
  } else if (smoothedScore >= 45) {
    okStreak += 1;
    if (okStreak >= OK_FRAMES_NEEDED) {
      sittingLocked = true;
    }
  } else {
    okStreak = Math.max(0, okStreak - 1);
  }

  return evaluateFramePresence(keypoints, smoothedScore, sittingLocked);
}

function applyNoPerson(): void {
  if (!listener) {
    return;
  }

  resetStability();
  const now = Date.now();
  cachedPresence = evaluateFramePresence([], 0, false);

  if (now - lastUiMs < UI_INTERVAL_MS) {
    return;
  }
  lastUiMs = now;

  listener({ presence: cachedPresence });
}

function applyPosePayload(payload: string): void {
  if (!listener || payload.length === 0) {
    return;
  }

  const rawKeypoints = keypointsFromMlkitPayload(payload);

  if (!hasUpperBody(rawKeypoints)) {
    applyNoPerson();
    return;
  }

  const now = Date.now();
  cachedPresence = updateStablePresence(rawKeypoints);

  if (now - lastUiMs < UI_INTERVAL_MS) {
    return;
  }
  lastUiMs = now;

  listener({ presence: cachedPresence });
}
