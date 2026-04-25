/// <reference types="bun" />
/**
 * HmrSession ABI v1 routing — task #5 / two-tier-overlay-v2 Phase 8.
 *
 * Covers the additive `overlayUpdate` path in `apps/cf-expo-relay/src/do/hmr-session.ts`
 * without assuming the legacy `overlay` path is removed. Shims the Cloudflare Workers
 * runtime globals (`DurableObject`, `WebSocket`, `WebSocketPair`) with a minimal
 * in-memory equivalent — just enough surface for `HmrSession` to run in bun:test.
 */
import { beforeAll, describe, expect, mock, test } from 'bun:test';

import {
    OverlayUpdateMessageSchema,
    type OverlayUpdateMessage,
} from '../../../../../packages/mobile-client-protocol/src/abi-v1.ts';

// Workers runtime shims. `DurableObject` is what HmrSession extends, and the
// various WebSocket globals are touched by handleWebSocket(). We don't exercise
// the WS path in this suite — only the POST /push JSON ingress — so the WS
// globals can be bare stubs that exist but never run.
mock.module('cloudflare:workers', () => ({
    DurableObject: class {
        protected ctx: unknown;
        protected env: unknown;
        constructor(ctx: unknown, env: unknown) {
            this.ctx = ctx;
            this.env = env;
        }
    },
}));

class FakeStorage {
    private readonly map = new Map<string, unknown>();
    async get(key: string): Promise<unknown> {
        return this.map.has(key) ? this.map.get(key) : null;
    }
    async put(key: string, value: unknown): Promise<void> {
        this.map.set(key, value);
    }
    snapshot(): Record<string, unknown> {
        return Object.fromEntries(this.map);
    }
}

type HmrSessionCtor = new (
    state: { storage: FakeStorage },
    env: Record<string, never>,
) => { fetch(req: Request): Promise<Response> };

let HmrSession: HmrSessionCtor;
beforeAll(async () => {
    const mod = await import('../../do/hmr-session');
    HmrSession = mod.HmrSession as unknown as HmrSessionCtor;
    // WebSocket globals — touched indirectly when loading the module. We don't
    // exercise them here so leave them as undefined-unless-set stubs.
    (globalThis as Record<string, unknown>).WebSocket ??= class {};
});

function makeSession(): { session: InstanceType<HmrSessionCtor>; storage: FakeStorage } {
    const storage = new FakeStorage();
    const session = new HmrSession({ storage }, {});
    return { session, storage };
}

function makeOverlayMessage(
    overrides: Partial<{ sessionId: string; source: string; overlayHash: string; buildDurationMs: number }> = {},
): OverlayUpdateMessage {
    return {
        type: 'overlayUpdate',
        abi: 'v1',
        sessionId: overrides.sessionId ?? 'session-abc',
        source: overrides.source ?? 'module.exports = { default: () => null };',
        assets: { abi: 'v1', assets: {} },
        meta: {
            overlayHash: overrides.overlayHash ?? 'a'.repeat(64),
            entryModule: 0,
            buildDurationMs: overrides.buildDurationMs ?? 12,
        },
    };
}

async function postPush(
    session: InstanceType<HmrSessionCtor>,
    body: string | object,
    contentType = 'application/json',
): Promise<Response> {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    return session.fetch(
        new Request('https://do/push', {
            method: 'POST',
            headers: { 'Content-Type': contentType },
            body: raw,
        }),
    );
}

describe('HmrSession — abi-v1 overlayUpdate routing (task #5)', () => {
    test('POST /push accepts a well-formed overlayUpdate and returns 202 { delivered: 0 }', async () => {
        const { session } = makeSession();
        const resp = await postPush(session, makeOverlayMessage());
        expect(resp.status).toBe(202);
        const body = (await resp.json()) as { delivered: number };
        expect(body.delivered).toBe(0);
    });

    test('POST /push persists overlayUpdate under last-overlay-v1 key', async () => {
        const { session, storage } = makeSession();
        const msg = makeOverlayMessage({ overlayHash: 'b'.repeat(64) });
        const resp = await postPush(session, msg);
        expect(resp.status).toBe(202);
        // Let the storage put (fire-and-forget in the DO) flush.
        await new Promise((r) => setTimeout(r, 5));
        const stored = storage.snapshot()['last-overlay-v1'];
        expect(typeof stored).toBe('string');
        const reparsed = OverlayUpdateMessageSchema.safeParse(JSON.parse(stored as string));
        expect(reparsed.success).toBe(true);
    });

    test('POST /push rejects overlayUpdate with abi: v0 via legacy fallthrough then final 400', async () => {
        const { session } = makeSession();
        const bad = { ...makeOverlayMessage(), abi: 'v0' };
        const resp = await postPush(session, bad);
        // Our impl tries v1 first → fails safeParse → falls through to
        // legacy `isOverlayMessage` check → also fails → returns 400.
        expect(resp.status).toBe(400);
    });

    test('POST /push rejects overlayUpdate with empty source', async () => {
        const { session } = makeSession();
        const bad = { ...makeOverlayMessage(), source: '' };
        const resp = await postPush(session, bad);
        expect(resp.status).toBe(400);
    });

    test('POST /push rejects non-JSON body with 400', async () => {
        const { session } = makeSession();
        const resp = await postPush(session, 'not json at all');
        expect(resp.status).toBe(400);
    });

    test('POST /push rejects non-JSON content-type with 415', async () => {
        const { session } = makeSession();
        const resp = await postPush(session, makeOverlayMessage(), 'text/plain');
        expect(resp.status).toBe(415);
    });

    test('legacy overlay messages still route through the fallthrough path (migration compat)', async () => {
        const { session } = makeSession();
        const legacy = { type: 'overlay', code: 'globalThis.legacy = 1;' };
        const resp = await postPush(session, legacy);
        expect(resp.status).toBe(202);
    });

    // ── task #76 additional coverage ────────────────────────────────────

    test('POST /push persists identical payload across two pushes, second overwrites first', async () => {
        const { session, storage } = makeSession();
        const a = makeOverlayMessage({ overlayHash: 'a'.repeat(64) });
        const b = makeOverlayMessage({ overlayHash: 'b'.repeat(64) });
        await postPush(session, a);
        await new Promise((r) => setTimeout(r, 5));
        const afterA = storage.snapshot()['last-overlay-v1'] as string;
        await postPush(session, b);
        await new Promise((r) => setTimeout(r, 5));
        const afterB = storage.snapshot()['last-overlay-v1'] as string;
        expect(afterA).not.toBe(afterB);
        expect(JSON.parse(afterB).meta.overlayHash).toBe('b'.repeat(64));
    });

    test('delivered counter equals 0 when no phone sockets are connected', async () => {
        const { session } = makeSession();
        const resp = await postPush(session, makeOverlayMessage());
        expect(resp.status).toBe(202);
        const body = (await resp.json()) as { delivered: number };
        expect(body.delivered).toBe(0);
    });

    test('POST /push with oversized body is rejected with 413', async () => {
        const { session } = makeSession();
        const oversized = { ...makeOverlayMessage(), source: 'x'.repeat(3 * 1024 * 1024) };
        const resp = await postPush(session, oversized);
        expect(resp.status).toBe(413);
    });

    test('POST /push accepts Content-Type with charset suffix', async () => {
        const { session } = makeSession();
        const resp = await postPush(
            session,
            makeOverlayMessage(),
            'application/json; charset=utf-8',
        );
        expect(resp.status).toBe(202);
    });
});
