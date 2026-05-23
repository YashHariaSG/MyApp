#!/usr/bin/env node
/**
 * Patch @scottjgilroy/react-native-vision-camera-v4-pose-detection for iOS CocoaPods.
 * The published package only ships react-native-vision-camera-v3-pose-detection.podspec
 * but autolinking registers pod name react-native-vision-camera-v4-pose-detection, so
 * `pod install` fails unless the podspec filename matches s.name.
 */
const fs = require('fs');
const path = require('path');

const PACKAGE_DIR = path.join(
  __dirname,
  '..',
  'node_modules',
  '@scottjgilroy',
  'react-native-vision-camera-v4-pose-detection',
);

const SOURCE_PODSPEC = path.join(
  PACKAGE_DIR,
  'react-native-vision-camera-v3-pose-detection.podspec',
);

const TARGET_PODSPEC = path.join(
  PACKAGE_DIR,
  'react-native-vision-camera-v4-pose-detection.podspec',
);

function main() {
  if (!fs.existsSync(PACKAGE_DIR)) {
    console.log(
      '[patch-mlkit-pose-ios-podspec] Plugin not installed yet — skipping.',
    );
    return;
  }

  if (!fs.existsSync(SOURCE_PODSPEC)) {
    console.warn(
      '[patch-mlkit-pose-ios-podspec] Missing source podspec — plugin layout changed?',
    );
    return;
  }

  let source = fs.readFileSync(SOURCE_PODSPEC, 'utf8');

  // Published podspec pulls RCT-Folly / React-Codegen for New Arch, but this
  // Objective-C Frame Processor plugin does not need them and they break RN 0.85
  // prebuilt iOS installs.
  const newArchBlock =
    /  # Don't install the dependencies when we run `pod install` in the old architecture\.\n[\s\S]*?  end\nend\n/;
  const patched = source.replace(
    newArchBlock,
    'end\n',
  );

  if (patched === source) {
    console.warn(
      '[patch-mlkit-pose-ios-podspec] New Arch block not found — podspec layout changed?',
    );
  } else {
    source = patched;
    console.log(
      '[patch-mlkit-pose-ios-podspec] ✓ Removed obsolete New Architecture pod deps.',
    );
  }

  if (
    fs.existsSync(TARGET_PODSPEC) &&
    fs.readFileSync(TARGET_PODSPEC, 'utf8') === source
  ) {
    console.log(
      '[patch-mlkit-pose-ios-podspec] v4 podspec already up to date.',
    );
    return;
  }

  fs.writeFileSync(TARGET_PODSPEC, source, 'utf8');
  console.log(
    '[patch-mlkit-pose-ios-podspec] ✓ Wrote react-native-vision-camera-v4-pose-detection.podspec',
  );
}

main();
