import { beforeEach, describe, expect, it } from 'bun:test';

import shadowResolver from '../host/styles/shadow.js';
import {
  resetStyleResolverRegistry,
  resolveHostStyle,
} from '../host/styles/index.js';

beforeEach(() => {
  resetStyleResolverRegistry();
});

describe('shadow style resolver', () => {
  it('passes iOS shadow props through with a normalized shadowOffset object', () => {
    expect(
      resolveHostStyle(
        {
          backgroundColor: '#112233',
          shadowColor: '#000000',
          shadowOffset: { width: 4 },
          shadowOpacity: 0.35,
          shadowRadius: 12,
        },
        {
          discoveredModules: {
            './shadow.js': shadowResolver,
          },
        },
      ),
    ).toEqual({
      backgroundColor: 0xff112233 | 0,
      shadowColor: 0xff000000 | 0,
      shadowOffset: {
        width: 4,
        height: 0,
      },
      shadowOpacity: 0.35,
      shadowRadius: 12,
    });
  });

  it('leaves non-shadow styles untouched when no iOS shadow props are present', () => {
    expect(
      resolveHostStyle(
        {
          opacity: 0.9,
          paddingTop: 8,
        },
        {
          discoveredModules: {
            './shadow.js': shadowResolver,
          },
        },
      ),
    ).toEqual({
      opacity: 0.9,
      paddingTop: 8,
    });
  });

  it('defaults shadowOffset to zero dimensions when the incoming value is missing or invalid', () => {
    expect(
      resolveHostStyle(
        {
          shadowOffset: null,
          shadowOpacity: 0.2,
        },
        {
          discoveredModules: {
            './shadow.js': shadowResolver,
          },
        },
      ),
    ).toEqual({
      shadowOffset: {
        width: 0,
        height: 0,
      },
      shadowOpacity: 0.2,
    });
  });
});
