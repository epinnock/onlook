import { beforeEach, describe, expect, it } from 'bun:test';

import * as transformModule from '../host/styles/transform.js';
import {
  primeAutoDiscoveredStyleResolvers,
  resetStyleResolverRegistry,
  resolveHostStyle,
} from '../host/styles/index.js';

beforeEach(() => {
  resetStyleResolverRegistry();
});

function getResolvedMatrix(style) {
  const transform = style.transform;

  expect(Array.isArray(transform)).toBe(true);
  expect(transform).toHaveLength(1);

  const matrixEntry = transform[0];

  expect(Array.isArray(matrixEntry?.matrix)).toBe(true);

  return matrixEntry.matrix;
}

function expectMatrixCloseTo(actual, expected) {
  expect(actual).toHaveLength(expected.length);

  expected.forEach((value, index) => {
    expect(actual[index]).toBeCloseTo(value, 8);
  });
}

describe('host transform style resolver', () => {
  const discoveredModules = {
    './transform.js': transformModule,
  };

  it('auto-discovers the transform resolver and composes translate transforms into a matrix', () => {
    expect(primeAutoDiscoveredStyleResolvers(discoveredModules)).toEqual(['flatten', 'transform']);

    const resolvedStyle = resolveHostStyle(
      {
        opacity: 0.4,
        transform: [{ translateX: 12 }, { translateY: -7 }],
      },
      { discoveredModules },
    );

    expect(resolvedStyle.opacity).toBe(0.4);
    expectMatrixCloseTo(getResolvedMatrix(resolvedStyle), [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      12, -7, 0, 1,
    ]);
  });

  it('converts rotate and scale transforms into a single matrix entry', () => {
    const resolvedStyle = resolveHostStyle(
      {
        transform: [{ rotate: '90deg' }, { scale: 2 }],
      },
      { discoveredModules },
    );

    expectMatrixCloseTo(getResolvedMatrix(resolvedStyle), [
      0, 2, 0, 0,
      -2, 0, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
  });

  it('normalizes deprecated transformMatrix values into a matrix transform entry', () => {
    const resolvedStyle = resolveHostStyle(
      {
        backgroundColor: '#112233',
        transformMatrix: [1, 0.5, 0.25, 1, 10, -6],
      },
      { discoveredModules },
    );

    expect(resolvedStyle.backgroundColor).toBe(0xff112233 | 0);
    expect('transformMatrix' in resolvedStyle).toBe(false);
    expectMatrixCloseTo(getResolvedMatrix(resolvedStyle), [
      1, 0.5, 0, 0,
      0.25, 1, 0, 0,
      0, 0, 1, 0,
      10, -6, 0, 1,
    ]);
  });
});
