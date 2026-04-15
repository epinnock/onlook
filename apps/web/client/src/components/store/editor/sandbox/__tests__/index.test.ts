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

/**
 * Pin the active provider on the sandbox's `SessionManager` so that
 * FOUND-R1.5-followup's stale-provider check inside the retry path
 * recognizes the provider under test as "still active".
 *
 * `SessionManager` uses `makeAutoObservable`, which wraps plain objects
 * in a MobX observable proxy. Identity comparisons must use the proxied
 * value read back from `session.provider`, NOT the raw object the test
 * passed in. Returns the proxied provider for convenience.
 */
function bindSessionProvider(sandbox: SandboxManager, provider: Provider | null): Provider | null {
    const session = (sandbox as unknown as { session: { provider: Provider | null } }).session;
    session.provider = provider;
    return session.provider;
}

/**
 * Wait for condition() to become true, polling every 25ms up to a timeout.
 * Used to let the defensive setTimeout-based retry inside
 * attachBrowserMetro fire in tests without relying on fake timers.
 */
async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
    const startedAt = Date.now();
    while (!condition()) {
        if (Date.now() - startedAt > timeoutMs) {
            throw new Error(`waitFor timed out after ${timeoutMs}ms`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
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

    it('FOUND-R1.5-followup: returns early without attaching the bundler when the Vfs is empty at attach time', async () => {
        // The defensive guard short-circuits if the local Vfs has zero
        // files — see `plans/expo-browser-status.md` (2026-04-08). The
        // shared `CodeProviderSync` instance can resolve its
        // `firstPullComplete` from a previous consumer's pull, leaving
        // this consumer's view of the Vfs empty at the moment we attach.
        // When that happens the bundler attach MUST be deferred, not
        // run against an empty file system.
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
        // Session provider is null in this test so the scheduled retry
        // will be a no-op — we're only asserting the early-return here.
        bindSessionProvider(sandbox, null);

        await asAttach(sandbox).attachBrowserMetro(provider);

        // Bundler attach MUST NOT have happened — the Vfs is empty, so
        // `provider.attachBundler` is never reached and `bundler.bundle`
        // is never called.
        expect(attachBundlerCalls).toBe(0);
    });

    it('FOUND-R1.5-followup: the scheduled retry attaches once the Vfs becomes non-empty', async () => {
        // With the defensive guard, the empty-Vfs path schedules a
        // re-attempt via setTimeout. Once the local file system has been
        // populated (simulating the real sync engine landing its pull
        // after attach was called), the next retry must succeed and
        // attach the bundler exactly once.
        const { fs, files } = createFakeFs(); // intentionally empty at first
        const sandbox = buildSandbox(fs);

        // Drain BroadcastChannel traffic — the bundler's publish path
        // requires a working BC global.
        class NoopBC {
            constructor(_name: string) { /* no-op */ }
            postMessage(_msg: unknown): void { /* no-op */ }
            close(): void { /* no-op */ }
        }
        globalThis.BroadcastChannel = NoopBC as unknown as typeof BroadcastChannel;

        let attachBundlerCalls = 0;
        const caps: ProviderCapabilities = {
            supportsTerminal: false,
            supportsShell: false,
        } as ProviderCapabilities;
        const rawProvider = {
            getCapabilities: () => caps,
            attachBundler: () => {
                attachBundlerCalls++;
            },
        } as unknown as Provider;
        // The retry only fires if the session.provider still matches,
        // so pin it here the way the real SessionManager would. Use the
        // PROXIED value returned by bindSessionProvider — MobX wraps
        // plain objects on assignment, and we must pass the wrapped
        // identity all the way through to match production semantics.
        const provider = bindSessionProvider(sandbox, rawProvider)!;

        // First attach: Vfs empty, so the guard early-returns and a
        // retry is scheduled via setTimeout(500ms).
        await asAttach(sandbox).attachBrowserMetro(provider);
        expect(attachBundlerCalls).toBe(0);

        // Simulate the sync engine finally landing its pull by writing
        // to the fake Vfs AFTER the guard ran.
        files.set('App.tsx', 'export default function App() { return null; }');
        files.set('package.json', '{"name":"expo-test"}');

        // Wait for the scheduled retry to fire and actually attach.
        await waitFor(() => attachBundlerCalls > 0, 3000);
        expect(attachBundlerCalls).toBe(1);
    });

    it('FOUND-R1.5-followup: retry is a no-op if the session provider has been swapped out', async () => {
        // Guardrail: a deferred retry must not bundle for a stale
        // provider. If the SessionManager has torn down or swapped the
        // active provider between the early-return and the scheduled
        // retry, the retry callback must skip the re-attach entirely.
        const { fs, files } = createFakeFs(); // intentionally empty
        const sandbox = buildSandbox(fs);

        let attachBundlerCalls = 0;
        const caps: ProviderCapabilities = {
            supportsTerminal: false,
            supportsShell: false,
        } as ProviderCapabilities;
        const rawProvider = {
            getCapabilities: () => caps,
            attachBundler: () => {
                attachBundlerCalls++;
            },
        } as unknown as Provider;
        // Pin this provider as "active" so the early-return path
        // schedules the retry. Use the MobX-proxied identity from
        // bindSessionProvider so the retry's `===` check would match
        // if we didn't swap it out below.
        const provider = bindSessionProvider(sandbox, rawProvider)!;

        await asAttach(sandbox).attachBrowserMetro(provider);
        expect(attachBundlerCalls).toBe(0);

        // Swap out the active provider BEFORE the retry fires, then
        // populate the Vfs. The retry callback should see a mismatched
        // `session.provider` and bail out without attaching.
        bindSessionProvider(sandbox, null);
        files.set('App.tsx', 'export default function App() { return null; }');

        // Wait longer than the retry interval (500ms) so the callback
        // has definitely fired, then assert no attach happened.
        await new Promise((resolve) => setTimeout(resolve, 750));
        expect(attachBundlerCalls).toBe(0);
    });
});

describe('CodeProviderSync.firstPullComplete (TR1.5 Option A)', () => {
    it('does not reuse a sync instance for a different file-system object with the same root path', () => {
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

        const createFakeFs = () =>
            ({
                rootPath: '/test-project/shared-root',
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
            }) as unknown as CodeFileSystem;

        const firstFs = createFakeFs();
        const secondFs = createFakeFs();

        const firstSync = CodeProviderSync.getInstance(
            providerStub,
            firstFs,
            'test-sandbox-instance-identity',
            { exclude: [] },
        );
        const secondSync = CodeProviderSync.getInstance(
            providerStub,
            secondFs,
            'test-sandbox-instance-identity',
            { exclude: [] },
        );

        try {
            expect(secondSync).not.toBe(firstSync);
        } finally {
            firstSync.release();
            secondSync.release();
        }
    });

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
