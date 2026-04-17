import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  createRuntimeEntrySource,
  discoverRuntimeShimPaths,
} from '../../server/build-runtime';

const {
  applyRuntimeShims,
  getRegisteredRuntimeShimIds,
  registerRuntimeShim,
  resetRuntimeShimRegistry,
} = require('../registry.js');

afterEach(() => {
  resetRuntimeShimRegistry();
});

describe('runtime shim registry', () => {
  test('registers common shim module shapes and applies them in order', () => {
    const applied: string[] = [];

    registerRuntimeShim(
      {
        id: 'alpha',
        applyRuntimeShim(target: { applied: string[] }) {
          target.applied.push('alpha');
        },
      },
      './shims/alpha.js',
    );

    registerRuntimeShim(
      {
        default: {
          id: 'beta',
          install(target: { applied: string[] }) {
            target.applied.push('beta');
          },
        },
      },
      './shims/beta.js',
    );

    registerRuntimeShim(
      function gamma(target: { applied: string[] }) {
        target.applied.push('gamma');
      },
      './shims/gamma.js',
    );

    registerRuntimeShim(
      {
        id: 'alpha',
        install(target: { applied: string[] }) {
          target.applied.push('alpha-duplicate');
        },
      },
      './shims/alpha.js',
    );

    applyRuntimeShims({ applied });

    expect(getRegisteredRuntimeShimIds()).toEqual(['alpha', 'beta', 'gamma']);
    expect(applied).toEqual(['alpha', 'beta', 'gamma']);
  });
});

describe('runtime shim discovery', () => {
  test('discovers shim files and emits a deterministic generated entry', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'mobile-preview-runtime-'));
    const runtimeDir = join(tempRoot, 'runtime');

    try {
      await mkdir(join(runtimeDir, 'shims', 'nested'), { recursive: true });
      await writeFile(join(runtimeDir, 'shims', 'beta.js'), 'module.exports = () => {};');
      await writeFile(join(runtimeDir, 'shims', 'alpha.ts'), 'export default () => {};');
      await writeFile(join(runtimeDir, 'shims', 'nested', 'gamma.tsx'), 'export default () => null;');
      await writeFile(join(runtimeDir, 'shims', 'README.md'), '# ignored');

      const shimPaths = await discoverRuntimeShimPaths(runtimeDir);
      const entrySource = createRuntimeEntrySource(shimPaths);

      expect(shimPaths).toEqual([
        './shims/alpha.ts',
        './shims/beta.js',
        './shims/nested/gamma.tsx',
      ]);
      expect(entrySource).toContain("require('./shell.js');");
      expect(entrySource).toContain("const registry = require('./registry.js');");
      expect(entrySource).toContain(
        'registry.registerRuntimeShim(require("./shims/alpha.ts"), "./shims/alpha.ts");',
      );
      expect(entrySource).toContain(
        'registry.registerRuntimeShim(require("./shims/nested/gamma.tsx"), "./shims/nested/gamma.tsx");',
      );
      expect(entrySource).toContain('registry.applyRuntimeShims(globalThis);');
      expect(entrySource).toContain("require('./runtime.js');");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
