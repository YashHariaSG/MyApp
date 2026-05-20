import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { detectPose } from '@scottjgilroy/react-native-vision-camera-v4-pose-detection/src/detectPose';
import {
  Camera,
  runAsync,
  runAtTargetFps,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { estimateFrameLuminance } from '../pose/frameBrightness';
import { mlkitPoseToPayload } from '../pose/mlkitPose';
import {
  getPushNoPerson,
  getPushPosePayload,
  setPoseListener,
  setPreviewConfig,
} from '../pose/poseBridge';
import type { PresenceResult } from '../pose/types';

const INITIAL_PRESENCE: PresenceResult = {
  status: 'no_person',
  visibleCount: 0,
  isInFrame: false,
  isSitting: false,
  title: '',
  message: '',
  checks: [],
};

const POSE_OPTIONS = {
  mode: 'stream' as const,
  performanceMode: 'max' as const,
};

export default function PoseCameraScreen() {
  const device = useCameraDevice('front') ?? useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const [presence, setPresence] = useState<PresenceResult>(INITIAL_PRESENCE);

  const pushPosePayload = useMemo(() => getPushPosePayload(), []);
  const pushNoPerson = useMemo(() => getPushNoPerson(), []);
  const isFrontCamera = device?.position === 'front';

  useEffect(() => {
    setPoseListener(update => {
      setPresence(update.presence);
    });
    return () => setPoseListener(null);
  }, []);

  useEffect(() => {
    setPreviewConfig({
      width: layout.width,
      height: layout.height,
      mirror: isFrontCamera,
    });
  }, [layout.width, layout.height, isFrontCamera]);

  const frameProcessor = useFrameProcessor(
    frame => {
      'worklet';

      runAtTargetFps(10, () => {
        'worklet';
        runAsync(frame, () => {
          'worklet';
          try {
            const luminance = estimateFrameLuminance(frame);
            const pose = detectPose(frame, POSE_OPTIONS) as Record<
              string,
              unknown
            > | null;
            if (pose == null) {
              pushNoPerson(luminance);
              return;
            }
            const payload = mlkitPoseToPayload(
              pose,
              frame.width,
              frame.height,
              luminance,
            );
            if (payload.length > 0) {
              pushPosePayload(payload);
            } else {
              pushNoPerson(luminance);
            }
          } catch {
            // ML Kit busy or frame dropped — skip.
          }
        });
      });
    },
    [pushPosePayload, pushNoPerson],
  );

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  if (!hasPermission) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>Camera permission required</Text>
      </View>
    );
  }

  if (device == null) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>No camera found</Text>
      </View>
    );
  }

  const hudStyle = getHudStyle(presence.status);

  return (
    <View
      style={styles.container}
      onLayout={event => {
        const { width, height } = event.nativeEvent.layout;
        setLayout({ width, height });
      }}>
      <Camera
        style={styles.camera}
        device={device}
        isActive
        photo={false}
        video={false}
        audio={false}
        frameProcessor={frameProcessor}
      />

      <View style={[styles.hud, hudStyle.container]}>
        <Text style={styles.hudStatus}>
          {presence.status.toUpperCase().replace(/_/g, ' ')}
        </Text>
        {presence.title ? (
          <Text style={styles.hudTitle}>{presence.title}</Text>
        ) : null}
        {presence.message ? (
          <Text style={styles.hudMessage}>{presence.message}</Text>
        ) : null}

        {presence.checks.length > 0 ? (
          <View style={styles.checksRow}>
            {presence.checks.map(check => (
              <Text
                key={check.id}
                style={[
                  styles.check,
                  check.passed ? styles.checkPass : styles.checkFail,
                ]}>
                {check.passed ? '✓' : '✗'} {check.label}
              </Text>
            ))}
          </View>
        ) : null}

        <Text style={styles.debug}>
          visible: {presence.visibleCount} • inFrame:{' '}
          {presence.isInFrame ? 'yes' : 'no'} • sitting:{' '}
          {presence.isSitting ? 'yes' : 'no'} • score:{' '}
          {presence.debug?.sitting ?? 0} • frame:{' '}
          {presence.debug?.frame ?? '—'} • lux:{' '}
          {presence.debug?.luminance ?? '—'}
        </Text>
      </View>
    </View>
  );
}

function getHudStyle(status: PresenceResult['status']): {
  container: object;
} {
  switch (status) {
    case 'ok':
      return { container: styles.hudOk };
    case 'out_of_frame':
      return { container: styles.hudWarn };
    case 'not_sitting':
      return { container: styles.hudError };
    case 'too_dark':
      return { container: styles.hudDark };
    case 'no_person':
    default:
      return { container: styles.hudNeutral };
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
    padding: 24,
  },
  message: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
  },
  hud: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 32,
    padding: 14,
    borderRadius: 12,
    borderWidth: 2,
  },
  hudOk: {
    backgroundColor: 'rgba(20, 80, 40, 0.88)',
    borderColor: '#39ff14',
  },
  hudWarn: {
    backgroundColor: 'rgba(120, 80, 0, 0.88)',
    borderColor: '#ffb300',
  },
  hudError: {
    backgroundColor: 'rgba(120, 20, 20, 0.88)',
    borderColor: '#ff4d4d',
  },
  hudNeutral: {
    backgroundColor: 'rgba(40, 40, 40, 0.88)',
    borderColor: '#888',
  },
  hudDark: {
    backgroundColor: 'rgba(30, 30, 60, 0.9)',
    borderColor: '#7c8cff',
  },
  hudStatus: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.2,
    opacity: 0.8,
    marginBottom: 2,
  },
  hudTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 4,
  },
  hudMessage: {
    color: '#fff',
    fontSize: 13,
    opacity: 0.9,
    marginBottom: 8,
  },
  checksRow: {
    marginTop: 4,
    marginBottom: 6,
  },
  check: {
    fontSize: 12,
    marginVertical: 1,
  },
  checkPass: {
    color: '#9eff9e',
  },
  checkFail: {
    color: '#ffb0b0',
  },
  debug: {
    color: '#ddd',
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 4,
    opacity: 0.85,
  },
});
