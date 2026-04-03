/**
 * T5.6 - Contract / integration tests for the Cloudflare Sandbox Worker REST
 * endpoints defined in apps/sandbox-worker/src/index.ts.
 *
 * These are runnable with `bun test` against a live Worker (local or remote).
 * When the Worker is unreachable every test is skipped gracefully.
 *
 * Set CF_WORKER_URL to point at a running Worker instance.
 * Default: http://localhost:8787
 */
import { describe, test, expect, beforeAll } from 'bun:test';

const WORKER_URL = process.env.CF_WORKER_URL || 'http://localhost:8787';

let workerAvailable = false;

async function isWorkerRunning(): Promise<boolean> {
    try {
        const res = await fetch(`${WORKER_URL}/health`, {
            signal: AbortSignal.timeout(2000),
        });
        return res.ok;
    } catch {
        return false;
    }
}

/** Helper: skip the current test when the Worker is not reachable. */
function skipIfNoWorker() {
    if (!workerAvailable) {
        // Bun's test runner does not have a built-in per-test skip inside the
        // body, but returning early after a trivial assertion keeps the suite
        // green and clearly communicates what happened in the output.
        console.log('[SKIP] Worker not available at', WORKER_URL);
    }
}

/** POST JSON helper */
async function post(path: string, body: Record<string, unknown>) {
    return fetch(`${WORKER_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

// -----------------------------------------------------------------------
// Suite
// -----------------------------------------------------------------------

describe('CF Worker Endpoints', () => {
    beforeAll(async () => {
        workerAvailable = await isWorkerRunning();
        if (!workerAvailable) {
            console.warn(
                `\n  CF Worker not reachable at ${WORKER_URL} — all endpoint tests will be skipped.\n` +
                    '  Start the Worker with `cd apps/sandbox-worker && wrangler dev` or set CF_WORKER_URL.\n',
            );
        }
    });

    // -------------------------------------------------------------------
    // 1. Health check
    // -------------------------------------------------------------------

    test('GET /health returns status ok with a timestamp', async () => {
        skipIfNoWorker();
        if (!workerAvailable) return;

        const res = await fetch(`${WORKER_URL}/health`);
        expect(res.status).toBe(200);

        const data = (await res.json()) as Record<string, unknown>;
        expect(data).toHaveProperty('status', 'ok');
        expect(data).toHaveProperty('timestamp');
        expect(typeof data.timestamp).toBe('string');
        // Timestamp should be a valid ISO date string
        expect(Number.isNaN(Date.parse(data.timestamp as string))).toBe(false);
    });

    // -------------------------------------------------------------------
    // 2. Create sandbox response shape
    // -------------------------------------------------------------------

    test('POST /sandbox/create returns sandboxId and ready flag', async () => {
        skipIfNoWorker();
        if (!workerAvailable) return;

        const res = await post('/sandbox/create', {});
        expect(res.status).toBe(200);

        const data = (await res.json()) as Record<string, unknown>;
        expect(data).toHaveProperty('sandboxId');
        expect(typeof data.sandboxId).toBe('string');
        expect((data.sandboxId as string).length).toBeGreaterThan(0);
        expect(data).toHaveProperty('ready');
        expect(typeof data.ready).toBe('boolean');
    });

    test('POST /sandbox/create with custom id uses that id', async () => {
        skipIfNoWorker();
        if (!workerAvailable) return;

        const customId = `test-sandbox-${Date.now()}`;
        const res = await post('/sandbox/create', { id: customId });
        expect(res.status).toBe(200);

        const data = (await res.json()) as Record<string, unknown>;
        expect(data.sandboxId).toBe(customId);
    });

    // -------------------------------------------------------------------
    // 3. Exec with valid sandbox
    // -------------------------------------------------------------------

    test('POST /sandbox/exec returns stdout, stderr, exitCode, success', async () => {
        skipIfNoWorker();
        if (!workerAvailable) return;

        // First create a sandbox to get a valid sandboxId
        const createRes = await post('/sandbox/create', {});
        const { sandboxId } = (await createRes.json()) as { sandboxId: string };

        const res = await post('/sandbox/exec', {
            sandboxId,
            command: 'echo hello',
        });
        expect(res.status).toBe(200);

        const data = (await res.json()) as Record<string, unknown>;
        expect(data).toHaveProperty('stdout');
        expect(data).toHaveProperty('stderr');
        expect(data).toHaveProperty('exitCode');
        expect(data).toHaveProperty('success');
        expect(typeof data.stdout).toBe('string');
        expect(typeof data.stderr).toBe('string');
        expect(typeof data.exitCode).toBe('number');
        expect(typeof data.success).toBe('boolean');
    });

    // -------------------------------------------------------------------
    // 4. Exec without sandboxId returns error
    // -------------------------------------------------------------------

    test('POST /sandbox/exec without sandboxId returns 400 error', async () => {
        skipIfNoWorker();
        if (!workerAvailable) return;

        const res = await post('/sandbox/exec', { command: 'echo hi' });
        expect(res.status).toBe(400);

        const data = (await res.json()) as Record<string, unknown>;
        expect(data).toHaveProperty('error');
        expect(typeof data.error).toBe('string');
    });

    test('POST /sandbox/exec without command returns 400 error', async () => {
        skipIfNoWorker();
        if (!workerAvailable) return;

        const createRes = await post('/sandbox/create', {});
        const { sandboxId } = (await createRes.json()) as { sandboxId: string };

        const res = await post('/sandbox/exec', { sandboxId });
        expect(res.status).toBe(400);

        const data = (await res.json()) as Record<string, unknown>;
        expect(data).toHaveProperty('error');
        expect((data.error as string).toLowerCase()).toContain('command');
    });

    // -------------------------------------------------------------------
    // 5. File write + read round-trip
    // -------------------------------------------------------------------

    test('POST /sandbox/file/write then /sandbox/file/read round-trips content', async () => {
        skipIfNoWorker();
        if (!workerAvailable) return;

        const createRes = await post('/sandbox/create', {});
        const { sandboxId } = (await createRes.json()) as { sandboxId: string };

        const testPath = '/tmp/scry-test-file.txt';
        const testContent = `hello-from-test-${Date.now()}`;

        // Write
        const writeRes = await post('/sandbox/file/write', {
            sandboxId,
            path: testPath,
            content: testContent,
        });
        expect(writeRes.status).toBe(200);
        const writeData = (await writeRes.json()) as Record<string, unknown>;
        expect(writeData).toHaveProperty('ok', true);

        // Read back
        const readRes = await post('/sandbox/file/read', {
            sandboxId,
            path: testPath,
        });
        expect(readRes.status).toBe(200);
        const readData = (await readRes.json()) as Record<string, unknown>;
        expect(readData).toHaveProperty('content');
        expect(readData.content).toBe(testContent);
    });

    test('POST /sandbox/file/read without path returns 400 error', async () => {
        skipIfNoWorker();
        if (!workerAvailable) return;

        const createRes = await post('/sandbox/create', {});
        const { sandboxId } = (await createRes.json()) as { sandboxId: string };

        const res = await post('/sandbox/file/read', { sandboxId });
        expect(res.status).toBe(400);

        const data = (await res.json()) as Record<string, unknown>;
        expect(data).toHaveProperty('error');
    });

    test('POST /sandbox/file/write without path returns 400 error', async () => {
        skipIfNoWorker();
        if (!workerAvailable) return;

        const createRes = await post('/sandbox/create', {});
        const { sandboxId } = (await createRes.json()) as { sandboxId: string };

        const res = await post('/sandbox/file/write', { sandboxId, content: 'hi' });
        expect(res.status).toBe(400);

        const data = (await res.json()) as Record<string, unknown>;
        expect(data).toHaveProperty('error');
    });

    // -------------------------------------------------------------------
    // 6. File list returns entries array
    // -------------------------------------------------------------------

    test('POST /sandbox/file/list returns entries array', async () => {
        skipIfNoWorker();
        if (!workerAvailable) return;

        const createRes = await post('/sandbox/create', {});
        const { sandboxId } = (await createRes.json()) as { sandboxId: string };

        const res = await post('/sandbox/file/list', { sandboxId, path: '/' });
        expect(res.status).toBe(200);

        const data = (await res.json()) as Record<string, unknown>;
        expect(data).toHaveProperty('entries');
        expect(Array.isArray(data.entries)).toBe(true);

        // Each entry should have name and type
        const entries = data.entries as Array<Record<string, unknown>>;
        for (const entry of entries) {
            expect(entry).toHaveProperty('name');
            expect(entry).toHaveProperty('type');
            expect(typeof entry.name).toBe('string');
            expect(['file', 'directory']).toContain(entry.type);
        }
    });

    test('POST /sandbox/file/list defaults to /workspace when no path given', async () => {
        skipIfNoWorker();
        if (!workerAvailable) return;

        const createRes = await post('/sandbox/create', {});
        const { sandboxId } = (await createRes.json()) as { sandboxId: string };

        // Omit path - should default to /workspace per Worker implementation
        const res = await post('/sandbox/file/list', { sandboxId });
        expect(res.status).toBe(200);

        const data = (await res.json()) as Record<string, unknown>;
        expect(data).toHaveProperty('entries');
        expect(Array.isArray(data.entries)).toBe(true);
    });

    // -------------------------------------------------------------------
    // 6b. File mkdir
    // -------------------------------------------------------------------

    test('POST /sandbox/file/mkdir creates a directory', async () => {
        skipIfNoWorker();
        if (!workerAvailable) return;

        const createRes = await post('/sandbox/create', {});
        const { sandboxId } = (await createRes.json()) as { sandboxId: string };

        const dirPath = `/tmp/scry-test-dir-${Date.now()}`;
        const res = await post('/sandbox/file/mkdir', { sandboxId, path: dirPath });
        expect(res.status).toBe(200);

        const data = (await res.json()) as Record<string, unknown>;
        expect(data).toHaveProperty('ok', true);
    });

    test('POST /sandbox/file/mkdir without path returns 400 error', async () => {
        skipIfNoWorker();
        if (!workerAvailable) return;

        const createRes = await post('/sandbox/create', {});
        const { sandboxId } = (await createRes.json()) as { sandboxId: string };

        const res = await post('/sandbox/file/mkdir', { sandboxId });
        expect(res.status).toBe(400);

        const data = (await res.json()) as Record<string, unknown>;
        expect(data).toHaveProperty('error');
    });

    // -------------------------------------------------------------------
    // 6c. Process start / kill
    // -------------------------------------------------------------------

    test('POST /sandbox/process/start returns processId or SDK error', async () => {
        skipIfNoWorker();
        if (!workerAvailable) return;

        const createRes = await post('/sandbox/create', {});
        const { sandboxId } = (await createRes.json()) as { sandboxId: string };

        const res = await post('/sandbox/process/start', {
            sandboxId,
            command: 'sleep 60',
        });

        const data = (await res.json()) as Record<string, unknown>;

        if (res.status === 200) {
            // Full SDK support -- validate response shape
            expect(data).toHaveProperty('processId');
            expect(data).toHaveProperty('command', 'sleep 60');

            // Clean up: kill the started process
            if (data.processId) {
                await post('/sandbox/process/kill', {
                    sandboxId,
                    processId: data.processId,
                });
            }
        } else {
            // Local wrangler dev may not support startProcess -- the Worker
            // catches the SDK error and returns 500 with an error field.
            expect(res.status).toBe(500);
            expect(data).toHaveProperty('error');
        }
    });

    test('POST /sandbox/process/start without command returns 400 error', async () => {
        skipIfNoWorker();
        if (!workerAvailable) return;

        const createRes = await post('/sandbox/create', {});
        const { sandboxId } = (await createRes.json()) as { sandboxId: string };

        const res = await post('/sandbox/process/start', { sandboxId });
        expect(res.status).toBe(400);

        const data = (await res.json()) as Record<string, unknown>;
        expect(data).toHaveProperty('error');
        expect((data.error as string).toLowerCase()).toContain('command');
    });

    test('POST /sandbox/process/kill without processId returns 400 error', async () => {
        skipIfNoWorker();
        if (!workerAvailable) return;

        const createRes = await post('/sandbox/create', {});
        const { sandboxId } = (await createRes.json()) as { sandboxId: string };

        const res = await post('/sandbox/process/kill', { sandboxId });
        expect(res.status).toBe(400);

        const data = (await res.json()) as Record<string, unknown>;
        expect(data).toHaveProperty('error');
        expect((data.error as string).toLowerCase()).toContain('processid');
    });

    // -------------------------------------------------------------------
    // 6d. Preview URL
    // -------------------------------------------------------------------

    test('POST /sandbox/preview-url returns 200 with previewUrl field', async () => {
        skipIfNoWorker();
        if (!workerAvailable) return;

        const createRes = await post('/sandbox/create', {});
        const { sandboxId } = (await createRes.json()) as { sandboxId: string };

        const res = await post('/sandbox/preview-url', { sandboxId, port: '3000' });
        expect(res.status).toBe(200);

        const data = (await res.json()) as Record<string, unknown>;
        // In local wrangler dev, getPreviewUrl may return undefined, yielding
        // { previewUrl: undefined } which serialises to {}. In production the
        // field is a non-empty URL string. Accept both.
        if ('previewUrl' in data && data.previewUrl != null) {
            expect(typeof data.previewUrl).toBe('string');
            expect((data.previewUrl as string).length).toBeGreaterThan(0);
        }
    });

    // -------------------------------------------------------------------
    // 7. Unknown route returns 404
    // -------------------------------------------------------------------

    test('POST to unknown sandbox route returns 404 with error', async () => {
        skipIfNoWorker();
        if (!workerAvailable) return;

        const res = await post('/sandbox/nonexistent', { sandboxId: 'any' });
        expect(res.status).toBe(404);

        const data = (await res.json()) as Record<string, unknown>;
        expect(data).toHaveProperty('error');
    });

    test('GET to unknown route returns 404', async () => {
        skipIfNoWorker();
        if (!workerAvailable) return;

        const res = await fetch(`${WORKER_URL}/does-not-exist`);
        expect(res.status).toBe(404);

        const data = (await res.json()) as Record<string, unknown>;
        expect(data).toHaveProperty('error');
    });

    // -------------------------------------------------------------------
    // 8. CORS headers present on responses
    // -------------------------------------------------------------------

    test('responses include CORS headers', async () => {
        skipIfNoWorker();
        if (!workerAvailable) return;

        const res = await fetch(`${WORKER_URL}/health`);
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
        expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
        expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
    });

    test('POST error responses also include CORS headers', async () => {
        skipIfNoWorker();
        if (!workerAvailable) return;

        const res = await post('/sandbox/exec', { command: 'echo hi' }); // missing sandboxId
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    // -------------------------------------------------------------------
    // 9. OPTIONS preflight returns 200
    // -------------------------------------------------------------------

    test('OPTIONS preflight returns 200 with CORS headers', async () => {
        skipIfNoWorker();
        if (!workerAvailable) return;

        const res = await fetch(`${WORKER_URL}/sandbox/exec`, {
            method: 'OPTIONS',
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
        expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
        expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
    });

    test('OPTIONS preflight on /health also returns 200', async () => {
        skipIfNoWorker();
        if (!workerAvailable) return;

        const res = await fetch(`${WORKER_URL}/health`, { method: 'OPTIONS' });
        expect(res.status).toBe(200);
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    // -------------------------------------------------------------------
    // 10. Missing sandboxId on various routes returns 400
    // -------------------------------------------------------------------

    test.each([
        '/sandbox/file/read',
        '/sandbox/file/write',
        '/sandbox/file/list',
        '/sandbox/file/mkdir',
        '/sandbox/process/start',
        '/sandbox/process/kill',
        '/sandbox/preview-url',
    ])('POST %s without sandboxId returns 400 error', async (path) => {
        skipIfNoWorker();
        if (!workerAvailable) return;

        const res = await post(path, { command: 'x', content: 'x', path: '/tmp' });
        expect(res.status).toBe(400);

        const data = (await res.json()) as Record<string, unknown>;
        expect(data).toHaveProperty('error');
        expect((data.error as string).toLowerCase()).toContain('sandboxid');
    });
});
