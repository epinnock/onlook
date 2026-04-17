import { beforeEach, describe, expect, it } from 'bun:test';

import * as percentageResolverModule from '../host/styles/percentage.js';
import {
  getRegisteredStyleResolverIds,
  resetStyleResolverRegistry,
  resolveHostStyle,
} from '../host/styles/index.js';

beforeEach(() => {
  resetStyleResolverRegistry();
});

describe('percentage host style resolver', () => {
  it('resolves percentage dimensions against the parent layout via auto-discovered modules', () => {
    expect(
      resolveHostStyle(
        {
          width: '50%',
          height: '25%',
          minWidth: '10%',
          maxWidth: '75%',
          minHeight: '12.5%',
          maxHeight: '80%',
          opacity: '50%',
        },
        {
          discoveredModules: {
            './percentage.js': percentageResolverModule,
          },
          parentLayout: {
            width: 320,
            height: 640,
          },
        },
      ),
    ).toEqual({
      width: 160,
      height: 160,
      minWidth: 32,
      maxWidth: 240,
      minHeight: 80,
      maxHeight: 512,
      opacity: '50%',
    });

    expect(getRegisteredStyleResolverIds()).toEqual(['flatten', 'percentage']);
  });

  it('leaves percentage dimensions unchanged when the matching parent axis is unavailable', () => {
    expect(
      resolveHostStyle(
        {
          width: '50%',
          height: '25%',
          minHeight: '10%',
          transform: [{ translateY: '20%' }],
        },
        {
          discoveredModules: {
            './percentage.js': percentageResolverModule,
          },
          parentLayout: {
            width: 300,
          },
        },
      ),
    ).toEqual({
      width: 150,
      height: '25%',
      minHeight: '10%',
      transform: [{ translateY: '20%' }],
    });
  });
});
