/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

jest.mock('../src/screens/PoseCameraScreen', () => {
  const { Text } = require('react-native');
  return () => <Text>PoseCameraScreen</Text>;
});

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});
