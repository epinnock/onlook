import { describe, expect, test } from 'bun:test';

import type { OverlayDispatcher, OverlayListener } from '../../relay/overlayDispatcher';
import { startTwoTierBootstrap } from '../twoTierBootstrap';

class FakeDispatcher {
    started = 0;
    stopped = 0;
    unsubscribedCount = 0;
    private listeners = new Set<OverlayListener>();

    start(): void {
        this.started += 1;
    }

    stop(): void {
        this.stopped += 1;
    }

    onOverlay(listener: OverlayListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.unsubscribedCount += 1;
            this.listeners.delete(listener);
        };
    }

    emit(code: string, sourceMap?: unknown): void {
        for (const l of this.listeners) {
            l({ type: 'overlay', code, ...(sourceMap ? { sourceMap } : {}) } as Parameters<
                OverlayListener
            >[0]);
        }
    }
}

describe('startTwoTierBootstrap', () => {
    test('is a no-op handle when the flag is disabled', () => {
        const fake = new FakeDispatcher();
        const handle = startTwoTierBootstrap({
            sessionId: 'sess',
            relayUrl: 'http://relay',
            enabled: false,
            createDispatcher: () => fake as unknown as OverlayDispatcher,
        });

        expect(handle.active).toBe(false);
        expect(fake.started).toBe(0);
        handle.stop(); // idempotent no-op
        expect(fake.stopped).toBe(0);
    });

    test('starts a dispatcher and forwards overlays to mountOverlay when enabled', () => {
        const fake = new FakeDispatcher();
        const mounted: string[] = [];
        const handle = startTwoTierBootstrap({
            sessionId: 'sess-1',
            relayUrl: 'https://relay.example.com',
            enabled: true,
            createDispatcher: () => fake as unknown as OverlayDispatcher,
            mountOverlay: (code) => mounted.push(code),
        });

        expect(handle.active).toBe(true);
        expect(fake.started).toBe(1);

        fake.emit('globalThis.x=1;');
        fake.emit('globalThis.y=2;');

        expect(mounted).toEqual(['globalThis.x=1;', 'globalThis.y=2;']);
    });

    test('resolves http relay base to ws and builds the /hmr/:id URL', () => {
        const captured: string[] = [];
        const fake = new FakeDispatcher();
        startTwoTierBootstrap({
            sessionId: 'abc',
            relayUrl: 'http://relay.local:8787/',
            enabled: true,
            createDispatcher: (url) => {
                captured.push(url);
                return fake as unknown as OverlayDispatcher;
            },
        });

        expect(captured).toEqual(['ws://relay.local:8787/hmr/abc']);
    });

    test('stop() unsubscribes and stops the dispatcher exactly once', () => {
        const fake = new FakeDispatcher();
        const handle = startTwoTierBootstrap({
            sessionId: 'sess',
            relayUrl: 'ws://relay',
            enabled: true,
            createDispatcher: () => fake as unknown as OverlayDispatcher,
        });

        handle.stop();
        handle.stop(); // idempotent

        expect(fake.stopped).toBe(1);
        expect(fake.unsubscribedCount).toBe(1);
        expect(handle.active).toBe(false);
    });

    test('catches mountOverlay throws and logs instead of crashing', () => {
        const fake = new FakeDispatcher();
        const logs: string[] = [];
        startTwoTierBootstrap({
            sessionId: 'sess',
            relayUrl: 'ws://relay',
            enabled: true,
            createDispatcher: () => fake as unknown as OverlayDispatcher,
            mountOverlay: () => {
                throw new Error('native bridge not ready');
            },
            log: (msg) => logs.push(msg),
        });

        fake.emit('x');
        expect(logs.some((l) => l.includes('native bridge not ready'))).toBe(true);
    });

    test('warns when OnlookRuntime.reloadBundle is not available (runtime not booted)', () => {
        const fake = new FakeDispatcher();
        const logs: string[] = [];
        const priorMount = globalThis.OnlookRuntime;
        globalThis.OnlookRuntime = undefined;
        try {
            startTwoTierBootstrap({
                sessionId: 'sess',
                relayUrl: 'ws://relay',
                enabled: true,
                createDispatcher: () => fake as unknown as OverlayDispatcher,
                log: (msg) => logs.push(msg),
            });
            fake.emit('globalThis.x=1;');
            expect(
                logs.some((l) => l.includes('OnlookRuntime.reloadBundle is not available')),
            ).toBe(true);
        } finally {
            globalThis.OnlookRuntime = priorMount;
        }
    });

    test('delegates to globalThis.OnlookRuntime.reloadBundle by default', () => {
        const fake = new FakeDispatcher();
        const received: string[] = [];
        const priorRuntime = globalThis.OnlookRuntime;
        globalThis.OnlookRuntime = {
            reloadBundle: (code: string) => received.push(code),
        };
        try {
            startTwoTierBootstrap({
                sessionId: 'sess',
                relayUrl: 'ws://relay',
                enabled: true,
                createDispatcher: () => fake as unknown as OverlayDispatcher,
            });
            fake.emit('globalThis.onlookMount=function(){};');
            expect(received).toEqual(['globalThis.onlookMount=function(){};']);
        } finally {
            globalThis.OnlookRuntime = priorRuntime;
        }
    });
});
