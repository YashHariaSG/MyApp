import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { BodyPosition, Keypoint, PresenceStatus } from '../pose/types';
import { POSE_CONNECTIONS } from '../pose/poseSkeleton';

type Props = {
  width: number;
  height: number;
  keypoints: Keypoint[];
  position: BodyPosition | null;
  presenceStatus?: PresenceStatus;
};

const MIN_LINE_SCORE = 0.3;

function SkeletonLine({
  x1,
  y1,
  x2,
  y2,
  color,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length < 2) {
    return null;
  }
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

  return (
    <View
      style={[
        styles.line,
        {
          left: x1,
          top: y1,
          width: length,
          backgroundColor: color,
          transform: [{ rotate: `${angle}deg` }],
        },
      ]}
    />
  );
}

function PoseOverlayInner({
  width,
  height,
  keypoints,
  position,
  presenceStatus = 'no_person',
}: Props) {
  if (width === 0 || height === 0 || keypoints.length === 0) {
    return null;
  }

  const lineColor =
    presenceStatus === 'ok'
      ? '#39ff14'
      : presenceStatus === 'out_of_frame'
        ? '#ff9f0a'
        : presenceStatus === 'not_sitting'
          ? '#5ac8fa'
          : '#7dd3fc';
  const jointColor = presenceStatus === 'ok' ? '#7dffb2' : '#ff8a8a';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {POSE_CONNECTIONS.map(([from, to]) => {
        const a = keypoints[from];
        const b = keypoints[to];
        if (!a || !b || a.score < MIN_LINE_SCORE || b.score < MIN_LINE_SCORE) {
          return null;
        }
        return (
          <SkeletonLine
            key={`${from}-${to}`}
            x1={a.x * width}
            y1={a.y * height}
            x2={b.x * width}
            y2={b.y * height}
            color={lineColor}
          />
        );
      })}

      {keypoints.map(kp => {
        if (kp.score < MIN_LINE_SCORE) {
          return null;
        }
        return (
          <View
            key={kp.name}
            style={[
              styles.joint,
              {
                left: kp.x * width - 4,
                top: kp.y * height - 4,
                backgroundColor: jointColor,
              },
            ]}
          />
        );
      })}

      {position != null && position.confidence >= MIN_LINE_SCORE && (
        <View
          style={[
            styles.positionDot,
            {
              left: position.x * width - 8,
              top: position.y * height - 8,
            },
          ]}
        />
      )}
    </View>
  );
}

export default memo(PoseOverlayInner);

const styles = StyleSheet.create({
  line: {
    position: 'absolute',
    height: 3,
    transformOrigin: 'left center',
  },
  joint: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  positionDot: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#ffd60a',
    backgroundColor: 'rgba(255, 214, 10, 0.35)',
  },
});
