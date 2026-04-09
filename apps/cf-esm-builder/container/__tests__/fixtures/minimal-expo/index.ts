// Dual-runtime entry — kept in lock-step with scripts/seed-expo-fixture.ts
// (the editor branch's seeded fixture). Single source serves both:
//
//   * Phase R: @onlook/browser-metro bundles for the canvas iframe via
//     the rewriter alias react-native → react-native-web. Platform.OS
//     resolves to 'web' at runtime, the if branch executes, and
//     AppRegistry.runApplication mounts to <div id="root"> in the SW
//     html shell.
//
//   * Phase H/Q: Container Metro bundles with --platform android (or
//     --platform ios). Platform.OS resolves to 'android'/'ios', the
//     if branch is dead-code-eliminated by Metro before Hermes ever
//     sees it, and Expo Go's RN runtime calls runApplication itself
//     once it sees the 'main' component registered.
import { AppRegistry, Platform } from 'react-native';
import App from './App';

AppRegistry.registerComponent('main', () => App);

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const rootTag =
    document.getElementById('root') ?? document.getElementById('main');
  if (rootTag) {
    AppRegistry.runApplication('main', { rootTag });
  }
}
