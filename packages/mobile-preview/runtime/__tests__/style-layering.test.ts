import { beforeEach, describe, expect, it } from 'bun:test';

import layeringStyleResolver from '../host/styles/layering.js';
import {
  primeAutoDiscoveredStyleResolvers,
  resetStyleResolverRegistry,
  resolveHostStyle,
} from '../host/styles/index.js';

beforeEach(() => {
  resetStyleResolverRegistry();
});

describe('host style layering resolver', () => {
  it('auto-discovers the layering resolver by filename and normalizes layering styles', () => {
    const discoveredModules = {
      './layering.js': {
        default: layeringStyleResolver,
      },
    };

    expect(primeAutoDiscoveredStyleResolvers(discoveredModules)).toEqual(['flatten', 'layering']);

    expect(
      resolveHostStyle(
        [
          { backgroundColor: '#112233' },
          { opacity: '75%' },
          { overflow: 'clip' },
          { 'z-index': '12' },
        ],
        { discoveredModules },
      ),
    ).toEqual({
      backgroundColor: 0xff112233 | 0,
      opacity: 0.75,
      overflow: 'hidden',
      zIndex: 12,
    });
  });

  it('normalizes camel-cased layering styles without overwriting explicit zIndex values', () => {
    const discoveredModules = {
      './layering.js': {
        default: layeringStyleResolver,
      },
    };

    expect(
      resolveHostStyle(
        {
          opacity: 2,
          overflow: 'auto',
          zIndex: '7',
          'z-index': '99',
        },
        { discoveredModules },
      ),
    ).toEqual({
      opacity: 1,
      overflow: 'scroll',
      zIndex: 7,
    });
  });

  it('moves numeric dashed z-index values onto the React Native zIndex key', () => {
    const discoveredModules = {
      './layering.js': {
        default: layeringStyleResolver,
      },
    };

    expect(resolveHostStyle({ 'z-index': 4 }, { discoveredModules })).toEqual({
      zIndex: 4,
    });
  });
});
