import { beforeEach, describe, expect, it } from 'bun:test';

import borderStyleResolver from '../host/styles/border.js';
import {
  primeAutoDiscoveredStyleResolvers,
  resetStyleResolverRegistry,
  resolveHostStyle,
} from '../host/styles/index.js';

const discoveredModules = {
  './border.js': {
    default: borderStyleResolver,
  },
};

beforeEach(() => {
  resetStyleResolverRegistry();
});

describe('border style resolver', () => {
  it('auto-discovers the border resolver and expands border shorthands without overriding explicit longhands', () => {
    expect(primeAutoDiscoveredStyleResolvers(discoveredModules)).toEqual(['flatten', 'border']);

    expect(
      resolveHostStyle(
        [
          {
            border: '2px dashed #112233',
            borderTop: '4 dotted rgba(255, 0, 0, 0.5)',
          },
          {
            borderStyle: 'SOLID',
            borderRightColor: '#445566',
            borderBottomWidth: '6px',
          },
        ],
        { discoveredModules },
      ),
    ).toEqual({
      borderWidth: 2,
      borderStyle: 'solid',
      borderColor: 0xff112233 | 0,
      borderTopWidth: 4,
      borderTopStyle: 'dotted',
      borderTopColor: 0x80ff0000 | 0,
      borderRightColor: 0xff445566 | 0,
      borderBottomWidth: 6,
    });
  });

  it('maps logical border props to per-side host props and preserves more specific side values', () => {
    expect(
      resolveHostStyle(
        {
          borderBlockColor: '#abcdef',
          borderInlineWidth: '3px',
          borderInlineStyle: 'DASHED',
          borderLeftStyle: 'solid',
        },
        { discoveredModules },
      ),
    ).toEqual({
      borderTopColor: 0xffabcdef | 0,
      borderBottomColor: 0xffabcdef | 0,
      borderLeftWidth: 3,
      borderRightWidth: 3,
      borderLeftStyle: 'solid',
      borderRightStyle: 'dashed',
    });
  });
});
