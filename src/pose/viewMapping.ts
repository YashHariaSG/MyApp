import type { Keypoint } from './types';

/**
 * Map keypoints to on-screen preview (0–1).
 * ML Kit gives pixel coords → already normalized to full frame in mlkitPose.ts.
 */
export function mapKeypointsToPreview(
  keypoints: Keypoint[],
  frameWidth: number,
  frameHeight: number,
  viewWidth: number,
  viewHeight: number,
  mirror: boolean,
): Keypoint[] {
  if (frameWidth <= 0 || frameHeight <= 0 || viewWidth <= 0 || viewHeight <= 0) {
    return keypoints;
  }

  const frameAspect = frameWidth / frameHeight;
  const viewAspect = viewWidth / viewHeight;

  return keypoints.map(kp => {
    let frameX = kp.x;
    let frameY = kp.y;

    // Pixel coords (unlikely from our pipeline) → normalize to full frame.
    if (frameX > 1.5 || frameY > 1.5) {
      frameX /= frameWidth;
      frameY /= frameHeight;
    }

    if (mirror) {
      frameX = 1 - frameX;
    }

    let viewX: number;
    let viewY: number;

    if (frameAspect > viewAspect) {
      const scale = viewHeight / frameHeight;
      const displayedWidth = frameWidth * scale;
      const offsetX = (viewWidth - displayedWidth) / 2;
      viewX = frameX * frameWidth * scale + offsetX;
      viewY = frameY * frameHeight * scale;
    } else {
      const scale = viewWidth / frameWidth;
      const displayedHeight = frameHeight * scale;
      const offsetY = (viewHeight - displayedHeight) / 2;
      viewX = frameX * frameWidth * scale;
      viewY = frameY * frameHeight * scale + offsetY;
    }

    return {
      ...kp,
      x: viewX / viewWidth,
      y: viewY / viewHeight,
    };
  });
}

export function smoothKeypoints(
  previous: Keypoint[],
  next: Keypoint[],
  alpha: number,
): Keypoint[] {
  if (previous.length !== next.length) {
    return next;
  }

  return next.map((kp, i) => {
    const prev = previous[i];
    if (!prev || kp.score < 0.2) {
      return kp;
    }
    if (prev.score < 0.2) {
      return kp;
    }
    const t = alpha;
    return {
      ...kp,
      x: prev.x * (1 - t) + kp.x * t,
      y: prev.y * (1 - t) + kp.y * t,
      score: Math.max(prev.score, kp.score),
    };
  });
}
