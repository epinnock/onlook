import { beforeEach, describe, expect, it } from 'bun:test';

import elevationStyleResolver from '../host/styles/elevation.js';
import { resetStyleResolverRegistry, resolveHostStyle } from '../host/styles/index.js';

beforeEach(() => {
  resetStyleResolverRegistry();
});

describe('elevation host style resolver', () => {
  const discoveredModules = {
    './elevation.js': {
      default: elevationStyleResolver,
    },
  };

  it('auto-discovers the elevation resolver and strips elevation on the default iOS host path', () => {
    expect(
      resolveHostStyle(
        [
          { backgroundColor: '#112233' },
          { elevation: 12, opacity: 0.9 },
        ],
        { discoveredModules },
      ),
    ).toEqual({
      backgroundColor: 0xff112233 | 0,
      opacity: 0.9,
    });
  });

  it('treats elevation as an Android no-op and preserves the explicit prop', () => {
    expect(
      resolveHostStyle(
        {
          backgroundColor: '#445566',
          elevation: 8,
          shadowOpacity: 0.4,
        },
        {
          discoveredModules,
          platform: 'android',
        },
      ),
    ).toEqual({
      backgroundColor: 0xff445566 | 0,
      elevation: 8,
      shadowOpacity: 0.4,
    });
  });

  it('uses the injected target Platform.OS when platform is not passed directly', () => {
    expect(
      resolveHostStyle(
        {
          elevation: 6,
          marginTop: 4,
        },
        {
          discoveredModules,
          target: {
            Platform: {
              OS: 'android',
            },
          },
        },
      ),
    ).toEqual({
      elevation: 6,
      marginTop: 4,
    });
  });
});
