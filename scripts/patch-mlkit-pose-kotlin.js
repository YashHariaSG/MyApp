/**
 * Patches ML Kit pose plugin for Kotlin 2 / RN 0.85:
 * WritableNativeMap.toHashMap() returns HashMap<String, Any?> but plugin needs HashMap<String, Any>.
 */
const fs = require('fs');
const path = require('path');

const targetPath = path.join(
  __dirname,
  '../node_modules/@scottjgilroy/react-native-vision-camera-v4-pose-detection/android/src/main/java/com/visioncamerav3posedetection/VisionCameraV3PoseDetectionModule.kt',
);

const patchPath = path.join(
  __dirname,
  'patches/VisionCameraV3PoseDetectionModule.kt',
);

if (!fs.existsSync(patchPath)) {
  console.warn('patch-mlkit-pose-kotlin: patch file missing, skipping');
  process.exit(0);
}

if (!fs.existsSync(path.dirname(targetPath))) {
  console.warn('patch-mlkit-pose-kotlin: pose-detection package not installed, skipping');
  process.exit(0);
}

fs.copyFileSync(patchPath, targetPath);
console.log('patch-mlkit-pose-kotlin: applied VisionCameraV3PoseDetectionModule.kt');
