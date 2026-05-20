#!/usr/bin/env node
/**
 * Patch @scottjgilroy/react-native-vision-camera-v4-pose-detection so the
 * native Android plugin also exposes ML Kit's `inFrameLikelihood` for each
 * landmark. Without this we cannot tell visible body parts from hallucinated
 * (low-confidence) ones, which leads to false-positive pose detections when
 * the camera is pointed at a wall or ceiling.
 */
const fs = require('fs');
const path = require('path');

const KOTLIN_PATH = path.join(
  __dirname,
  '..',
  'node_modules',
  '@scottjgilroy',
  'react-native-vision-camera-v4-pose-detection',
  'android',
  'src',
  'main',
  'java',
  'com',
  'visioncamerav3posedetection',
  'VisionCameraV3PoseDetectionModule.kt',
);

const ORIGINAL_BLOCK = `      fun addLandmarkToMap(landmark: PoseLandmark?, landmarkName: String) {
        val landmarkMap = WritableNativeMap()
        landmarkMap.putDouble("x", landmark?.position?.x?.toDouble() ?: 0.0)
        landmarkMap.putDouble("y", landmark?.position?.y?.toDouble() ?: 0.0)

        map.putMap(landmarkName, landmarkMap)
      }`;

const PATCHED_BLOCK = `      fun addLandmarkToMap(landmark: PoseLandmark?, landmarkName: String) {
        val landmarkMap = WritableNativeMap()
        landmarkMap.putDouble("x", landmark?.position?.x?.toDouble() ?: 0.0)
        landmarkMap.putDouble("y", landmark?.position?.y?.toDouble() ?: 0.0)
        landmarkMap.putDouble("inFrameLikelihood", landmark?.inFrameLikelihood?.toDouble() ?: 0.0)

        map.putMap(landmarkName, landmarkMap)
      }`;

function main() {
  if (!fs.existsSync(KOTLIN_PATH)) {
    console.log(
      '[patch-mlkit-pose-kotlin] Plugin not installed yet — skipping.',
    );
    return;
  }

  const original = fs.readFileSync(KOTLIN_PATH, 'utf8');

  if (original.includes('inFrameLikelihood')) {
    console.log(
      '[patch-mlkit-pose-kotlin] Already patched (inFrameLikelihood present).',
    );
    return;
  }

  if (!original.includes(ORIGINAL_BLOCK)) {
    console.warn(
      '[patch-mlkit-pose-kotlin] Could not find addLandmarkToMap block — plugin version changed?',
    );
    return;
  }

  const patched = original.replace(ORIGINAL_BLOCK, PATCHED_BLOCK);
  fs.writeFileSync(KOTLIN_PATH, patched, 'utf8');
  console.log('[patch-mlkit-pose-kotlin] ✓ Added inFrameLikelihood to native landmarks.');
}

main();
