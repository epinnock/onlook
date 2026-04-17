import { afterEach, describe, expect, test } from 'bun:test';

const {
  applyRuntimeShims,
  getRegisteredRuntimeShimIds,
  registerRuntimeShim,
  resetRuntimeShimRegistry,
} = require('../registry.js');

const thirdPartyRuntimeShimCollection = require('../shims/third-party/index.js');

afterEach(() => {
  resetRuntimeShimRegistry();
});

describe('third-party runtime shim auto-discovery', () => {
  test('derives third-party shim ids from shim paths', () => {
    const applied: string[] = [];

    registerRuntimeShim(
      thirdPartyRuntimeShimCollection,
      './shims/third-party/index.js',
    );

    registerRuntimeShim(
      function installReactNativeScreens(target: { applied: string[] }) {
        target.applied.push('react-native-screens');
      },
      './shims/third-party/react-native-screens.js',
    );

    registerRuntimeShim(
      {
        default(target: { applied: string[] }) {
          target.applied.push('vector-icons/batch-a');
        },
      },
      './shims/third-party/vector-icons/batch-a.ts',
    );

    applyRuntimeShims({ applied });

    expect(getRegisteredRuntimeShimIds()).toEqual([
      'react-native-screens',
      'vector-icons/batch-a',
    ]);
    expect(applied).toEqual([
      'react-native-screens',
      'vector-icons/batch-a',
    ]);
  });

  test('keeps the collection marker out of the install list and de-duplicates re-registration', () => {
    registerRuntimeShim(
      thirdPartyRuntimeShimCollection,
      './shims/third-party/index.js',
    );
    registerRuntimeShim(
      thirdPartyRuntimeShimCollection,
      './shims/third-party/index.js',
    );

    expect(getRegisteredRuntimeShimIds()).toEqual([]);

    registerRuntimeShim(
      {
        install() {},
      },
      './shims/third-party/react-native-svg-core.js',
    );

    registerRuntimeShim(
      {
        install() {
          throw new Error('duplicate third-party shim should not be installed');
        },
      },
      './shims/third-party/react-native-svg-core.js',
    );

    expect(getRegisteredRuntimeShimIds()).toEqual(['react-native-svg-core']);
  });
});
