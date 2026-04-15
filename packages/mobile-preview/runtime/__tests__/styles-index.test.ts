import { beforeEach, describe, expect, it } from 'bun:test';

import { STYLE_HELPERS_GLOBAL_KEY } from '../shims/core/style.js';
import {
  getRegisteredStyleResolverIds,
  primeAutoDiscoveredStyleResolvers,
  registerStyleResolver,
  resetStyleResolverRegistry,
  resolveHostStyle,
} from '../host/styles/index.js';

beforeEach(() => {
  resetStyleResolverRegistry();
});

describe('host style resolver registry', () => {
  it('primes the flatten resolver and auto-discovers resolver modules by filename', () => {
    const discoveredModules = {
      './index.js': {
        default: {
          resolve() {
            return { ignored: true };
          },
        },
      },
      './shadow.js': {
        default: {
          resolve(style, context) {
            return {
              ...style,
              shadowOpacity: 0.5,
              sourceStyleKind: Array.isArray(context.sourceStyle) ? 'array' : 'other',
            };
          },
        },
      },
      './transform.js': {
        default(style) {
          return {
            ...style,
            hasResolvedTransform: true,
          };
        },
      },
    };

    expect(primeAutoDiscoveredStyleResolvers(discoveredModules)).toEqual([
      'flatten',
      'shadow',
      'transform',
    ]);

    expect(
      resolveHostStyle(
        [
          { backgroundColor: '#112233' },
          { padding: 8 },
        ],
        { discoveredModules },
      ),
    ).toEqual({
      backgroundColor: 0xff112233 | 0,
      hasResolvedTransform: true,
      padding: 8,
      shadowOpacity: 0.5,
      sourceStyleKind: 'array',
    });

    expect(getRegisteredStyleResolverIds()).toEqual(['flatten', 'shadow', 'transform']);
  });

  it('deduplicates manual registrations and respects injected style helpers', () => {
    const flattenCalls = [];

    registerStyleResolver(
      {
        id: 'custom',
        resolve(style, context) {
          return {
            ...style,
            helperResult: context.styleHelpers.flattenStyle([{ helper: true }]),
          };
        },
      },
      'custom',
    );
    registerStyleResolver(
      {
        id: 'custom',
        resolve(style) {
          return {
            ...style,
            overwritten: true,
          };
        },
      },
      'custom',
    );

    const styleHelpers = {
      flattenStyle(style) {
        flattenCalls.push(style);
        return {
          helperFlattened: Array.isArray(style),
        };
      },
    };

    expect(resolveHostStyle({ marginTop: 4 }, { styleHelpers })).toEqual({
      helperResult: {
        helperFlattened: true,
      },
      helperFlattened: false,
    });
    expect(flattenCalls).toEqual([{ marginTop: 4 }, [{ helper: true }]]);
    expect(getRegisteredStyleResolverIds()).toEqual(['flatten', 'custom']);
  });

  it('installs shared style helpers on the provided target when none are injected', () => {
    const target = {};

    expect(resolveHostStyle({ color: '#ffffff' }, { target })).toEqual({
      color: 0xffffffff | 0,
    });
    expect(target).toHaveProperty(STYLE_HELPERS_GLOBAL_KEY);
    expect(typeof target[STYLE_HELPERS_GLOBAL_KEY].flattenStyle).toBe('function');
  });
});
