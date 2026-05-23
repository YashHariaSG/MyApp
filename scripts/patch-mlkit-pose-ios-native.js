#!/usr/bin/env node
/**
 * Patch iOS VisionCameraV3PoseDetection.m:
 * 1. Expose ML Kit inFrameLikelihood per landmark (Android already does this).
 * 2. Fix right-shoulder using left-shoulder position (upstream bug).
 *
 * Without (1), JS treats every landmark score as 0 and hasUpperBody() always fails.
 */
const fs = require('fs');
const path = require('path');

const M_PATH = path.join(
  __dirname,
  '..',
  'node_modules',
  '@scottjgilroy',
  'react-native-vision-camera-v4-pose-detection',
  'ios',
  'VisionCameraV3PoseDetection.m',
);

const RIGHT_SHOULDER_BUG =
  'MLKVision3DPoint *position = leftShoulderPosition.position;\n                        data[@"rightShoulderPosition"]';

const RIGHT_SHOULDER_FIX =
  'MLKVision3DPoint *position = rightShoulderPosition.position;\n                        data[@"rightShoulderPosition"]';

function addInFrameLikelihood(source) {
  // data[@"key"] = @{@"x": @(position.x), @"y": @(position.y)};  (y may have extra spaces)
  return source.replace(
    /data\[@\"([^\"]+)\"\] = @\{@"x": @\(position\.x\), @"y": @\(\s*position\.y\)\};/g,
    (match, _key, offset, full) => {
      const before = full.slice(Math.max(0, offset - 400), offset);
      const landmarkMatch = before.match(
        /MLKPoseLandmark \*(\w+)\s*=\s*\[pose landmarkOfType:[^\]]+\];\s*\n\s*if \(\1\.inFrameLikelihood > 0\.5\) \{\s*\n\s*MLKVision3DPoint \*position = \1\.position;\s*$/s,
      );
      if (!landmarkMatch) {
        return match;
      }
      const varName = landmarkMatch[1];
      return `data[@"${_key}"] = @{@"x": @(position.x), @"y": @(position.y), @"inFrameLikelihood": @(${varName}.inFrameLikelihood)};`;
    },
  );
}

function main() {
  if (!fs.existsSync(M_PATH)) {
    console.log(
      '[patch-mlkit-pose-ios-native] Plugin not installed yet — skipping.',
    );
    return;
  }

  let source = fs.readFileSync(M_PATH, 'utf8');
  let changed = false;

  if (source.includes(RIGHT_SHOULDER_BUG)) {
    source = source.replace(RIGHT_SHOULDER_BUG, RIGHT_SHOULDER_FIX);
    changed = true;
    console.log(
      '[patch-mlkit-pose-ios-native] ✓ Fixed right-shoulder position copy-paste bug.',
    );
  }

  const next = addInFrameLikelihood(source);
  if (next !== source) {
    source = next;
    changed = true;
    console.log(
      '[patch-mlkit-pose-ios-native] ✓ Added inFrameLikelihood to iOS landmarks.',
    );
  } else if (source.includes('@"inFrameLikelihood"')) {
    console.log(
      '[patch-mlkit-pose-ios-native] All landmarks already include inFrameLikelihood.',
    );
  } else {
    console.warn(
      '[patch-mlkit-pose-ios-native] Could not inject inFrameLikelihood — file layout changed?',
    );
  }

  if (changed) {
    fs.writeFileSync(M_PATH, source, 'utf8');
  }
}

main();
