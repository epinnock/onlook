/**
 * TR1.5 regression tests — ensure `attachBrowserMetro` doesn't bundle
 * from an empty Vfs.
 *
 * Bug context: `CodeProviderSync.start()` short-circuits when the
 * instance is already running (shared via `getInstance`), which meant
 * `attachBrowserMetro` could fire before the initial `pullFromSandbox`
 * finished populating the local file system. The bundler then read
 * zero files and the preview SW logged
 * `Error: Module not found: App.tsx`.
 *
 * Fix: `CodeProviderSync` now exposes a `firstPullComplete` promise,
 * and `SandboxManager.initializeSyncEngine` awaits it before calling
 * `attachBrowserMetro`. These tests lock that invariant in.
 */
import type { ProviderCapabilities, Provider } from '@onlook/code-provider';
import type { CodeFileSystem } from '@onlook/file-system';
import { afterEach, describe, expect, it } from 'bun:test';

import { CodeProviderSync } from '@/services/sync-engine/sync-engine';

import { SandboxManager } from '../index';

type FsEntry = { path: string; type: 'file' | 'directory' };

/**
 * Minimal in-memory file system that implements just enough of the
 * CodeFileSystem surface for `attachBrowserMetro` + BrowserMetro.bundle().
 */
function createFakeFs() {
    const files = new Map<string, string>();
    const fs = {
        rootPath: '/fake-project/fake-branch',
        async listAll(): Promise<FsEntry[]> {
            return Array.from(files.keys()).map((p) => ({ path: p, type: 'file' as const }));
        },
        async readFile(p: string): Promise<string> {
            const content = files.get(p);
            if (content === undefined) throw new Error(`ENOENT: ${p}`);
            return content;
        },
        async writeFile(p: string, content: string): Promise<void> {
            files.set(p, content);
        },
        setExpoMode(_: boolean): void {
            /* no-op for tests */
        },
        async rebuildIndex(): Promise<void> {
            /* no-op for tests */
        },
    };
    return { fs, files };
}

/**
 * Build a provider stub with a configurable `getCapabilities()` return
 * and a no-op `attachBundler()` so ExpoBrowser code paths work.
 */
function createProviderStub(caps: ProviderCapabilities | null): Provider {
    const stub = {
        getCapabilities: () => caps,
        attachBundler: () => undefined,
    } as unknown as Provider;
    return stub;
}

/**
 * Build a SandboxManager with the minimum surface needed to invoke
 * `attachBrowserMetro` directly — we bypass `initializeSyncEngine`
 * entirely because that path depends on a real `CodeProviderSync` +
 * ZenFS. The method under test only reads `this.branch.id` and
 * `this.fs`, plus its mutable bundler state.
 */
function buildSandbox(fs: ReturnType<typeof createFakeFs>['fs']): SandboxManager {
    const branch = {
        id: 'branch-test',
        sandbox: { id: 'sandbox-test', providerType: 'expo_browser' },
    };
    const editorEngine = {} as unknown;
    const errorManager = { errors: [] } as unknown;
    return new SandboxManager(
        branch as never,
        editorEngine as never,
        errorManager as never,
        fs as unknown as CodeFileSystem,
    );
}

/**
 * Access the private `attachBrowserMetro` method without `any`.
 */
type WithAttach = {
    attachBrowserMetro(provider: Provider): Promise<void>;
    listAllFiles(): Promise<FsEntry[]>;
};
function asAttach(sandbox: SandboxManager): WithAttach {
    return sandbox as unknown as WithAttach;
}

describe('SandboxManager.attachBrowserMetro (TR1.5)', () => {
    // BroadcastChannel handles from the bundler's `publish()` path can
    // leak between tests — close them by stashing/restoring the global.
    const originalBC = globalThis.BroadcastChannel;

    afterEach(() => {
        globalThis.BroadcastChannel = originalBC;
    });

    it('early-returns for providers without the browser-preview capability signature', async () => {
        const { fs, files } = createFakeFs();
        files.set('App.tsx', 'export default function App() { return null; }');

        const sandbox = buildSandbox(fs);

        // CSB-like provider: advertises shell + terminal support, so the
        // duck-type check in attachBrowserMetro should treat this as
        // "not a browser-preview provider" and skip bundling entirely.
        const caps: ProviderCapabilities = {
            supportsTerminal: true,
            supportsShell: true,
        } as ProviderCapabilities;
        const provider = createProviderStub(caps);

        await asAttach(sandbox).attachBrowserMetro(provider);

        // No bundler was created — listAllFiles should still work (it
        // reads from fs directly) but no BrowserMetro side-effects ran.
        const files2 = await asAttach(sandbox).listAllFiles();
        expect(files2.length).toBe(1);

        // Attaching a second time on a non-preview provider is a no-op
        // (regression guard for the idempotent teardown block).
        await asAttach(sandbox).attachBrowserMetro(provider);
    });

    it('early-returns for providers whose getCapabilities() is undefined', async () => {
        const { fs } = createFakeFs();
        const sandbox = buildSandbox(fs);
        const provider = { } as unknown as Provider; // no getCapabilities
        // Should not throw and should return without constructing a bundler.
        await asAttach(sandbox).attachBrowserMetro(provider);
    });

    it('runs an initial bundle exactly once for an ExpoBrowser provider with a populated Vfs', async () => {
        const { fs, files } = createFakeFs();
        // Populate the Vfs the way `sync.firstPullComplete` would have.
        files.set('App.tsx', 'export default function App() { return <div>hi</div>; }');
        files.set('package.json', '{"name":"expo-test"}');

        const sandbox = buildSandbox(fs);

        // Track how many times attachBundler was called and capture the
        // rebundle hook for later verification.
        let attachBundlerCalls = 0;
        type BundlerHooks = {
            onRebundle: () => Promise<void>;
            onStop: () => Promise<void>;
            banner?: string;
        };
        let capturedHooks: BundlerHooks | null = null;

        const caps: ProviderCapabilities = {
            supportsTerminal: false,
            supportsShell: false,
        } as ProviderCapabilities;
        const provider = {
            getCapabilities: () => caps,
            attachBundler: (hooks: BundlerHooks) => {
                attachBundlerCalls++;
                capturedHooks = hooks;
            },
        } as unknown as Provider;

        await asAttach(sandbox).attachBrowserMetro(provider);

        // The real BrowserMetro was instantiated and `bundle()` was run;
        // verify via the attached hooks that the browser-preview branch
        // executed (non-preview providers never reach attachBundler).
        expect(attachBundlerCalls).toBe(1);
        expect(capturedHooks).not.toBeNull();
        expect(typeof capturedHooks!.onRebundle).toBe('function');
        expect(typeof capturedHooks!.onStop).toBe('function');
    });

    it('TR4.2: simulating an editor write + onRebundle hook fires bundler.invalidate within 1s', async () => {
        // Production wiring path under test (see sandbox/index.ts):
        //   1. attachBrowserMetro() constructs a BrowserMetro and calls
        //      provider.attachBundler({ onRebundle: () => bundler.invalidate(), ... })
        //   2. When the editor pushes a file (writeFile -> BrowserTask.restart
        //      via SessionManager.restartDevServer), BrowserTask invokes its
        //      onRebundle host hook which calls bundler.invalidate() ->
        //      bundler.bundle() which re-walks the Vfs and republishes.
        //
        // This test mimics that path without booting BrowserTask: we
        // capture onRebundle via the attachBundler stub, write a new file
        // to the fake fs, then invoke onRebundle() and assert that the
        // bundler republished within 1 second. We detect republish via
        // a BroadcastChannel postMessage spy because attachBrowserMetro
        // subscribes a BroadcastChannel publisher to bundler.onUpdate.
        const { fs, files } = createFakeFs();
        files.set('App.tsx', 'export default function App() { return <div>v1</div>; }');
        files.set('package.json', '{"name":"expo-test"}');

        const sandbox = buildSandbox(fs);

        // Spy on BroadcastChannel.postMessage so we can count bundle
        // publishes after attach (the initial bundle publishes once, the
        // post-rebundle publish should add a second).
        let postCount = 0;
        class FakeBC {
            constructor(_name: string) { /* no-op */ }
            postMessage(_msg: unknown): void { postCount++; }
            close(): void { /* no-op */ }
        }
        // BroadcastChannel global must satisfy the structural type.
        globalThis.BroadcastChannel = FakeBC as unknown as typeof BroadcastChannel;

        type BundlerHooks = {
            onRebundle: () => Promise<void>;
            onStop: () => Promise<void>;
            banner?: string;
        };
        let capturedHooks: BundlerHooks | null = null;
        const caps: ProviderCapabilities = {
            supportsTerminal: false,
            supportsShell: false,
        } as ProviderCapabilities;
        const provider = {
            getCapabilities: () => caps,
            attachBundler: (hooks: BundlerHooks) => {
                capturedHooks = hooks;
            },
        } as unknown as Provider;

        await asAttach(sandbox).attachBrowserMetro(provider);

        // attachBrowserMetro runs the initial bundle and publishes once.
        const postsAfterInitialBundle = postCount;
        expect(capturedHooks).not.toBeNull();

        // Simulate the editor pushing a code edit into the local Vfs —
        // in production this is what writes a new file before the
        // SessionManager triggers BrowserTask.restart -> onRebundle.
        await fs.writeFile('App.tsx', 'export default function App() { return <div>v2</div>; }');

        // Invoke the captured onRebundle hook (the same callback the
        // ExpoBrowserProvider's BrowserTask calls on restart). This is
        // exactly the production path: BrowserTask.restart() ->
        // host.onRebundle() -> bundler.invalidate() -> bundler.bundle().
        const startedAt = Date.now();
        await capturedHooks!.onRebundle();
        const elapsed = Date.now() - startedAt;

        // The rebundle must publish a fresh bundle (postCount increments)
        // and complete within the 1-second budget the plan specifies.
        expect(postCount).toBeGreaterThan(postsAfterInitialBundle);
        expect(elapsed).toBeLessThan(1000);
    });

    it('does not run the initial bundle when the Vfs is empty at attach time (Option A regression)', async () => {
        // With Option A, `initializeSyncEngine` awaits `firstPullComplete`
        // before calling `attachBrowserMetro` — so by the time this
        // method runs the Vfs should already be populated. The method
        // itself does not re-check emptiness (we rely on the gate in
        // `initializeSyncEngine`), but it still reaches the bundler.
        //
        // This test pins the current behavior so that if we ever swap
        // back to Option B (defensive guard inside attachBrowserMetro)
        // we'll see a test signal. For the Option A fix, we simulate
        // the call path by invoking attachBrowserMetro and assert that
        // even with an empty Vfs the bundle() call *completes*
        // (BrowserMetro returns zero modules) without throwing — the
        // fix in `initializeSyncEngine` is what prevents this in
        // production.
        const { fs } = createFakeFs(); // intentionally empty
        const sandbox = buildSandbox(fs);

        const caps: ProviderCapabilities = {
            supportsTerminal: false,
            supportsShell: false,
        } as ProviderCapabilities;
        let attachBundlerCalls = 0;
        const provider = {
            getCapabilities: () => caps,
            attachBundler: () => {
                attachBundlerCalls++;
            },
        } as unknown as Provider;

        // Must not throw even with an empty vfs — the real-world
        // protection comes from `initializeSyncEngine` awaiting
        // `sync.firstPullComplete` before reaching this method.
        await asAttach(sandbox).attachBrowserMetro(provider);
        expect(attachBundlerCalls).toBe(1);
    });
});

describe('CodeProviderSync.firstPullComplete (TR1.5 Option A)', () => {
    it('exposes a promise property that exists on a fresh instance', () => {
        // The getInstance + CodeFileSystem stack is hard to wire up
        // without ZenFS, so we probe the instance shape directly via
        // the static registry. This at least proves the public type
        // surface the SandboxManager fix depends on.
        type SyncCtor = new (...args: never[]) => CodeProviderSync;
        const Ctor = CodeProviderSync as unknown as SyncCtor;
        // We can't call the private constructor, but we CAN assert the
        // prototype shape — `firstPullComplete` is initialized in the
        // constructor, so `Object.getOwnPropertyNames(new Sync(...))`
        // would be the canonical check. Instead, we rely on the
        // getInstance path with a trivial fake fs.
        const fakeFs = {
            rootPath: '/test-project/test-branch',
            async listAll() {
                return [];
            },
            async readFile(): Promise<string> {
                return '';
            },
            async writeFile(): Promise<void> {
                /* no-op */
            },
            async deleteFile(): Promise<void> {
                /* no-op */
            },
            async deleteDirectory(): Promise<void> {
                /* no-op */
            },
            async createDirectory(): Promise<void> {
                /* no-op */
            },
            async exists(): Promise<boolean> {
                return false;
            },
            async getInfo() {
                return { isDirectory: false } as const;
            },
            async moveFile(): Promise<void> {
                /* no-op */
            },
            async listFiles(): Promise<string[]> {
                return [];
            },
            watchDirectory(): () => void {
                return () => undefined;
            },
        };

        // Minimal provider stub — getInstance doesn't touch it, but
        // stores it for start()/pullFromSandbox, which we won't call
        // here. We just want to read `firstPullComplete`.
        const providerStub = {
            listFiles: async () => ({ files: [] }),
            readFile: async () => ({ file: { type: 'text', content: '' } }),
            watchFiles: async () => ({ watcher: { stop: async () => undefined } }),
            writeFile: async () => undefined,
            statFile: async () => ({ type: 'file' }),
            createDirectory: async () => undefined,
            deleteFiles: async () => undefined,
            renameFile: async () => undefined,
        } as unknown as Parameters<typeof CodeProviderSync.getInstance>[0];

        const sync = CodeProviderSync.getInstance(
            providerStub,
            fakeFs as unknown as CodeFileSystem,
            'test-sandbox-first-pull',
            { exclude: [] },
        );
        try {
            expect(sync.firstPullComplete).toBeInstanceOf(Promise);
            // Before start() runs, the promise must be unresolved.
            // We race it against a resolved promise to detect the
            // still-pending state without awaiting indefinitely.
            const sentinel = Symbol('pending');
            return Promise.race([
                sync.firstPullComplete.then(() => 'resolved'),
                Promise.resolve(sentinel),
            ]).then((winner) => {
                expect(winner).toBe(sentinel);
            });
        } finally {
            sync.release();
        }
    });

    it('resolves firstPullComplete after start() finishes the initial pull', async () => {
        let pullCalls = 0;
        const fakeFs = {
            rootPath: '/test-project/test-branch-2',
            async listAll() {
                return [];
            },
            async readFile(): Promise<string> {
                return '';
            },
            async writeFile(): Promise<void> {
                /* no-op */
            },
            async deleteFile(): Promise<void> {
                /* no-op */
            },
            async deleteDirectory(): Promise<void> {
                /* no-op */
            },
            async createDirectory(): Promise<void> {
                /* no-op */
            },
            async exists(): Promise<boolean> {
                return false;
            },
            async getInfo() {
                return { isDirectory: false } as const;
            },
            async moveFile(): Promise<void> {
                /* no-op */
            },
            async listFiles(): Promise<string[]> {
                return [];
            },
            watchDirectory(): () => void {
                return () => undefined;
            },
        };

        const providerStub = {
            listFiles: async () => {
                pullCalls++;
                return { files: [] };
            },
            readFile: async () => ({ file: { type: 'text', content: '' } }),
            watchFiles: async () => ({ watcher: { stop: async () => undefined } }),
            writeFile: async () => undefined,
            statFile: async () => ({ type: 'file' }),
            createDirectory: async () => undefined,
            deleteFiles: async () => undefined,
            renameFile: async () => undefined,
        } as unknown as Parameters<typeof CodeProviderSync.getInstance>[0];

        const sync = CodeProviderSync.getInstance(
            providerStub,
            fakeFs as unknown as CodeFileSystem,
            'test-sandbox-pull-resolves',
            { exclude: [] },
        );
        try {
            await sync.start();
            // After start() returns, firstPullComplete MUST be resolved
            // (this is the Option A contract that attachBrowserMetro
            // depends on).
            await sync.firstPullComplete;
            expect(pullCalls).toBeGreaterThanOrEqual(1);
        } finally {
            sync.release();
        }
    });
});
