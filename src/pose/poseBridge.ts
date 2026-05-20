import { Worklets } from 'react-native-worklets-core';
import {
  evaluateFramePresence,
  getSittingScore,
  hasUpperBody,
  isClearlyOutOfFrame,
  isStanding,
} from './framePresence';
import { keypointsFromMlkitPayload } from './mlkitPose';
import type { Keypoint, PresenceResult, PresenceStatus } from './types';

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

let smoothedSitting = 0;
let lastFrameSitting = 0;
let okStreak = 0;
let standingStreak = 0;
let sittingLocked = false;

let missStreak = 0;
let badSittingStreak = 0;

let displayedPresence: PresenceResult | null = null;
let candidateStatus: PresenceStatus | null = null;
let candidateStreak = 0;

const UI_INTERVAL_MS = 100;
const OK_FRAMES_NEEDED = 3;
const STANDING_FRAMES = 3;
const LOCK_SITTING = 72;
const BAD_SITTING_UNLOCK = 4;

const MISS_FRAMES_NO_PERSON = 8;
const STATUS_STABLE_FRAMES = 3;
const STATUS_OK_FRAMES = 2;
const STATUS_LEAVE_OK_FRAMES = 5;

export function setPreviewConfig(_config: PreviewConfig): void {}

export function setPoseListener(fn: PoseListener | null): void {
  listener = fn;
  if (fn == null) {
    resetStability();
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
  smoothedSitting = 0;
  lastFrameSitting = 0;
  okStreak = 0;
  standingStreak = 0;
  sittingLocked = false;
  missStreak = 0;
  badSittingStreak = 0;
  displayedPresence = null;
  candidateStatus = null;
  candidateStreak = 0;
}

function personDetected(keypoints: Keypoint[]): boolean {
  return hasUpperBody(keypoints) && !isClearlyOutOfFrame(keypoints);
}

/** Update smoothed score without the slow 2→60 ramp loop. */
function updateSmoothedScore(frameSitting: number): void {
  lastFrameSitting = frameSitting;

  if (frameSitting >= LOCK_SITTING) {
    smoothedSitting = Math.max(smoothedSitting, frameSitting);
    return;
  }

  if (frameSitting < 0) {
    return;
  }

  if (frameSitting === 0) {
    smoothedSitting = Math.max(0, smoothedSitting - 8);
    return;
  }

  smoothedSitting = Math.max(
    smoothedSitting,
    smoothedSitting * 0.4 + frameSitting * 0.6,
  );
}

function updateStablePresence(keypoints: Keypoint[]): PresenceResult {
  const frameSitting = getSittingScore(keypoints);
  updateSmoothedScore(frameSitting);

  if (isStanding(keypoints)) {
    standingStreak += 1;
  } else {
    standingStreak = 0;
  }

  if (standingStreak >= STANDING_FRAMES) {
    sittingLocked = false;
    okStreak = 0;
    badSittingStreak = 0;
    smoothedSitting = 0;
  } else if (frameSitting >= LOCK_SITTING) {
    okStreak += 1;
    badSittingStreak = 0;
    if (okStreak >= OK_FRAMES_NEEDED) {
      sittingLocked = true;
    }
  } else if (frameSitting === 0) {
    okStreak = 0;
    if (sittingLocked) {
      badSittingStreak += 1;
      if (badSittingStreak >= BAD_SITTING_UNLOCK) {
        sittingLocked = false;
        smoothedSitting = 0;
        badSittingStreak = 0;
      }
    }
  } else if (frameSitting < 0 && sittingLocked) {
    // Missing leg landmarks while locked is treated as weak negative evidence.
    badSittingStreak += 1;
    if (badSittingStreak >= BAD_SITTING_UNLOCK + 2) {
      sittingLocked = false;
      smoothedSitting = 0;
      badSittingStreak = 0;
    }
  } else if (frameSitting > 0 && frameSitting < LOCK_SITTING) {
    okStreak = Math.max(0, okStreak - 1);
  }

  const result = evaluateFramePresence(
    keypoints,
    smoothedSitting,
    sittingLocked,
  );

  return {
    ...result,
    debug: {
      sitting: Math.round(smoothedSitting),
      frame: lastFrameSitting,
    },
  };
}

function framesNeededForStatus(status: PresenceStatus): number {
  if (status === 'ok') {
    return STATUS_OK_FRAMES;
  }
  if (displayedPresence?.status === 'ok') {
    return STATUS_LEAVE_OK_FRAMES;
  }
  return STATUS_STABLE_FRAMES;
}

function stabilizeDisplay(raw: PresenceResult): PresenceResult {
  const nextStatus = raw.status;

  if (displayedPresence == null) {
    displayedPresence = raw;
    candidateStatus = nextStatus;
    candidateStreak = 1;
    return raw;
  }

  if (nextStatus === displayedPresence.status) {
    candidateStatus = nextStatus;
    candidateStreak = 0;
    displayedPresence = raw;
    return raw;
  }

  if (candidateStatus === nextStatus) {
    candidateStreak += 1;
  } else {
    candidateStatus = nextStatus;
    candidateStreak = 1;
  }

  if (candidateStreak >= framesNeededForStatus(nextStatus)) {
    displayedPresence = raw;
    return raw;
  }

  return displayedPresence;
}

function emitPresence(raw: PresenceResult): void {
  if (!listener) {
    return;
  }

  const now = Date.now();
  if (now - lastUiMs < UI_INTERVAL_MS) {
    return;
  }
  lastUiMs = now;

  listener({ presence: stabilizeDisplay(raw) });
}

function applyNoPerson(): void {
  if (!listener) {
    return;
  }

  missStreak += 1;
  okStreak = 0;

  if (missStreak < MISS_FRAMES_NO_PERSON) {
    if (displayedPresence != null) {
      emitPresence(displayedPresence);
    }
    return;
  }

  if (sittingLocked && missStreak < MISS_FRAMES_NO_PERSON * 2) {
    if (displayedPresence != null) {
      emitPresence(displayedPresence);
    }
    return;
  }

  sittingLocked = false;
  badSittingStreak = 0;
  smoothedSitting = 0;
  lastFrameSitting = 0;

  const raw = evaluateFramePresence([], 0, false);
  emitPresence({ ...raw, debug: { sitting: 0, frame: 0 } });
}

function applyPosePayload(payload: string): void {
  if (!listener || payload.length === 0) {
    return;
  }

  const rawKeypoints = keypointsFromMlkitPayload(payload);

  if (!personDetected(rawKeypoints)) {
    applyNoPerson();
    return;
  }

  missStreak = 0;
  emitPresence(updateStablePresence(rawKeypoints));
}
