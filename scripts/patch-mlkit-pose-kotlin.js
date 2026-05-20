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

const RETURN_ORIGINAL = '      return map.toHashMap()';
const RETURN_PATCHED = `      @Suppress("UNCHECKED_CAST")
      return map.toHashMap() as HashMap<String, Any>`;

function main() {
  if (!fs.existsSync(KOTLIN_PATH)) {
    console.log(
      '[patch-mlkit-pose-kotlin] Plugin not installed yet — skipping.',
    );
    return;
  }

  let source = fs.readFileSync(KOTLIN_PATH, 'utf8');
  let changed = false;

  if (!source.includes('inFrameLikelihood')) {
    if (!source.includes(ORIGINAL_BLOCK)) {
      console.warn(
        '[patch-mlkit-pose-kotlin] Could not find addLandmarkToMap block — plugin version changed?',
      );
    } else {
      source = source.replace(ORIGINAL_BLOCK, PATCHED_BLOCK);
      changed = true;
      console.log(
        '[patch-mlkit-pose-kotlin] ✓ Added inFrameLikelihood to native landmarks.',
      );
    }
  } else {
    console.log(
      '[patch-mlkit-pose-kotlin] inFrameLikelihood already present.',
    );
  }

  if (source.includes(RETURN_ORIGINAL) && !source.includes('as HashMap<String, Any>')) {
    source = source.replace(RETURN_ORIGINAL, RETURN_PATCHED);
    changed = true;
    console.log(
      '[patch-mlkit-pose-kotlin] ✓ Fixed HashMap return type for Kotlin compiler.',
    );
  }

  if (changed) {
    fs.writeFileSync(KOTLIN_PATH, source, 'utf8');
  } else if (source.includes('as HashMap<String, Any>')) {
    console.log('[patch-mlkit-pose-kotlin] Already fully patched.');
  }
}

main();
