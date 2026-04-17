// Expo entry point for @onlook/mobile-client.
//
// Phase F task MCF8 of plans/onlook-mobile-client-task-queue.md.
// Must be plain JavaScript because Expo's `registerRootComponent` runs before
// the bundler sees any TypeScript. The real root component is src/App.tsx.
//
// `registerRootComponent` calls `AppRegistry.registerComponent('main', () => App)`
// and also installs the global error handler — this is the path every Expo
// managed app uses, and matches what the OnlookRuntime JSI binding will
// replace in Wave 2 once `runApplication(bundleSource, props)` is the primary
// mount path.

import { registerRootComponent } from 'expo';

import App from './src/App';

registerRootComponent(App);
