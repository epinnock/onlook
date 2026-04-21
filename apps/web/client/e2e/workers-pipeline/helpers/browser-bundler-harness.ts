/**
 * Shared harness for browser-bundler E2E specs.
 *
 * The browser-bundler is designed to run in a Web Worker with esbuild-wasm.
 * In these E2E specs we bundle fixture projects via a real `esbuild` service
 * from node_modules and then wrap the output with the production
 * `wrapOverlayCode`. This exercises the same output contract the editor
 * pushes over the wire (self-mounting bundle that installs globalThis.onlookMount,
 * sourcemap parseable, size/time budgets) without pulling in the in-browser
 * esbuild-wasm stack. The virtual-fs resolve/load plugins have exhaustive
 * unit tests under packages/browser-bundler/__tests__, so these specs focus
 * on the end-to-end overlay contract, not plugin internals.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';

import {
    wrapOverlayCode,
    type WrappedOverlay,
} from '../../../../../../packages/browser-bundler/src/wrap-overlay';

import {
    getWorkersPipelineFixture,
    listWorkersPipelineFixtureFiles,
    type WorkersPipelineFixtureName,
    type WorkersPipelineFixtureProject,
} from './fixture-projects';

/**
 * Bare specifiers that are provided by the base bundle and must be
 * externalized when building an overlay. Matches the curated registry that
 * the production browser-bundler uses.
 */
export const DEFAULT_BASE_EXTERNALS: readonly string[] = [
    'react',
    'react/jsx-runtime',
    'react-native',
    'react-native-safe-area-context',
    'expo',
    'expo-status-bar',
    'expo-router',
    'expo-modules-core',
];

export interface VirtualFile {
    readonly path: string;
    readonly contents: string;
}

export interface LoadedFixture {
    readonly project: WorkersPipelineFixtureProject;
    readonly files: readonly VirtualFile[];
    readonly entryPoint: string;
}

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json']);

function hasCodeExtension(path: string): boolean {
    const lastDot = path.lastIndexOf('.');
    if (lastDot === -1) return false;
    return CODE_EXTENSIONS.has(path.slice(lastDot).toLowerCase());
}

/**
 * Loads a fixture project's code files into the browser-bundler's virtual
 * file map. We exclude binary assets and config files (babel.config.js,
 * app.json, metro.config.js) — overlays don't need them.
 */
export function loadFixtureForBundling(name: WorkersPipelineFixtureName): LoadedFixture {
    const project = getWorkersPipelineFixture(name);
    const relativePaths = listWorkersPipelineFixtureFiles(project)
        .filter((p) => hasCodeExtension(p))
        .filter((p) => !/^(babel\.config|metro\.config)\./.test(p))
        .filter((p) => p !== 'tsconfig.json');

    const files: VirtualFile[] = relativePaths.map((rel) => ({
        path: `/${rel}`,
        contents: readFileSync(join(project.rootDir, rel), 'utf8'),
    }));

    // Entry must be one of the virtual paths. Prefer App.tsx since the
    // overlay workflow always re-ships the app component, not the AppRegistry
    // boot shim in index.ts.
    const entryPoint = files.some((f) => f.path === '/App.tsx') ? '/App.tsx' : '/index.ts';

    return { project, files, entryPoint };
}

export interface BundleResult {
    readonly code: string;
    readonly sourceMap?: string;
}

export interface BundledOverlay {
    readonly bundle: BundleResult;
    readonly wrapped: WrappedOverlay;
    readonly durationMs: number;
    readonly byteLength: number;
}

/**
 * Materializes the fixture to a temp directory and drives a real esbuild
 * build against it, treating `DEFAULT_BASE_EXTERNALS` as externals — exactly
 * how the editor's browser-bundler does. Using a real on-disk root keeps
 * esbuild's native resolver happy; the virtual-fs plugin internals are
 * covered by browser-bundler unit tests.
 */
export async function bundleFixtureAsOverlay(
    name: WorkersPipelineFixtureName,
    options: { readonly externals?: readonly string[] } = {},
): Promise<BundledOverlay> {
    const fixture = loadFixtureForBundling(name);
    const workdir = join(
        tmpdir(),
        `browser-bundler-e2e-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
    );

    if (!existsSync(workdir)) {
        mkdirSync(workdir, { recursive: true });
    }

    try {
        for (const file of fixture.files) {
            const onDisk = join(workdir, file.path);
            mkdirSync(dirname(onDisk), { recursive: true });
            writeFileSync(onDisk, file.contents, 'utf8');
        }

        const entryOnDisk = join(workdir, fixture.entryPoint);
        const esbuild = (await import('esbuild')) as typeof import('esbuild');

        const startedAt = performance.now();
        const result = await esbuild.build({
            entryPoints: [entryOnDisk],
            bundle: true,
            format: 'cjs',
            platform: 'browser',
            write: false,
            sourcemap: true,
            outfile: join(workdir, '_out', 'overlay.js'),
            external: [...(options.externals ?? DEFAULT_BASE_EXTERNALS)],
            absWorkingDir: workdir,
            logLevel: 'silent',
        });
        const durationMs = performance.now() - startedAt;

        const outputFiles = result.outputFiles ?? [];
        const codeFile = outputFiles.find((f) => f.path.endsWith('.js'));
        const mapFile = outputFiles.find((f) => f.path.endsWith('.map'));

        if (!codeFile) {
            throw new Error('esbuild produced no JavaScript output');
        }

        const bundle: BundleResult = {
            code: codeFile.text,
            sourceMap: mapFile?.text,
        };

        const wrapped = wrapOverlayCode(bundle.code, { sourceMap: bundle.sourceMap });
        return {
            bundle,
            wrapped,
            durationMs,
            byteLength: Buffer.byteLength(wrapped.code, 'utf8'),
        };
    } finally {
        rmSync(workdir, { recursive: true, force: true });
    }
}

/**
 * Returns the path of a fixture file, relative to the repo root — useful for
 * diagnostics in test failure messages.
 */
export function fixtureRelPath(project: WorkersPipelineFixtureProject, file: string): string {
    return relative(process.cwd(), join(project.rootDir, file));
}
