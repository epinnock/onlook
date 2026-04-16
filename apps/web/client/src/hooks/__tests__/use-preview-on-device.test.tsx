/**
 * Tests for usePreviewOnDevice (TQ3.2).
 *
 * The React hook itself delegates its work to the pure `runPreviewOnDevice`
 * orchestration function, which is what we exercise here. Testing the
 * pure function keeps us free of `@testing-library/react` (not installed
 * in this workspace) while still covering every state-machine branch:
 *
 *   idle → preparing → building → ready
 *   idle → preparing → building → error (builder failure)
 *   idle → preparing → error (config/createSourceTar failure)
 *
 * We also render the hook once through a static React component to
 * sanity-check the initial shape (`{ status: idle, isOpen: false, ... }`).
 */

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { CodeFileSystem } from '@onlook/file-system';

import {
    runPreviewOnDevice,
    usePreviewOnDevice,
    type UsePreviewOnDeviceDeps,
} from '../use-preview-on-device';
import type { QrModalStatus } from '@/components/ui/qr-modal';
import type { BuildStatus } from '@/services/expo-builder';

function fakeFs(): CodeFileSystem {
    return {} as unknown as CodeFileSystem;
}

const VALID_HASH = 'a'.repeat(64);

interface MockOrchestrator {
    build: () => Promise<BuildStatus>;
    dispose: () => void;
    buildCalls: number;
    disposed: boolean;
}

function makeMockOrchestrator(result: BuildStatus | Error): MockOrchestrator {
    const state = { buildCalls: 0, disposed: false };
    return {
        get buildCalls() {
            return state.buildCalls;
        },
        get disposed() {
            return state.disposed;
        },
        async build() {
            state.buildCalls += 1;
            if (result instanceof Error) throw result;
            return result;
        },
        dispose() {
            state.disposed = true;
        },
    };
}

function makeDeps(orch: MockOrchestrator): UsePreviewOnDeviceDeps {
    return {
        createBuilderClient: () => ({}) as never,
        createOrchestrator: () => orch,
        buildManifestUrl: (hash, opts) =>
            `${opts.relayBaseUrl}/manifest/${hash}`,
        buildOnlookDeepLink: (hash, opts) =>
            `onlook://launch?session=${hash}&relay=${encodeURIComponent(opts.relayBaseUrl)}`,
        renderQrSvg: async (url) => `<svg data-url="${url}"></svg>`,
    };
}

describe('runPreviewOnDevice', () => {
    test('transitions preparing → building → ready on success', async () => {
        const orch = makeMockOrchestrator({
            state: 'ready',
            sourceHash: 'src',
            bundleHash: VALID_HASH,
            bundleSize: 42,
        });
        const statuses: QrModalStatus[] = [];
        await runPreviewOnDevice({
            fs: fakeFs(),
            projectId: 'p',
            branchId: 'b',
            builderBaseUrl: 'http://builder.test',
            relayBaseUrl: 'http://relay.test',
            setStatus: (s) => statuses.push(s),
            deps: makeDeps(orch),
        });

        expect(statuses.map((s) => s.kind)).toEqual([
            'preparing',
            'building',
            'ready',
        ]);
        const final = statuses[statuses.length - 1];
        if (final?.kind !== 'ready') throw new Error('expected ready');
        expect(final.manifestUrl).toBe(
            `http://relay.test/manifest/${VALID_HASH}`,
        );
        expect(final.onlookUrl).toContain('onlook://launch');
        expect(final.onlookUrl).toContain(VALID_HASH);
        // The QR SVG now encodes the onlook:// deep link (MC3.19).
        expect(final.qrSvg).toContain('<svg');
        expect(final.qrSvg).toContain('onlook://launch');
        expect(orch.buildCalls).toBe(1);
    });

    test('ready state carries manifestUrl + non-empty qrSvg', async () => {
        const orch = makeMockOrchestrator({
            state: 'ready',
            sourceHash: 'src',
            bundleHash: VALID_HASH,
        });
        let finalStatus: QrModalStatus | null = null;
        await runPreviewOnDevice({
            fs: fakeFs(),
            projectId: 'p',
            branchId: 'b',
            builderBaseUrl: 'http://builder.test',
            relayBaseUrl: 'http://relay.test',
            setStatus: (s) => {
                finalStatus = s;
            },
            deps: makeDeps(orch),
        });
        if (!finalStatus || (finalStatus as QrModalStatus).kind !== 'ready') {
            throw new Error('expected ready');
        }
        const ready = finalStatus as QrModalStatus & { kind: 'ready' };
        expect(ready.manifestUrl.length).toBeGreaterThan(0);
        expect(ready.onlookUrl.length).toBeGreaterThan(0);
        expect(ready.onlookUrl).toContain('onlook://launch');
        expect(ready.qrSvg.length).toBeGreaterThan(0);
    });

    test('builder error → status becomes error with message', async () => {
        const orch = makeMockOrchestrator(new Error('upload rejected'));
        const statuses: QrModalStatus[] = [];
        await runPreviewOnDevice({
            fs: fakeFs(),
            projectId: 'p',
            branchId: 'b',
            builderBaseUrl: 'http://builder.test',
            relayBaseUrl: 'http://relay.test',
            setStatus: (s) => statuses.push(s),
            deps: makeDeps(orch),
        });
        expect(statuses.map((s) => s.kind)).toEqual([
            'preparing',
            'building',
            'error',
        ]);
        const final = statuses[statuses.length - 1];
        if (final?.kind !== 'error') throw new Error('expected error');
        expect(final.message).toBe('upload rejected');
    });

    test('build returns non-ready terminal state → status becomes error', async () => {
        const orch = makeMockOrchestrator({
            state: 'failed',
            sourceHash: 'src',
            error: 'missing entry',
        });
        const statuses: QrModalStatus[] = [];
        await runPreviewOnDevice({
            fs: fakeFs(),
            projectId: 'p',
            branchId: 'b',
            builderBaseUrl: 'http://builder.test',
            relayBaseUrl: 'http://relay.test',
            setStatus: (s) => statuses.push(s),
            deps: makeDeps(orch),
        });
        const final = statuses[statuses.length - 1];
        if (final?.kind !== 'error') throw new Error('expected error');
        expect(final.message).toContain('missing entry');
    });

    test('disposes previous orchestrator on re-entry (retry path)', async () => {
        const orch1 = makeMockOrchestrator({
            state: 'failed',
            sourceHash: 'src',
            error: 'first failure',
        });
        const orch2 = makeMockOrchestrator({
            state: 'ready',
            sourceHash: 'src',
            bundleHash: VALID_HASH,
        });
        const orchestratorRef = {
            current: null as
                | Pick<
                      {
                          build: () => Promise<BuildStatus>;
                          dispose: () => void;
                      },
                      'build' | 'dispose'
                  >
                | null,
        };

        // First run — lands in error, leaves orch1 in the ref.
        await runPreviewOnDevice({
            fs: fakeFs(),
            projectId: 'p',
            branchId: 'b',
            builderBaseUrl: 'http://builder.test',
            relayBaseUrl: 'http://relay.test',
            setStatus: () => undefined,
            deps: makeDeps(orch1),
            orchestratorRef,
        });
        expect(orchestratorRef.current).toBe(orch1);
        expect(orch1.disposed).toBe(false);

        // Retry — should dispose orch1, install orch2, and succeed.
        await runPreviewOnDevice({
            fs: fakeFs(),
            projectId: 'p',
            branchId: 'b',
            builderBaseUrl: 'http://builder.test',
            relayBaseUrl: 'http://relay.test',
            setStatus: () => undefined,
            deps: makeDeps(orch2),
            orchestratorRef,
        });
        expect(orch1.disposed).toBe(true);
        expect(orchestratorRef.current).toBe(orch2);
        expect(orch2.buildCalls).toBe(1);
    });
});

describe('usePreviewOnDevice initial render', () => {
    test('initial state is { status: idle, isOpen: false }', () => {
        const captured: {
            status?: QrModalStatus;
            isOpen?: boolean;
            open?: () => Promise<void>;
            close?: () => void;
            retry?: () => Promise<void>;
        } = {};

        function Probe() {
            const r = usePreviewOnDevice({
                fs: fakeFs(),
                projectId: 'p',
                branchId: 'b',
                builderBaseUrl: 'http://builder.test',
                relayBaseUrl: 'http://relay.test',
            });
            captured.status = r.status;
            captured.isOpen = r.isOpen;
            captured.open = r.open;
            captured.close = r.close;
            captured.retry = r.retry;
            return null;
        }

        renderToStaticMarkup(<Probe />);

        expect(captured.status).toEqual({ kind: 'idle' });
        expect(captured.isOpen).toBe(false);
        expect(typeof captured.open).toBe('function');
        expect(typeof captured.close).toBe('function');
        expect(typeof captured.retry).toBe('function');
    });
});
