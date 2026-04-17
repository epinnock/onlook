import { afterEach, describe, expect, test } from 'bun:test';

const {
  applyRuntimeShims,
  getRegisteredRuntimeShimIds,
  registerRuntimeShim,
  resetRuntimeShimRegistry,
} = require('../registry.js');

const expoRuntimeShimCollection = require('../shims/expo/index.js');

afterEach(() => {
  resetRuntimeShimRegistry();
});

describe('expo runtime shim auto-discovery', () => {
  test('retroactively derives expo shim ids from shim paths', () => {
    const applied: string[] = [];

    registerRuntimeShim(
      function installExpoRouter(target: { applied: string[] }) {
        target.applied.push('expo-router');
      },
      './shims/expo/expo-router.js',
    );

    registerRuntimeShim(
      {
        default(target: { applied: string[] }) {
          target.applied.push('expo-status-bar');
        },
      },
      './shims/expo/expo-status-bar.ts',
    );

    registerRuntimeShim(expoRuntimeShimCollection, './shims/expo/index.js');

    applyRuntimeShims({ applied });

    expect(getRegisteredRuntimeShimIds()).toEqual(['expo-router', 'expo-status-bar']);
    expect(applied).toEqual(['expo-router', 'expo-status-bar']);
  });

  test('keeps the collection marker out of the install list and de-duplicates re-registration', () => {
    registerRuntimeShim(expoRuntimeShimCollection, './shims/expo/index.js');
    registerRuntimeShim(expoRuntimeShimCollection, './shims/expo/index.js');

    expect(getRegisteredRuntimeShimIds()).toEqual([]);

    registerRuntimeShim(
      {
        install() {},
      },
      './shims/expo/expo-router.js',
    );

    registerRuntimeShim(
      {
        install() {
          throw new Error('duplicate expo shim should not be installed');
        },
      },
      './shims/expo/expo-router.js',
    );

    expect(getRegisteredRuntimeShimIds()).toEqual(['expo-router']);
  });
});
