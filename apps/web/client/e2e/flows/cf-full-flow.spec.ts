import { describe, test, expect, beforeAll } from 'bun:test';

const WORKER_URL = 'http://localhost:8787';
let workerAvailable = false;

async function workerFetch<T = any>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${WORKER_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return res.json() as Promise<T>;
}

beforeAll(async () => {
    try {
        const res = await fetch(`${WORKER_URL}/health`, { signal: AbortSignal.timeout(2000) });
        workerAvailable = res.ok;
    } catch { workerAvailable = false; }
    if (!workerAvailable) console.log('⚠ Worker not running, skipping CF flow tests');
});

describe('CF Sandbox Full Flow', () => {
    const sandboxId = `cf-flow-test-${Date.now()}`;

    test('1. Create sandbox', async () => {
        if (!workerAvailable) return;
        const r = await workerFetch('/sandbox/create', { id: sandboxId });
        expect(r.sandboxId).toBe(sandboxId);
        expect(r.ready).toBe(true);
    });

    test('2. Execute command', async () => {
        if (!workerAvailable) return;
        const r = await workerFetch('/sandbox/exec', { sandboxId, command: 'node --version' });
        expect(r.success).toBe(true);
        expect(r.stdout).toContain('v20');
    });

    test('3. Write file', async () => {
        if (!workerAvailable) return;
        const r = await workerFetch('/sandbox/file/write', { sandboxId, path: '/workspace/test.txt', content: 'hello cloudflare' });
        expect(r.ok).toBe(true);
    });

    test('4. Read file', async () => {
        if (!workerAvailable) return;
        const r = await workerFetch('/sandbox/file/read', { sandboxId, path: '/workspace/test.txt' });
        expect(r.content).toBe('hello cloudflare');
    });

    test('5. List files', async () => {
        if (!workerAvailable) return;
        const r = await workerFetch('/sandbox/file/list', { sandboxId, path: '/workspace' });
        expect(r.entries).toBeInstanceOf(Array);
        const names = r.entries.map((e: any) => e.name);
        expect(names).toContain('test.txt');
    });

    test('6. Create directory', async () => {
        if (!workerAvailable) return;
        await workerFetch('/sandbox/exec', { sandboxId, command: 'mkdir -p /workspace/mydir' });
        const r = await workerFetch('/sandbox/file/list', { sandboxId, path: '/workspace' });
        expect(r.entries.some((e: any) => e.name === 'mydir' && e.type === 'directory')).toBe(true);
    });

    test('7. Scaffold project', async () => {
        if (!workerAvailable) return;
        await workerFetch('/sandbox/exec', { sandboxId, command: 'mkdir -p /workspace/app && cd /workspace/app && npm init -y' });
        const r = await workerFetch('/sandbox/file/list', { sandboxId, path: '/workspace/app' });
        expect(r.entries.some((e: any) => e.name === 'package.json')).toBe(true);
    });

    test('8. Sandbox isolation', async () => {
        if (!workerAvailable) return;
        const other = `cf-isolated-${Date.now()}`;
        await workerFetch('/sandbox/create', { id: other });
        await workerFetch('/sandbox/file/write', { sandboxId: other, path: '/workspace/only-here.txt', content: 'isolated' });
        const r = await workerFetch('/sandbox/exec', { sandboxId, command: 'test -f /workspace/only-here.txt && echo exists || echo missing' });
        expect(r.stdout.trim()).toBe('missing');
    });

    test('9. Error handling - missing sandbox', async () => {
        if (!workerAvailable) return;
        const r = await workerFetch('/sandbox/exec', { sandboxId: 'nonexistent', command: 'echo hi' });
        // Should error or timeout, not crash
        expect(r).toBeDefined();
    });

    test('10. Ping via exec', async () => {
        if (!workerAvailable) return;
        const r = await workerFetch('/sandbox/exec', { sandboxId, command: 'echo pong' });
        expect(r.stdout.trim()).toBe('pong');
        expect(r.success).toBe(true);
    });
});
