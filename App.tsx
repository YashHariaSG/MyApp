import React, { useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import PoseCameraScreen from './src/screens/PoseCameraScreen';

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const [showCameraCheck, setShowCameraCheck] = useState(false);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      {showCameraCheck ? (
        <PoseCameraScreen />
      ) : (
        <View style={styles.container}>
          <Text style={styles.title}>Proctoring Setup</Text>
          <Text style={styles.subtitle}>
            Tap below to open the camera position check.
          </Text>
          <Pressable
            style={styles.button}
            onPress={() => {
              setShowCameraCheck(true);
            }}>
            <Text style={styles.buttonText}>Camera Position Check</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaProvider>
  );
}

export default App;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    color: '#d0d0d0',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#1f8fff',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
