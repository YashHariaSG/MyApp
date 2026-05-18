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
  title: 'Waiting…',
  message: 'Sit in view of the camera.',
  checks: [
    { id: 'visible', label: 'Visible in frame', passed: false },
    { id: 'sitting', label: 'Sitting posture', passed: false },
  ],
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

      runAtTargetFps(8, () => {
        'worklet';
        runAsync(frame, () => {
          'worklet';
          try {
            const pose = detectPose(frame, POSE_OPTIONS) as Record<
              string,
              unknown
            > | null;
            if (pose == null) {
              pushNoPerson();
              return;
            }
            const payload = mlkitPoseToPayload(
              pose,
              frame.width,
              frame.height,
            );
            if (payload.length > 0) {
              pushPosePayload(payload);
            } else {
              pushNoPerson();
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

  const hudStyle =
    presence.status === 'ok'
      ? styles.hudOk
      : presence.status === 'out_of_frame'
        ? styles.hudOutOfFrame
        : presence.status === 'not_sitting'
          ? styles.hudNotSitting
          : styles.hudNeutral;

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

      <View style={[styles.hud, hudStyle]}>
        <Text style={styles.hudTitle}>{presence.title}</Text>
        <Text style={styles.hudText}>{presence.message}</Text>
        {presence.checks.map(check => (
          <Text
            key={check.id}
            style={check.passed ? styles.checkPass : styles.checkFail}>
            {check.passed ? '✓' : '○'} {check.label}
          </Text>
        ))}
      </View>
    </View>
  );
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
  hudOutOfFrame: {
    backgroundColor: 'rgba(80, 50, 10, 0.88)',
    borderColor: '#ff9f0a',
  },
  hudNotSitting: {
    backgroundColor: 'rgba(40, 50, 90, 0.88)',
    borderColor: '#5ac8fa',
  },
  hudNeutral: {
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderColor: '#666',
  },
  hudTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 6,
  },
  hudText: {
    color: '#eee',
    fontSize: 14,
    lineHeight: 20,
  },
  checkPass: {
    color: '#b8ffb8',
    fontSize: 12,
    marginTop: 6,
  },
  checkFail: {
    color: '#ffccaa',
    fontSize: 12,
    marginTop: 6,
  },
});
