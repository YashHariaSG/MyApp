import React, { useEffect, useMemo, useState } from 'react';
import { AppState, Dimensions, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import {
  POSE_CAPTURE_FPS,
  POSE_CAPTURE_INTERVAL_SEC,
} from '../pose/poseCaptureConfig';
import { NOT_FULLY_VISIBLE_MESSAGE } from '../pose/framePresence';
import { getLogFrameCapture } from '../pose/poseFrameDebug';
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
  const frontDevice = useCameraDevice('front');
  const backDevice = useCameraDevice('back');
  const device = frontDevice ?? backDevice;
  const { hasPermission, requestPermission } = useCameraPermission();
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const [presence, setPresence] = useState<PresenceResult>(INITIAL_PRESENCE);
  const [appState, setAppState] = useState(AppState.currentState);
  const [resumeEpoch, setResumeEpoch] = useState(0);
  const [screenEpoch, setScreenEpoch] = useState(() => {
    const { width, height } = Dimensions.get('window');
    return `${width}x${height}`;
  });
  const insets = useSafeAreaInsets();

  const pushPosePayload = useMemo(() => getPushPosePayload(), []);
  const pushNoPerson = useMemo(() => getPushNoPerson(), []);
  const logFrameCapture = useMemo(() => getLogFrameCapture(), []);
  const isFrontCamera = device?.position === 'front';

  useEffect(() => {
    console.log(
      `[PoseCamera] Slow capture: 1 frame every ${POSE_CAPTURE_INTERVAL_SEC}s (${POSE_CAPTURE_FPS} FPS)`,
    );
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

  // Remount camera only when the window actually resizes (real UI rotation).
  // Do NOT use onPreviewOrientationChanged — on iOS it still fires while rotation
  // lock is on and causes a one-time HUD/camera rotation glitch.
  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setScreenEpoch(`${window.width}x${window.height}`);
    });
    return () => subscription.remove();
  }, []);

  // Notification shade / quick-settings toggles can temporarily break preview
  // transform state on some devices. Remount camera when app becomes active.
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      const wasBackgrounded = appState !== 'active' && next === 'active';
      setAppState(next);
      if (wasBackgrounded) {
        setResumeEpoch(prev => prev + 1);
      }
    });
    return () => sub.remove();
  }, [appState]);

  const frameProcessor = useFrameProcessor(
    frame => {
      'worklet';

      runAtTargetFps(POSE_CAPTURE_FPS, () => {
        'worklet';
        runAsync(frame, () => {
          'worklet';
          const baseLog = {
            tick: Date.now(),
            width: frame.width,
            height: frame.height,
            pixelFormat: String(frame.pixelFormat),
          };
          try {
            const luminance = estimateFrameLuminance(frame);
            const pose = detectPose(frame, POSE_OPTIONS) as Record<
              string,
              unknown
            > | null;
            const poseKeys =
              pose != null && typeof pose === 'object'
                ? Object.keys(pose as object).length
                : 0;
            if (pose == null || poseKeys === 0) {
              logFrameCapture({
                ...baseLog,
                rawLuma: Math.round(luminance),
                pose: pose == null ? 'null' : 'empty_object',
                landmarkKeys: poseKeys,
              });
              pushNoPerson(luminance);
              return;
            }
            const landmarkKeys = poseKeys;
            const payload = mlkitPoseToPayload(
              pose,
              frame.width,
              frame.height,
              luminance,
            );
            logFrameCapture({
              ...baseLog,
              rawLuma: Math.round(luminance),
              pose: payload.length > 0 ? 'ok' : 'empty',
              landmarkKeys,
              payloadLen: payload.length,
            });
            if (payload.length > 0) {
              pushPosePayload(payload);
            } else {
              pushNoPerson(luminance);
            }
          } catch (e) {
            logFrameCapture({
              ...baseLog,
              rawLuma: -1,
              pose: 'error',
              error: e instanceof Error ? e.message : String(e),
            });
          }
        });
      });
    },
    [pushPosePayload, pushNoPerson, logFrameCapture],
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
  const hudMessage = presence.message || NOT_FULLY_VISIBLE_MESSAGE;
  const cameraIsActive = appState === 'active';
  const cameraKey =
    Platform.OS === 'android'
      ? `${device.id}-${screenEpoch}-${resumeEpoch}`
      : device.id;

  return (
    <View
      style={styles.container}
      onLayout={event => {
        const { width, height } = event.nativeEvent.layout;
        setLayout({ width, height });
      }}>
      <Camera
        key={cameraKey}
        style={styles.camera}
        device={device}
        isActive={cameraIsActive}
        photo={false}
        video={false}
        audio={false}
        outputOrientation="preview"
        androidPreviewViewType="texture-view"
        frameProcessor={frameProcessor}
      />

      <View
        style={[
          styles.hud,
          hudStyle.container,
          { bottom: Math.max(16, insets.bottom + 12) },
        ]}>
        <Text style={styles.hudMessage}>{hudMessage}</Text>

        {/* <Text style={styles.debug}>
          capture: every {POSE_CAPTURE_INTERVAL_SEC}s • visible:{' '}
          {presence.visibleCount} • inFrame:{' '}
          {presence.isInFrame ? 'yes' : 'no'} • sitting:{' '}
          {presence.isSitting ? 'yes' : 'no'} • score:{' '}
          {presence.debug?.sitting ?? 0} • frame:{' '}
          {presence.debug?.frame ?? '—'} • lux:{' '}
          {presence.debug?.luminance ?? '—'}
        </Text> */}
      </View>
    </View>
  );
}

function getHudStyle(status: PresenceResult['status']): {
  container: object;
} {
  if (status === 'ok') {
    return { container: styles.hudOk };
  }
  return { container: styles.hudWarn };
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
  hudMessage: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 21,
    marginBottom: 8,
  },
  debug: {
    color: '#ddd',
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 4,
    opacity: 0.85,
  },
});
