declare module '@scottjgilroy/react-native-vision-camera-v4-pose-detection/src/detectPose' {
  import type { Frame } from 'react-native-vision-camera';

  export type PoseDetectionOptions = {
    mode?: 'stream' | 'single';
    performanceMode?: 'min' | 'max';
  };

  export function detectPose(
    frame: Frame,
    options?: PoseDetectionOptions,
  ): Record<string, { x: number; y: number }> | null;
}
