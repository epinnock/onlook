import { describe, expect, mock, test } from 'bun:test';

import type { OverlayDispatcher, OverlayListener } from '../../relay/overlayDispatcher';
import type { OverlayAckPollHandle } from '../../relay/overlayAckPoll';
import { startTwoTierBootstrap } from '../twoTierBootstrap';

class FakeDispatcher {
    started = 0;
    stopped = 0;
    unsubscribedCount = 0;
    readonly sent: unknown[] = [];
    sendShouldFail = false;
    private listeners = new Set<OverlayListener>();

    start(): void {
        this.started += 1;
    }

    stop(): void {
        this.stopped += 1;
    }

    send(payload: unknown): boolean {
        if (this.sendShouldFail) return false;
        this.sent.push(payload);
        return true;
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

    /** Emit a v1-normalized message — post-dispatcher shape (abi flag set). */
    emitV1(code: string, extras: Record<string, unknown> = {}): void {
        for (const l of this.listeners) {
            l({
                type: 'overlay',
                code,
                abi: 'v1',
                sessionId: 'sess',
                ...extras,
            } as Parameters<OverlayListener>[0]);
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
                logs.some((l) =>
                    l.includes('neither OnlookRuntime.mountOverlay nor .reloadBundle is available'),
                ),
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

    // ─── v1 mount routing (Phase 11a phone-side — bidirectional) ────────────

    test('v1 message routes to OnlookRuntime.mountOverlay when the runtime is v1-capable', () => {
        const fake = new FakeDispatcher();
        const mountCalls: Array<{ source: string; props: unknown; assets: unknown }> = [];
        const priorRuntime = globalThis.OnlookRuntime;
        globalThis.OnlookRuntime = {
            abi: 'v1',
            mountOverlay: (source: string, props?: Record<string, unknown>, assets?: unknown) =>
                mountCalls.push({ source, props, assets }),
            reloadBundle: () => {
                throw new Error('reloadBundle should NOT be called for v1 messages');
            },
        };
        try {
            startTwoTierBootstrap({
                sessionId: 'sess',
                relayUrl: 'ws://relay',
                enabled: true,
                createDispatcher: () => fake as unknown as OverlayDispatcher,
            });
            fake.emitV1('envelope-v1-source', {
                assets: { abi: 'v1', assets: {} },
            });
            expect(mountCalls).toHaveLength(1);
            expect(mountCalls[0]?.source).toBe('envelope-v1-source');
            // props include sessionId + relayHost/relayPort extracted from
            // `ws://relay` — dedicated test below asserts the shape exactly.
            const props = mountCalls[0]?.props as Record<string, unknown>;
            expect(props.sessionId).toBe('sess');
            expect(mountCalls[0]?.assets).toEqual({ abi: 'v1', assets: {} });
        } finally {
            globalThis.OnlookRuntime = priorRuntime;
        }
    });

    test('v1 message does NOT fall back to reloadBundle when runtime lacks mountOverlay (fails loudly instead)', () => {
        const fake = new FakeDispatcher();
        const reloadCalls: string[] = [];
        const priorRuntime = globalThis.OnlookRuntime;
        // Runtime reports abi=v1 but doesn't expose mountOverlay — e.g. editor
        // flipped to v1 before the phone's runtime was upgraded. The bundle
        // MUST NOT fall back to reloadBundle: the v1 envelope self-evals but
        // doesn't render, so reloadBundle would produce a false-positive
        // 'mounted' ack. Instead the bootstrap must send 'failed' so the
        // editor's soak dashboard can detect the config drift.
        globalThis.OnlookRuntime = {
            abi: 'v1',
            reloadBundle: (code: string) => reloadCalls.push(code),
        };
        try {
            startTwoTierBootstrap({
                sessionId: 'sess-config-drift',
                relayUrl: 'ws://relay',
                enabled: true,
                createDispatcher: () => fake as unknown as OverlayDispatcher,
            });
            fake.emitV1('envelope-v1', {
                meta: {
                    overlayHash: 'c'.repeat(64),
                    entryModule: 0,
                    buildDurationMs: 0,
                },
            });
            // reloadBundle NOT called — the v1 envelope would silently mis-mount.
            expect(reloadCalls).toEqual([]);
            // Ack surfaces the config drift with a diagnostic message.
            expect(fake.sent).toHaveLength(1);
            const ack = fake.sent[0] as {
                status: string;
                overlayHash: string;
                error?: { message: string };
            };
            expect(ack.status).toBe('failed');
            expect(ack.overlayHash).toBe('c'.repeat(64));
            expect(ack.error?.message).toContain('OnlookRuntime is not v1-capable');
        } finally {
            globalThis.OnlookRuntime = priorRuntime;
        }
    });

    test('failed ack with abi-mismatch kind passes OverlayAckMessageSchema (editor wouldn\'t silently drop)', async () => {
        const fake = new FakeDispatcher();
        const priorRuntime = globalThis.OnlookRuntime;
        globalThis.OnlookRuntime = undefined;
        try {
            startTwoTierBootstrap({
                sessionId: 'sess',
                relayUrl: 'ws://relay',
                enabled: true,
                createDispatcher: () => fake as unknown as OverlayDispatcher,
            });
            fake.emitV1('v1-src', {
                meta: { overlayHash: 'e'.repeat(64), entryModule: 0, buildDurationMs: 0 },
            });
            const ack = fake.sent[0];
            const { OverlayAckMessageSchema } = await import('@onlook/mobile-client-protocol');
            const parse = OverlayAckMessageSchema.safeParse(ack);
            expect(parse.success).toBe(true);
        } finally {
            globalThis.OnlookRuntime = priorRuntime;
        }
    });

    test('failed ack from mount-throw uses overlay-runtime kind (passes schema)', async () => {
        const fake = new FakeDispatcher();
        startTwoTierBootstrap({
            sessionId: 'sess',
            relayUrl: 'ws://relay',
            enabled: true,
            createDispatcher: () => fake as unknown as OverlayDispatcher,
            mountOverlay: () => {
                throw new Error('render kaboom');
            },
        });
        fake.emit('legacy-code-that-throws');
        const ack = fake.sent[0] as { error?: { kind: string } };
        expect(ack.error?.kind).toBe('overlay-runtime');
        const { OverlayAckMessageSchema } = await import('@onlook/mobile-client-protocol');
        const parse = OverlayAckMessageSchema.safeParse(ack);
        expect(parse.success).toBe(true);
    });

    test('v1 message with NO runtime at all also fails loudly (not silent drop)', () => {
        const fake = new FakeDispatcher();
        const priorRuntime = globalThis.OnlookRuntime;
        globalThis.OnlookRuntime = undefined;
        try {
            startTwoTierBootstrap({
                sessionId: 'sess-no-runtime',
                relayUrl: 'ws://relay',
                enabled: true,
                createDispatcher: () => fake as unknown as OverlayDispatcher,
            });
            fake.emitV1('envelope-v1', {
                meta: {
                    overlayHash: 'd'.repeat(64),
                    entryModule: 0,
                    buildDurationMs: 0,
                },
            });
            // Failed ack sent even though runtime is undefined.
            expect(fake.sent).toHaveLength(1);
            const ack = fake.sent[0] as {
                status: string;
                error?: { message: string };
            };
            expect(ack.status).toBe('failed');
            expect(ack.error?.message).toContain('not v1-capable');
        } finally {
            globalThis.OnlookRuntime = priorRuntime;
        }
    });

    test('legacy message on a v1-capable runtime still uses reloadBundle (no auto-promotion)', () => {
        const fake = new FakeDispatcher();
        const mountCalls: string[] = [];
        const reloadCalls: string[] = [];
        const priorRuntime = globalThis.OnlookRuntime;
        globalThis.OnlookRuntime = {
            abi: 'v1',
            mountOverlay: (source: string) => mountCalls.push(source),
            reloadBundle: (code: string) => reloadCalls.push(code),
        };
        try {
            startTwoTierBootstrap({
                sessionId: 'sess',
                relayUrl: 'ws://relay',
                enabled: true,
                createDispatcher: () => fake as unknown as OverlayDispatcher,
            });
            // Legacy emit: no abi field.
            fake.emit('legacy-code');
            expect(mountCalls).toEqual([]); // mountOverlay NOT called
            expect(reloadCalls).toEqual(['legacy-code']);
        } finally {
            globalThis.OnlookRuntime = priorRuntime;
        }
    });

    test('v1 ack uses meta.overlayHash (real sha256) instead of the legacy-<length> fallback', () => {
        const fake = new FakeDispatcher();
        const realHash = 'a'.repeat(64); // sha256 hex shape
        startTwoTierBootstrap({
            sessionId: 'sess',
            relayUrl: 'ws://relay',
            enabled: true,
            createDispatcher: () => fake as unknown as OverlayDispatcher,
            mountOverlay: () => undefined, // explicit mount, no runtime needed
        });
        fake.emitV1('some-overlay-source', {
            meta: { overlayHash: realHash, entryModule: 0, buildDurationMs: 0 },
        });
        const ack = fake.sent[0] as { overlayHash: string };
        expect(ack.overlayHash).toBe(realHash);
    });

    test('legacy ack without meta falls back to legacy-<length> synthetic hash', () => {
        const fake = new FakeDispatcher();
        startTwoTierBootstrap({
            sessionId: 'sess',
            relayUrl: 'ws://relay',
            enabled: true,
            createDispatcher: () => fake as unknown as OverlayDispatcher,
            mountOverlay: () => undefined,
        });
        fake.emit('hi'); // 2 bytes of legacy code
        const ack = fake.sent[0] as { overlayHash: string };
        expect(ack.overlayHash).toBe('legacy-2');
    });

    test('v1 ack on mount-failure also uses the real overlayHash + carries the error', () => {
        const fake = new FakeDispatcher();
        const realHash = 'b'.repeat(64);
        startTwoTierBootstrap({
            sessionId: 'sess',
            relayUrl: 'ws://relay',
            enabled: true,
            createDispatcher: () => fake as unknown as OverlayDispatcher,
            mountOverlay: () => {
                throw new Error('mount kaboom');
            },
        });
        fake.emitV1('overlay-source', {
            meta: { overlayHash: realHash, entryModule: 0, buildDurationMs: 0 },
        });
        const ack = fake.sent[0] as {
            overlayHash: string;
            status: string;
            error?: { kind: string; message: string };
        };
        expect(ack.overlayHash).toBe(realHash);
        expect(ack.status).toBe('failed');
        expect(ack.error?.message).toContain('mount kaboom');
    });

    test('v1 mountOverlay props match AppRouter initial-mount shape {sessionId, relayHost, relayPort}', () => {
        const fake = new FakeDispatcher();
        const mountCalls: Array<{ source: string; props: unknown; assets: unknown }> = [];
        const priorRuntime = globalThis.OnlookRuntime;
        globalThis.OnlookRuntime = {
            abi: 'v1',
            mountOverlay: (source: string, props?: Record<string, unknown>, assets?: unknown) =>
                mountCalls.push({ source, props, assets }),
        };
        try {
            startTwoTierBootstrap({
                sessionId: 'sess-probe',
                relayUrl: 'ws://relay.example.com:8890',
                enabled: true,
                createDispatcher: () => fake as unknown as OverlayDispatcher,
            });
            fake.emitV1('v1-source', {
                assets: { abi: 'v1', assets: {} },
            });
            expect(mountCalls).toHaveLength(1);
            expect(mountCalls[0]?.props).toEqual({
                sessionId: 'sess-probe',
                relayHost: 'relay.example.com',
                relayPort: 8890,
            });
        } finally {
            globalThis.OnlookRuntime = priorRuntime;
        }
    });

    test('v1 mountOverlay props: wss:// default port 443 when port is omitted', () => {
        const fake = new FakeDispatcher();
        const mountCalls: Array<{ props: unknown }> = [];
        const priorRuntime = globalThis.OnlookRuntime;
        globalThis.OnlookRuntime = {
            abi: 'v1',
            mountOverlay: (_source: string, props?: Record<string, unknown>) =>
                mountCalls.push({ props }),
        };
        try {
            startTwoTierBootstrap({
                sessionId: 'sess',
                relayUrl: 'wss://relay.onlook.com',
                enabled: true,
                createDispatcher: () => fake as unknown as OverlayDispatcher,
            });
            fake.emitV1('v1-src');
            expect(mountCalls[0]?.props).toEqual({
                sessionId: 'sess',
                relayHost: 'relay.onlook.com',
                relayPort: 443,
            });
        } finally {
            globalThis.OnlookRuntime = priorRuntime;
        }
    });

    test('parseRelayUrlForProps: invalid URL returns empty object (props fall back to sessionId-only)', () => {
        const fake = new FakeDispatcher();
        const mountCalls: Array<{ props: unknown }> = [];
        const priorRuntime = globalThis.OnlookRuntime;
        globalThis.OnlookRuntime = {
            abi: 'v1',
            mountOverlay: (_source: string, props?: Record<string, unknown>) =>
                mountCalls.push({ props }),
        };
        try {
            startTwoTierBootstrap({
                sessionId: 'sess',
                relayUrl: 'not-a-url',
                enabled: true,
                createDispatcher: () => fake as unknown as OverlayDispatcher,
            });
            fake.emitV1('v1-src');
            expect(mountCalls[0]?.props).toEqual({ sessionId: 'sess' });
        } finally {
            globalThis.OnlookRuntime = priorRuntime;
        }
    });

    test('sends onlook:overlayAck with status=mounted after successful explicit mount', () => {
        const fake = new FakeDispatcher();
        const beforeSend = Date.now();
        startTwoTierBootstrap({
            sessionId: 'sess-ok',
            relayUrl: 'ws://relay',
            enabled: true,
            createDispatcher: () => fake as unknown as OverlayDispatcher,
            mountOverlay: () => {
                /* succeed */
            },
        });
        fake.emit('bundle-body-42-bytes-of-code-here-ok');
        expect(fake.sent.length).toBe(1);
        const ack = fake.sent[0] as {
            type: string;
            sessionId: string;
            overlayHash: string;
            status: string;
            timestamp: number;
        };
        expect(ack.type).toBe('onlook:overlayAck');
        expect(ack.sessionId).toBe('sess-ok');
        expect(ack.status).toBe('mounted');
        expect(ack.overlayHash).toBe(`legacy-${'bundle-body-42-bytes-of-code-here-ok'.length}`);
        expect(ack.timestamp).toBeGreaterThanOrEqual(beforeSend);
    });

    test('sends onlook:overlayAck with status=failed when explicit mount throws', () => {
        const fake = new FakeDispatcher();
        startTwoTierBootstrap({
            sessionId: 'sess-err',
            relayUrl: 'ws://relay',
            enabled: true,
            createDispatcher: () => fake as unknown as OverlayDispatcher,
            mountOverlay: () => {
                throw new Error('mount boom');
            },
        });
        fake.emit('payload');
        expect(fake.sent.length).toBe(1);
        const ack = fake.sent[0] as {
            status: string;
            error?: { kind: string; message: string };
        };
        expect(ack.status).toBe('failed');
        expect(ack.error?.message).toBe('mount boom');
    });

    test('sends ack via OnlookRuntime.reloadBundle path on success', () => {
        const fake = new FakeDispatcher();
        const priorRuntime = globalThis.OnlookRuntime;
        globalThis.OnlookRuntime = {
            reloadBundle: () => undefined,
        };
        try {
            startTwoTierBootstrap({
                sessionId: 'sess',
                relayUrl: 'ws://relay',
                enabled: true,
                createDispatcher: () => fake as unknown as OverlayDispatcher,
            });
            fake.emit('some-bundle-code');
            expect(fake.sent.length).toBe(1);
            expect((fake.sent[0] as { status: string }).status).toBe('mounted');
        } finally {
            globalThis.OnlookRuntime = priorRuntime;
        }
    });

    test('does NOT send ack when no mount path is available (runtime not booted)', () => {
        const fake = new FakeDispatcher();
        const priorRuntime = globalThis.OnlookRuntime;
        globalThis.OnlookRuntime = undefined;
        try {
            startTwoTierBootstrap({
                sessionId: 'sess',
                relayUrl: 'ws://relay',
                enabled: true,
                createDispatcher: () => fake as unknown as OverlayDispatcher,
            });
            fake.emit('code');
            expect(fake.sent.length).toBe(0);
        } finally {
            globalThis.OnlookRuntime = priorRuntime;
        }
    });

    test('ack survives when dispatcher.send reports failure (no throw, logs)', () => {
        const fake = new FakeDispatcher();
        fake.sendShouldFail = true;
        const logs: string[] = [];
        startTwoTierBootstrap({
            sessionId: 'sess',
            relayUrl: 'ws://relay',
            enabled: true,
            createDispatcher: () => fake as unknown as OverlayDispatcher,
            mountOverlay: () => undefined,
            log: (m) => logs.push(m),
        });
        expect(() => fake.emit('code')).not.toThrow();
        expect(fake.sent.length).toBe(0);
        expect(logs.some((l) => l.includes('sent=false'))).toBe(true);
    });

    test('starts overlay-ack poll with the same session / relay', () => {
        const fake = new FakeDispatcher();
        const pollStart = mock(
            (): OverlayAckPollHandle => ({
                installed: true,
                stop: () => {},
                getCursor: () => undefined,
                getSeenCount: () => 0,
            }),
        );
        startTwoTierBootstrap({
            sessionId: 'sess-ack',
            relayUrl: 'http://relay/manifest/x',
            enabled: true,
            createDispatcher: () => fake as unknown as OverlayDispatcher,
            startOverlayAckPoll: pollStart as unknown as typeof startTwoTierBootstrap extends (
                opts: infer T,
            ) => unknown
                ? T extends { startOverlayAckPoll?: infer P }
                    ? P
                    : never
                : never,
        });
        expect(pollStart).toHaveBeenCalledTimes(1);
        const call = pollStart.mock.calls[0]?.[0] as {
            sessionId: string;
            relayHost: string;
        };
        expect(call.sessionId).toBe('sess-ack');
        expect(call.relayHost).toBe('http://relay/manifest/x');
    });

    test('stop() tears down both the dispatcher and the ack poll', () => {
        const fake = new FakeDispatcher();
        const pollStop = mock(() => {});
        const pollStart = mock(
            (): OverlayAckPollHandle => ({
                installed: true,
                stop: pollStop,
                getCursor: () => undefined,
                getSeenCount: () => 0,
            }),
        );
        const handle = startTwoTierBootstrap({
            sessionId: 'sess',
            relayUrl: 'http://relay',
            enabled: true,
            createDispatcher: () => fake as unknown as OverlayDispatcher,
            startOverlayAckPoll: pollStart as unknown as Parameters<
                typeof startTwoTierBootstrap
            >[0]['startOverlayAckPoll'],
        });
        handle.stop();
        expect(pollStop).toHaveBeenCalledTimes(1);
        expect(fake.stopped).toBe(1);
    });

    test('forwards relay events to onRelayEvent', () => {
        const fake = new FakeDispatcher();
        const received: unknown[] = [];
        let capturedOnEvent:
            | ((e: { id: string; type: string; data: unknown }) => void)
            | undefined;
        const pollStart = mock(
            (opts: {
                onEvent: (e: { id: string; type: string; data: unknown }) => void;
            }): OverlayAckPollHandle => {
                capturedOnEvent = opts.onEvent;
                return {
                    installed: true,
                    stop: () => {},
                    getCursor: () => undefined,
                    getSeenCount: () => 0,
                };
            },
        );
        startTwoTierBootstrap({
            sessionId: 'sess',
            relayUrl: 'http://relay',
            enabled: true,
            createDispatcher: () => fake as unknown as OverlayDispatcher,
            startOverlayAckPoll: pollStart as unknown as Parameters<
                typeof startTwoTierBootstrap
            >[0]['startOverlayAckPoll'],
            onRelayEvent: (e) => received.push(e),
        });
        expect(typeof capturedOnEvent).toBe('function');
        capturedOnEvent?.({ id: 'e1', type: 'ack', data: { ok: true } });
        expect(received).toEqual([{ id: 'e1', type: 'ack', data: { ok: true } }]);
    });

    test('disabled flag still skips ack-poll start', () => {
        const pollStart = mock(() => ({
            installed: false,
            stop: () => {},
            getCursor: () => undefined,
            getSeenCount: () => 0,
        }));
        const fake = new FakeDispatcher();
        startTwoTierBootstrap({
            sessionId: 'sess',
            relayUrl: 'http://relay',
            enabled: false,
            createDispatcher: () => fake as unknown as OverlayDispatcher,
            startOverlayAckPoll: pollStart as unknown as Parameters<
                typeof startTwoTierBootstrap
            >[0]['startOverlayAckPoll'],
        });
        expect(pollStart).toHaveBeenCalledTimes(0);
    });

    // --- mountDurationMs measurement (OverlayAckMessage eval-latency) ---
    // Phone-side measurement around the mount call. Lands in the ack so
    // the editor can compute the Phase 11b Q5b (eval-latency p95) signal
    // from real device runs. ADR-0001 target: ≤100ms on a 2-year-old
    // iPhone for a typical 50–100 KB overlay.

    test('explicit mountOverlay path includes mountDurationMs in the ack', () => {
        const fake = new FakeDispatcher();
        startTwoTierBootstrap({
            sessionId: 'sess',
            relayUrl: 'http://relay',
            enabled: true,
            createDispatcher: () => fake as unknown as OverlayDispatcher,
            mountOverlay: () => undefined,
            startOverlayAckPoll: () =>
                ({ installed: false, stop: () => undefined }) satisfies OverlayAckPollHandle,
        });

        fake.emit('x'.repeat(100));
        expect(fake.sent.length).toBe(1);
        const ack = fake.sent[0] as Record<string, unknown>;
        expect(ack.status).toBe('mounted');
        expect(typeof ack.mountDurationMs).toBe('number');
        expect(ack.mountDurationMs as number).toBeGreaterThanOrEqual(0);
    });

    test('failed mount does NOT include mountDurationMs (only successful mounts carry it)', () => {
        const fake = new FakeDispatcher();
        startTwoTierBootstrap({
            sessionId: 'sess',
            relayUrl: 'http://relay',
            enabled: true,
            createDispatcher: () => fake as unknown as OverlayDispatcher,
            mountOverlay: () => {
                throw new Error('boom');
            },
            startOverlayAckPoll: () =>
                ({ installed: false, stop: () => undefined }) satisfies OverlayAckPollHandle,
        });

        fake.emit('x');
        const ack = fake.sent[0] as Record<string, unknown>;
        expect(ack.status).toBe('failed');
        // Omitted — legacy relay/schema paths stay backward-compatible when
        // the field is absent. Failure latency could still be useful but
        // is deferred to a future iteration.
        expect(ack.mountDurationMs).toBeUndefined();
    });

    test('v1 mountOverlay path measures duration around runtime.mountOverlay', () => {
        const fake = new FakeDispatcher();
        const runtimeStub = {
            abi: 'v1' as const,
            mountOverlay: mock(() => undefined),
        };
        const prev = globalThis.OnlookRuntime;
        (globalThis as { OnlookRuntime?: unknown }).OnlookRuntime = runtimeStub;
        try {
            startTwoTierBootstrap({
                sessionId: 'sess',
                relayUrl: 'ws://relay:8787',
                enabled: true,
                createDispatcher: () => fake as unknown as OverlayDispatcher,
                startOverlayAckPoll: () =>
                    ({ installed: false, stop: () => undefined }) satisfies OverlayAckPollHandle,
            });
            fake.emitV1('x'.repeat(200));
            expect(runtimeStub.mountOverlay).toHaveBeenCalledTimes(1);
            const ack = fake.sent[0] as Record<string, unknown>;
            expect(ack.status).toBe('mounted');
            expect(typeof ack.mountDurationMs).toBe('number');
            expect(ack.mountDurationMs as number).toBeGreaterThanOrEqual(0);
        } finally {
            (globalThis as { OnlookRuntime?: unknown }).OnlookRuntime = prev;
        }
    });

    test('legacy reloadBundle path measures duration too', () => {
        const fake = new FakeDispatcher();
        const runtimeStub = { reloadBundle: mock(() => undefined) };
        const prev = globalThis.OnlookRuntime;
        (globalThis as { OnlookRuntime?: unknown }).OnlookRuntime = runtimeStub;
        try {
            startTwoTierBootstrap({
                sessionId: 'sess',
                relayUrl: 'http://relay',
                enabled: true,
                createDispatcher: () => fake as unknown as OverlayDispatcher,
                startOverlayAckPoll: () =>
                    ({ installed: false, stop: () => undefined }) satisfies OverlayAckPollHandle,
            });
            fake.emit('legacy-code');
            expect(runtimeStub.reloadBundle).toHaveBeenCalledTimes(1);
            const ack = fake.sent[0] as Record<string, unknown>;
            expect(ack.status).toBe('mounted');
            expect(typeof ack.mountDurationMs).toBe('number');
        } finally {
            (globalThis as { OnlookRuntime?: unknown }).OnlookRuntime = prev;
        }
    });

    test('measureMountDuration: non-finite delta → mountDurationMs omitted from ack', () => {
        // Simulate a broken clock where `performance.now()` returns a
        // value that produces a non-finite delta (e.g. start=NaN,
        // end=NaN). The clamp in `measureMountDuration` should cause
        // sendAck to drop the field entirely rather than emit Infinity.
        const fake = new FakeDispatcher();
        const originalPerformance = (
            globalThis as { performance?: unknown }
        ).performance;
        try {
            (globalThis as { performance?: unknown }).performance = {
                now: () => NaN,
            };
            startTwoTierBootstrap({
                sessionId: 'sess',
                relayUrl: 'http://relay',
                enabled: true,
                createDispatcher: () => fake as unknown as OverlayDispatcher,
                mountOverlay: () => undefined,
                startOverlayAckPoll: () =>
                    ({ installed: false, stop: () => undefined }) satisfies OverlayAckPollHandle,
            });
            fake.emit('x');
            const ack = fake.sent[0] as Record<string, unknown>;
            expect(ack.status).toBe('mounted');
            // Omitted — caller's Number.isFinite guard drops it instead
            // of surfacing NaN/Infinity in the ack.
            expect(ack.mountDurationMs).toBeUndefined();
        } finally {
            (globalThis as { performance?: unknown }).performance = originalPerformance;
        }
    });
});
