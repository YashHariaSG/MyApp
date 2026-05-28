import { Worklets } from 'react-native-worklets-core';
import {
  classifySeatedPosture,
  evaluateFramePresence,
  hasUpperBody,
  isClearlyOutOfFrame,
  isSceneTooDark,
} from './framePresence';
import { parseMlkitPayload } from './mlkitPose';
import {
  POSE_MISS_FRAMES_NO_PERSON,
  POSE_STATUS_LEAVE_OK_FRAMES,
  POSE_STATUS_OK_FRAMES,
  POSE_STATUS_STABLE_FRAMES,
  POSE_UI_INTERVAL_MS,
} from './poseCaptureConfig';
import {
  diagnoseUpperBody,
  formatUpperBodyDiag,
} from './personDetectionDebug';
import { logPresencePipeline, logPresenceResult } from './poseFrameDebug';
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
let pushNoPersonFn: ((luminance?: number) => void) | null = null;
let lastUiMs = 0;

let lastFramePosture: ReturnType<typeof classifySeatedPosture> = 'unknown';

let missStreak = 0;
let successLatched = false;
let latchedPresence: PresenceResult | null = null;
let successStartedAtMs: number | null = null;
let smoothedLuminance = 255;

let displayedPresence: PresenceResult | null = null;
let candidateStatus: PresenceStatus | null = null;
let candidateStreak = 0;

const UI_INTERVAL_MS = POSE_UI_INTERVAL_MS;
const LATCH_SUCCESS_MS = 3000;

const MISS_FRAMES_NO_PERSON = POSE_MISS_FRAMES_NO_PERSON;
const STATUS_STABLE_FRAMES = POSE_STATUS_STABLE_FRAMES;
const STATUS_OK_FRAMES = POSE_STATUS_OK_FRAMES;
const STATUS_LEAVE_OK_FRAMES = POSE_STATUS_LEAVE_OK_FRAMES;

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

export function getPushNoPerson(): (luminance?: number) => void {
  if (pushNoPersonFn == null) {
    pushNoPersonFn = Worklets.createRunOnJS(applyNoPerson);
  }
  return pushNoPersonFn;
}

function resetStability(): void {
  lastFramePosture = 'unknown';
  missStreak = 0;
  displayedPresence = null;
  candidateStatus = null;
  candidateStreak = 0;
  smoothedLuminance = 255;
  successLatched = false;
  latchedPresence = null;
  successStartedAtMs = null;
}

function updateLuminance(luminance: number | null | undefined): void {
  if (luminance == null || !Number.isFinite(luminance)) {
    return;
  }
  smoothedLuminance = smoothedLuminance * 0.65 + luminance * 0.35;
}

function personDetected(keypoints: Keypoint[]): boolean {
  return hasUpperBody(keypoints) && !isClearlyOutOfFrame(keypoints);
}

function updateStablePresence(keypoints: Keypoint[]): PresenceResult {
  lastFramePosture = classifySeatedPosture(keypoints);

  const result = evaluateFramePresence(keypoints, 0, false, {
    luminance: smoothedLuminance,
  });

  return {
    ...result,
    debug: {
      sitting: result.isSitting ? 100 : 0,
      frame: lastFramePosture === 'sitting' ? 100 : 0,
      luminance: Math.round(smoothedLuminance),
    },
  };
}

function trackSuccessLatch(raw: PresenceResult): PresenceResult {
  if (successLatched && latchedPresence) {
    return latchedPresence;
  }

  if (raw.status === 'ok') {
    const now = Date.now();
    if (successStartedAtMs == null) {
      successStartedAtMs = now;
    } else if (now - successStartedAtMs >= LATCH_SUCCESS_MS) {
      successLatched = true;
      latchedPresence = { ...raw };
      return latchedPresence;
    }
  } else {
    successStartedAtMs = null;
  }

  return raw;
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

  raw = trackSuccessLatch(raw);

  const now = Date.now();
  if (now - lastUiMs < UI_INTERVAL_MS) {
    logPresencePipeline({
      source: 'emit_skip_throttle',
      smoothedLuma: Math.round(smoothedLuminance),
      missStreak,
      status: raw.status,
      visibleCount: raw.visibleCount,
      title: raw.title,
      uiSkipped: true,
    });
    return;
  }
  lastUiMs = now;

  const displayed = stabilizeDisplay(raw);
  logPresenceResult(displayed);
  listener({ presence: displayed });
}

function applyNoPerson(luminance?: number): void {
  if (!listener) {
    return;
  }

  if (successLatched && latchedPresence) {
    emitPresence(latchedPresence);
    return;
  }

  updateLuminance(luminance);

  if (isSceneTooDark(smoothedLuminance)) {
    const raw = evaluateFramePresence([], 0, false, {
      luminance: smoothedLuminance,
    });
    logPresencePipeline({
      source: 'no_person',
      rawLuma: luminance != null ? Math.round(luminance) : undefined,
      smoothedLuma: Math.round(smoothedLuminance),
      missStreak,
      status: raw.status,
      visibleCount: raw.visibleCount,
      title: raw.title,
    });
    emitPresence({
      ...raw,
      debug: {
        sitting: 0,
        frame: 0,
        luminance: Math.round(smoothedLuminance),
      },
    });
    return;
  }

  missStreak += 1;

  if (missStreak < MISS_FRAMES_NO_PERSON) {
    logPresencePipeline({
      source: 'no_person',
      rawLuma: luminance != null ? Math.round(luminance) : undefined,
      smoothedLuma: Math.round(smoothedLuminance),
      missStreak,
      status: displayedPresence?.status ?? 'holding',
      visibleCount: displayedPresence?.visibleCount ?? 0,
      title: `holding (${missStreak}/${MISS_FRAMES_NO_PERSON})`,
    });
    if (displayedPresence != null) {
      emitPresence(displayedPresence);
    }
    return;
  }

  const raw = evaluateFramePresence([], 0, false, {
    luminance: smoothedLuminance,
  });
  logPresencePipeline({
    source: 'no_person',
    rawLuma: luminance != null ? Math.round(luminance) : undefined,
    smoothedLuma: Math.round(smoothedLuminance),
    missStreak,
    status: raw.status,
    visibleCount: raw.visibleCount,
    title: raw.title,
    rejectReason:
      'no pose frames (null/empty) or miss streak exceeded — empty keypoints',
  });
  emitPresence({
    ...raw,
    debug: { sitting: 0, frame: 0, luminance: Math.round(smoothedLuminance) },
  });
}

function applyPosePayload(payload: string): void {
  if (!listener) {
    return;
  }

  if (successLatched && latchedPresence) {
    emitPresence(latchedPresence);
    return;
  }

  if (payload.length === 0) {
    logPresencePipeline({
      source: 'pose_rejected',
      smoothedLuma: Math.round(smoothedLuminance),
      missStreak,
      status: 'empty_payload',
      visibleCount: 0,
      title: 'ML Kit returned no landmarks above threshold',
      rejectReason:
        'worklet payload empty — native pose null/{} or all landmarks below conf gate',
    });
    applyNoPerson(undefined);
    return;
  }

  const { keypoints: rawKeypoints, meta } = parseMlkitPayload(payload);
  updateLuminance(meta.luminance);

  if (!personDetected(rawKeypoints)) {
    const diag = diagnoseUpperBody(rawKeypoints);
    logPresencePipeline({
      source: 'pose_rejected',
      rawLuma: meta.luminance != null ? Math.round(meta.luminance) : undefined,
      smoothedLuma: Math.round(smoothedLuminance),
      missStreak,
      status: 'no_upper_body',
      visibleCount: rawKeypoints.filter(p => p.score >= 0.4).length,
      title: 'Landmarks parsed but person not detected',
      rejectReason: formatUpperBodyDiag(diag),
      frameSize: `${meta.frameWidth}x${meta.frameHeight}`,
    });
    console.log('[PoseReject]', formatUpperBodyDiag(diag));
    applyNoPerson(meta.luminance ?? undefined);
    return;
  }

  missStreak = 0;
  const raw = updateStablePresence(rawKeypoints);
  logPresencePipeline({
    source: 'pose',
    rawLuma: meta.luminance != null ? Math.round(meta.luminance) : undefined,
    smoothedLuma: Math.round(smoothedLuminance),
    missStreak,
    status: raw.status,
    visibleCount: raw.visibleCount,
    title: raw.title,
  });
  emitPresence(raw);
}
