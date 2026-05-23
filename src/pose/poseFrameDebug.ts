import { Worklets } from 'react-native-worklets-core';
import type { PresenceResult } from './types';

export type FrameCaptureLog = {
  tick: number;
  width: number;
  height: number;
  pixelFormat: string;
  rawLuma: number;
  pose: 'null' | 'empty' | 'empty_object' | 'ok' | 'error';
  landmarkKeys?: number;
  payloadLen?: number;
  error?: string;
};

export type PresencePipelineLog = {
  source: 'no_person' | 'pose' | 'pose_rejected' | 'emit_skip_throttle';
  rawLuma?: number;
  smoothedLuma: number;
  missStreak: number;
  status: string;
  visibleCount: number;
  title: string;
  uiSkipped?: boolean;
  rejectReason?: string;
  frameSize?: string;
  payloadPreview?: string;
};

let logFrameCaptureFn: ((entry: FrameCaptureLog) => void) | null = null;
let logPresencePipelineFn: ((entry: PresencePipelineLog) => void) | null = null;

export function getLogFrameCapture(): (entry: FrameCaptureLog) => void {
  if (logFrameCaptureFn == null) {
    logFrameCaptureFn = Worklets.createRunOnJS((entry: FrameCaptureLog) => {
      console.log('[PoseFrame]', JSON.stringify(entry));
    });
  }
  return logFrameCaptureFn;
}

export function logPresencePipeline(entry: PresencePipelineLog): void {
  if (logPresencePipelineFn == null) {
    logPresencePipelineFn = Worklets.createRunOnJS((e: PresencePipelineLog) => {
      const parts = [
        `[PosePipeline] ${e.source}`,
        `status=${e.status}`,
        `title=${e.title}`,
        `visible=${e.visibleCount}`,
        `miss=${e.missStreak}`,
        `luma=${e.smoothedLuma}`,
      ];
      if (e.rawLuma != null) {
        parts.push(`rawLuma=${e.rawLuma}`);
      }
      if (e.frameSize) {
        parts.push(`frame=${e.frameSize}`);
      }
      if (e.rejectReason) {
        parts.push(`why=${e.rejectReason}`);
      }
      if (e.payloadPreview) {
        parts.push(`payload=${e.payloadPreview}`);
      }
      console.log(parts.join(' | '));
    });
  }
  logPresencePipelineFn(entry);
}

/** Full HUD / presence output after each capture interval. */
export function logPresenceResult(result: PresenceResult): void {
  const checks = result.checks
    .map(c => `${c.passed ? '✓' : '✗'} ${c.label}`)
    .join(' | ');
  console.log(
    [
      '',
      '──────── Pose capture result ────────',
      `time: ${new Date().toISOString()}`,
      `status: ${result.status}`,
      `title: ${result.title}`,
      `message: ${result.message}`,
      `visible: ${result.visibleCount} | inFrame: ${result.isInFrame} | sitting: ${result.isSitting}`,
      `debug: sitting=${result.debug?.sitting ?? '—'} frame=${result.debug?.frame ?? '—'} lux=${result.debug?.luminance ?? '—'}`,
      `checks: ${checks || '(none)'}`,
      '────────────────────────────────────',
      '',
    ].join('\n'),
  );
}
