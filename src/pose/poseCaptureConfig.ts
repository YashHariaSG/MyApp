/**
 * How often the frame processor runs ML Kit pose detection.
 * 1 sec → 1 FPS via runAtTargetFps(1 / intervalSec).
 */
export const POSE_CAPTURE_INTERVAL_SEC = 1;

export const POSE_CAPTURE_FPS = 1 / POSE_CAPTURE_INTERVAL_SEC;

/** With slow capture, apply each sample immediately (no multi-frame hold). */
export const POSE_UI_INTERVAL_MS = 0;
export const POSE_MISS_FRAMES_NO_PERSON = 1;
export const POSE_STATUS_STABLE_FRAMES = 1;
export const POSE_STATUS_OK_FRAMES = 1;
export const POSE_STATUS_LEAVE_OK_FRAMES = 1;
