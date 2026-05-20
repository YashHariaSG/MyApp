import type { Frame } from 'react-native-vision-camera';

/** Grid step when sampling the Y plane (keeps worklet cost low). */
const SAMPLE_STEP = 28;

/** Rolling average below this (0–255) is treated as too dark. */
export const DIM_LUMINANCE_THRESHOLD = 52;

/**
 * Estimate average luma from the camera frame (Y plane of YUV, or R of RGB).
 * Returns 0–255; 255 when sampling fails so we do not false-alarm.
 */
export function estimateFrameLuminance(frame: Frame): number {
  'worklet';
  try {
    const data = new Uint8Array(frame.toArrayBuffer());
    const w = frame.width;
    const h = frame.height;
    const stride = frame.bytesPerRow;
    if (w <= 0 || h <= 0 || stride <= 0 || data.length === 0) {
      return 255;
    }

    const isRgb = frame.pixelFormat === 'rgb';
    const y0 = Math.floor(h * 0.12);
    const y1 = Math.floor(h * 0.88);
    const x0 = Math.floor(w * 0.12);
    const x1 = Math.floor(w * 0.88);

    let sum = 0;
    let count = 0;

    for (let y = y0; y < y1; y += SAMPLE_STEP) {
      for (let x = x0; x < x1; x += SAMPLE_STEP) {
        const row = Math.floor(y) * stride;
        const col = Math.floor(x);
        const idx = isRgb ? (row + col) * 3 : row + col;
        if (idx >= 0 && idx < data.length) {
          sum += data[idx];
          count += 1;
        }
      }
    }

    return count > 0 ? sum / count : 255;
  } catch {
    return 255;
  }
}
