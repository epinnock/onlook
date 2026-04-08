import { AppRegistry } from 'react-native';
import App from './App';

// Required for Hermes / Expo Go (Phase H). Must register before the JS
// bundle finishes evaluating; the runtime looks up 'main' on first frame.
AppRegistry.registerComponent('main', () => App);
