#!/usr/bin/env bun
/**
 * AbiHello WS-channel smoke for cf-expo-relay.
 *
 * Validates the Phase 11b handshake end-to-end against a live wrangler:
 *
 *   1. Connect a "phone" WebSocket to /hmr/<sessionId> on the relay.
 *   2. Connect an "editor" WebSocket to the same path.
 *   3. Phone sends a `role: 'phone'` AbiHelloMessage.
 *   4. Editor sends a `role: 'editor'` AbiHelloMessage.
 *   5. Assert: editor receives the phone's hello (relay forwarded).
 *   6. Assert: phone receives the editor's hello (relay forwarded).
 *   7. Late-joiner test: open a 3rd socket, assert it receives BOTH stored
 *      hellos via the per-role replay store added in `80d3d54f`.
 *
 * Used by `smoke-e2e.sh` as step #5. Operators can run it standalone too:
 *
 *   bun apps/cf-expo-relay/scripts/smoke-abi-hello.ts http://localhost:18788
 *
 * Exit codes:
 *   0 — every assertion passed
 *   1 — at least one assertion failed
 *   2 — connection setup failed
 */

const RELAY_BASE = process.argv[2] ?? 'http://localhost:18788';

interface AbiHelloMessage {
    type: 'abiHello';
    abi: 'v1';
    sessionId: string;
    role: 'editor' | 'phone';
    runtime: {
        abi: 'v1';
        baseHash: string;
        rnVersion: string;
        expoSdk: string;
        platform: 'ios' | 'android';
        aliases: readonly string[];
    };
}

const SESSION_ID = `smoke-abi-${Date.now()}`;

const wsUrl = `${RELAY_BASE.replace(/^http(s?):/, 'ws$1:').replace(/\/$/, '')}/hmr/${SESSION_ID}`;

const phoneHello: AbiHelloMessage = {
    type: 'abiHello',
    abi: 'v1',
    sessionId: SESSION_ID,
    role: 'phone',
    runtime: {
        abi: 'v1',
        baseHash: 'phone-base',
        rnVersion: '0.81.6',
        expoSdk: '54.0.0',
        platform: 'ios',
        aliases: ['react', 'react-native'],
    },
};
const editorHello: AbiHelloMessage = {
    type: 'abiHello',
    abi: 'v1',
    sessionId: SESSION_ID,
    role: 'editor',
    runtime: {
        abi: 'v1',
        baseHash: 'editor-base',
        rnVersion: '0.81.6',
        expoSdk: '54.0.0',
        platform: 'ios',
        aliases: ['react'],
    },
};

let failures = 0;
function ok(name: string): void {
    console.info(`[smoke-abi-hello] OK   ${name}`);
}
function fail(name: string, detail = ''): void {
    failures += 1;
    console.error(`[smoke-abi-hello] FAIL ${name}${detail ? `: ${detail}` : ''}`);
}

interface RecordedSocket {
    ws: WebSocket;
    received: AbiHelloMessage[];
}

async function openRecordingSocket(label: string): Promise<RecordedSocket> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const received: AbiHelloMessage[] = [];
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
                if (parsed.type === 'abiHello') {
                    received.push(parsed as AbiHelloMessage);
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

async function main(): Promise<void> {
    console.info(`[smoke-abi-hello] target=${wsUrl}`);

    let phone: RecordedSocket;
    let editor: RecordedSocket;
    try {
        phone = await openRecordingSocket('phone');
        editor = await openRecordingSocket('editor');
    } catch (err) {
        console.error(`[smoke-abi-hello] connection setup failed:`, err);
        process.exit(2);
    }

    // Step 1: phone sends its hello.
    phone.ws.send(JSON.stringify(phoneHello));
    await sleep(150); // give the relay a beat to fan out.
    if (editor.received.find((m) => m.role === 'phone')) {
        ok('editor received phone hello via relay forwarding');
    } else {
        fail('editor did NOT receive phone hello', `editor.received=${JSON.stringify(editor.received)}`);
    }
    if (phone.received.find((m) => m.role === 'phone')) {
        fail('phone received its OWN hello back (relay should exclude sender)');
    } else {
        ok('phone correctly excluded from its own hello fan-out');
    }

    // Step 2: editor sends its hello.
    editor.ws.send(JSON.stringify(editorHello));
    await sleep(150);
    if (phone.received.find((m) => m.role === 'editor')) {
        ok('phone received editor hello via relay forwarding');
    } else {
        fail('phone did NOT receive editor hello', `phone.received=${JSON.stringify(phone.received)}`);
    }

    // Step 3: late-joiner replay.
    const lateJoiner = await openRecordingSocket('late-joiner');
    await sleep(150);
    const replayedRoles = new Set(lateJoiner.received.map((m) => m.role));
    if (replayedRoles.has('phone') && replayedRoles.has('editor')) {
        ok('late-joiner received both stored hellos via replay');
    } else {
        fail(
            'late-joiner replay incomplete',
            `received roles=${JSON.stringify([...replayedRoles])}; expected ['editor','phone']`,
        );
    }

    // Cleanup.
    phone.ws.close();
    editor.ws.close();
    lateJoiner.ws.close();

    if (failures > 0) {
        console.error(`[smoke-abi-hello] ${failures} assertion(s) failed`);
        process.exit(1);
    }
    console.info('[smoke-abi-hello] all green');
}

main().catch((err) => {
    console.error('[smoke-abi-hello] unexpected error:', err);
    process.exit(2);
});
