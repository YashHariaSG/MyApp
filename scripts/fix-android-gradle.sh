#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "→ npm install"
npm install

echo "→ Stop all Gradle daemons (avoid lock conflicts)"
(cd android && ./gradlew --stop) 2>/dev/null || true
(cd node_modules/@react-native/gradle-plugin && ./gradlew --stop) 2>/dev/null || true

echo "→ Clean caches"
rm -rf android/.gradle android/app/build android/app/.cxx
rm -rf node_modules/@react-native/gradle-plugin/.gradle

echo "→ Pre-build React Native Gradle plugins (required before android build)"
cd node_modules/@react-native/gradle-plugin
./gradlew :settings-plugin:jar :react-native-gradle-plugin:jar
cd "$ROOT"

echo "→ Verify Android Gradle"
cd android
./gradlew tasks -q | head -5
cd "$ROOT"

echo ""
echo "✓ Ready. Run: npm run android"
