import { beforeEach, describe, expect, it } from 'bun:test';

import typographyStyleResolver from '../host/styles/typography.js';
import {
  getRegisteredStyleResolverIds,
  resetStyleResolverRegistry,
  resolveHostStyle,
} from '../host/styles/index.js';

beforeEach(() => {
  resetStyleResolverRegistry();
});

describe('typography host style resolver', () => {
  const discoveredModules = {
    './typography.js': {
      default: typographyStyleResolver,
    },
  };

  it('auto-discovers typography.js and resolves CSS-like typography shorthands', () => {
    expect(
      resolveHostStyle(
        [
          {
            color: '#112233',
            fontFamily: '"Inter", system-ui',
            letterSpacing: '1.5px',
            textShadow: '2px 4px 6px rgba(17, 34, 51, 0.5)',
          },
          {
            textDecoration: 'underline dotted #445566',
          },
        ],
        { discoveredModules },
      ),
    ).toEqual({
      color: 0xff112233 | 0,
      fontFamily: '"Inter", system-ui',
      letterSpacing: 1.5,
      textDecorationColor: 0xff445566 | 0,
      textDecorationLine: 'underline',
      textDecorationStyle: 'dotted',
      textShadowColor: 0x80112233 | 0,
      textShadowOffset: { width: 2, height: 4 },
      textShadowRadius: 6,
    });

    expect(getRegisteredStyleResolverIds()).toEqual(['flatten', 'typography']);
  });

  it('preserves explicit longhands while stripping parsed shorthand props', () => {
    const sourceTextShadowOffset = { width: 7, height: 9 };

    const resolvedStyle = resolveHostStyle(
      {
        fontFamily: 'SF Pro Text',
        letterSpacing: '2',
        textDecoration: 'underline dashed #334455',
        textDecorationColor: 0xff778899 | 0,
        textDecorationLine: 'line-through',
        textDecorationStyle: 'solid',
        textShadow: '1px 2px 3px #abcdef',
        textShadowColor: 0xff010203 | 0,
        textShadowOffset: sourceTextShadowOffset,
        textShadowRadius: 11,
      },
      { discoveredModules },
    );

    expect(resolvedStyle).toEqual({
      fontFamily: 'SF Pro Text',
      letterSpacing: 2,
      textDecorationColor: 0xff778899 | 0,
      textDecorationLine: 'line-through',
      textDecorationStyle: 'solid',
      textShadowColor: 0xff010203 | 0,
      textShadowOffset: { width: 7, height: 9 },
      textShadowRadius: 11,
    });
    expect(resolvedStyle.textShadowOffset).not.toBe(sourceTextShadowOffset);
    expect(sourceTextShadowOffset).toEqual({ width: 7, height: 9 });
  });
});
