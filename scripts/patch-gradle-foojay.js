/**
 * Gradle 9 removed JvmVendorSpec.IBM_SEMERU; foojay-resolver 0.5.0 still references it.
 * @see https://github.com/facebook/react-native/issues/55781
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const gradlePluginRoot = path.join(
  __dirname,
  '../node_modules/@react-native/gradle-plugin',
);
const settingsPath = path.join(gradlePluginRoot, 'settings.gradle.kts');

if (!fs.existsSync(settingsPath)) {
  process.exit(0);
}

const contents = fs.readFileSync(settingsPath, 'utf8');
const patched = contents.replace(
  'foojay-resolver-convention").version("0.5.0")',
  'foojay-resolver-convention").version("1.0.0")',
);

if (patched !== contents) {
  fs.writeFileSync(settingsPath, patched);
}

// Build plugins from @react-native/gradle-plugin (NOT from android/).
// android/settings.gradle needs these jars before it can configure itself.
const gradlew =
  process.platform === 'win32'
    ? path.join(gradlePluginRoot, 'gradlew.bat')
    : path.join(gradlePluginRoot, 'gradlew');

if (!fs.existsSync(gradlew)) {
  process.exit(0);
}

const gradleCmd =
  process.platform === 'win32'
    ? 'gradlew.bat :settings-plugin:jar :react-native-gradle-plugin:jar -q'
    : './gradlew :settings-plugin:jar :react-native-gradle-plugin:jar -q';

try {
  execSync(gradleCmd, { cwd: gradlePluginRoot, stdio: 'inherit' });
} catch {
  console.warn(
    '[postinstall] Could not pre-build React Native Gradle plugins. Run: npm run fix-android',
  );
}
