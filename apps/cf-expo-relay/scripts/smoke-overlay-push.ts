#!/usr/bin/env bun
/**
 * Overlay v1 push fan-out WS smoke for cf-expo-relay.
 *
 * Validates the main v2 data path end-to-end against a live wrangler:
 *
 *   1. Connect a "phone" WebSocket to /hmr/<sessionId>.
 *   2. Editor POSTs an OverlayUpdateMessage to /push/<sessionId>.
 *   3. Assert: relay returns 202 with `delivered: 1`.
 *   4. Assert: phone WS receives the OverlayUpdateMessage verbatim
 *      (relay's HmrSession.handlePush fan-out worked).
 *   5. Assert: a fresh "late-joiner" socket receives the same overlay
 *      via replay (relay's lastOverlayV1Payload store).
 *
 * Exit codes:
 *   0 — every assertion passed
 *   1 — at least one assertion failed
 *   2 — connection / push setup failed
 *
 * Used by smoke-e2e.sh as step #6. Operators run standalone:
 *   bun apps/cf-expo-relay/scripts/smoke-overlay-push.ts http://localhost:18788
 *
 * Companion to smoke-abi-hello.ts: that one tests the handshake
 * channel; this one tests the overlay-update channel that the
 * handshake gates.
 */

import { createHash } from 'node:crypto';

const RELAY_BASE = process.argv[2] ?? 'http://localhost:18788';

interface OverlayUpdateMessage {
    type: 'overlayUpdate';
    abi: 'v1';
    sessionId: string;
    source: string;
    assets: { abi: 'v1'; assets: Record<string, never> };
    meta: {
        overlayHash: string;
        entryModule: 0;
        buildDurationMs: number;
    };
}

const SESSION_ID = `smoke-push-${Date.now()}`;
const HTTP_BASE = RELAY_BASE.replace(/\/$/, '');
const WS_URL = `${HTTP_BASE.replace(/^http(s?):/, 'ws$1:')}/hmr/${SESSION_ID}`;
const PUSH_URL = `${HTTP_BASE}/push/${encodeURIComponent(SESSION_ID)}`;

let failures = 0;
function ok(name: string): void {
    console.info(`[smoke-overlay-push] OK   ${name}`);
}
function fail(name: string, detail = ''): void {
    failures += 1;
    console.error(
        `[smoke-overlay-push] FAIL ${name}${detail ? `: ${detail}` : ''}`,
    );
}

interface RecordedSocket {
    ws: WebSocket;
    received: OverlayUpdateMessage[];
}

async function openSocket(label: string): Promise<RecordedSocket> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(WS_URL);
        const received: OverlayUpdateMessage[] = [];
        const timeout = setTimeout(() => {
            reject(new Error(`${label}: WS open timed out after 5s`));
        }, 5000);
        ws.addEventListener('open', () => {
            clearTimeout(timeout);
            resolve({ ws, received });
        });
        ws.addEventListener('error', (ev) => {
            clearTimeout(timeout);
            reject(new Error(`${label}: WS error ${JSON.stringify(ev)}`));
        });
        ws.addEventListener('message', (ev) => {
            if (typeof ev.data !== 'string') return;
            try {
                const parsed = JSON.parse(ev.data) as { type?: string };
                if (parsed.type === 'overlayUpdate') {
                    received.push(parsed as OverlayUpdateMessage);
                }
            } catch {
                /* ignore non-JSON */
            }
        });
    });
}

async function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

function buildOverlayMessage(overlayHash: string): OverlayUpdateMessage {
    // Minimal Hermes-safe-ish CJS source — the smoke doesn't actually
    // mount, just validates wire shape. Real overlays come from
    // wrapOverlayV1 against an esbuild-bundled CJS.
    const source = `"use strict";(function(){})();`;
    return {
        type: 'overlayUpdate',
        abi: 'v1',
        sessionId: SESSION_ID,
        source,
        assets: { abi: 'v1', assets: {} },
        meta: {
            overlayHash,
            entryModule: 0,
            buildDurationMs: 5,
        },
    };
}

async function main(): Promise<void> {
    console.info(`[smoke-overlay-push] target=${HTTP_BASE} sessionId=${SESSION_ID}`);

    let phone: RecordedSocket;
    try {
        phone = await openSocket('phone');
    } catch (err) {
        console.error(`[smoke-overlay-push] phone WS setup failed:`, err);
        process.exit(2);
    }

    // Build a deterministic overlay so the assertion can compare hashes.
    const sourceForHash = `"use strict";(function(){})();`;
    const overlayHash = createHash('sha256').update(sourceForHash).digest('hex');
    const message = buildOverlayMessage(overlayHash);

    // Step 1: editor POSTs to /push.
    let pushResp: Response;
    try {
        pushResp = await fetch(PUSH_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(message),
        });
    } catch (err) {
        console.error(`[smoke-overlay-push] /push fetch failed:`, err);
        phone.ws.close();
        process.exit(2);
    }
    if (pushResp.status !== 202) {
        fail('relay /push status', `expected 202, got ${pushResp.status}`);
    } else {
        ok('relay /push returned 202');
    }
    let pushBody: { delivered?: number };
    try {
        pushBody = (await pushResp.json()) as { delivered?: number };
    } catch {
        fail('relay /push body parseable as JSON');
        pushBody = {};
    }
    if (pushBody.delivered === 1) {
        ok('relay /push reported delivered:1 (fan-out to phone WS)');
    } else {
        fail(
            'relay /push delivered count',
            `expected 1, got ${JSON.stringify(pushBody)}`,
        );
    }

    // Step 2: phone WS should have received the overlay.
    await sleep(150);
    if (phone.received.find((m) => m.meta.overlayHash === overlayHash)) {
        ok('phone WS received the OverlayUpdateMessage via fan-out');
    } else {
        fail(
            'phone WS did NOT receive the OverlayUpdateMessage',
            `received=${JSON.stringify(phone.received)}`,
        );
    }

    // Step 3: late-joiner replay.
    const lateJoiner = await openSocket('late-joiner');
    await sleep(150);
    const replayed = lateJoiner.received.find(
        (m) => m.meta.overlayHash === overlayHash,
    );
    if (replayed) {
        ok('late-joiner received the stored overlay via replay');
    } else {
        fail(
            'late-joiner did NOT receive replay',
            `received=${JSON.stringify(lateJoiner.received)}`,
        );
    }

    // Cleanup.
    phone.ws.close();
    lateJoiner.ws.close();

    if (failures > 0) {
        console.error(`[smoke-overlay-push] ${failures} assertion(s) failed`);
        process.exit(1);
    }
    console.info('[smoke-overlay-push] all green');
}

main().catch((err) => {
    console.error('[smoke-overlay-push] unexpected error:', err);
    process.exit(2);
});
