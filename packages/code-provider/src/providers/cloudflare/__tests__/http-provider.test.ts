/**
 * Unit tests for CloudflareSandboxProvider (HTTP-based).
 *
 * All Worker communication is mocked via globalThis.fetch so no real
 * network requests are made.
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { CloudflareSandboxProvider } from '../index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORKER_URL = 'http://localhost:8787';
const SANDBOX_ID = 'test-sandbox-123';

function makeProvider(): CloudflareSandboxProvider {
    return new CloudflareSandboxProvider({
        workerUrl: WORKER_URL,
        sandboxId: SANDBOX_ID,
    });
}

/** Build a successful exec-style JSON response. */
function execResponse(
    stdout = '',
    stderr = '',
    exitCode = 0,
    success = true,
): Response {
    return new Response(JSON.stringify({ stdout, stderr, exitCode, success }));
}

/** Build an arbitrary JSON response body. */
function jsonResponse(body: Record<string, unknown>): Response {
    return new Response(JSON.stringify(body));
}

/** Build an error JSON response (Worker-level error field). */
function errorResponse(message: string): Response {
    return new Response(JSON.stringify({ error: message }));
}

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const mockFetch = mock(() => Promise.resolve(execResponse()));

beforeEach(() => {
    globalThis.fetch = mockFetch as any;
    mockFetch.mockClear();
});

/** Extract the parsed JSON body from the Nth fetch call (0-indexed). */
function fetchBody(callIndex = 0): Record<string, unknown> {
    const call = mockFetch.mock.calls[callIndex];
    const bodyStr = (call as any)[1]?.body as string;
    return JSON.parse(bodyStr);
}

/** Extract the URL string from the Nth fetch call. */
function fetchUrl(callIndex = 0): string {
    return (mockFetch.mock.calls[callIndex] as any)[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CloudflareSandboxProvider', () => {
    // 1. initialize
    describe('initialize', () => {
        test('calls exec with echo init-ok on success', async () => {
            mockFetch.mockImplementationOnce(() =>
                Promise.resolve(execResponse('init-ok\n')),
            );
            const provider = makeProvider();
            const result = await provider.initialize({});

            expect(result).toEqual({});
            expect(mockFetch).toHaveBeenCalledTimes(1);
            expect(fetchUrl()).toBe(`${WORKER_URL}/sandbox/exec`);

            const body = fetchBody();
            expect(body.sandboxId).toBe(SANDBOX_ID);
            expect(body.command).toBe('echo "init-ok"');
        });

        test('does not throw when exec fails during init', async () => {
            mockFetch.mockImplementationOnce(() =>
                Promise.resolve(errorResponse('sandbox not found')),
            );
            const provider = makeProvider();
            // Should resolve without throwing
            const result = await provider.initialize({});
            expect(result).toEqual({});
        });

        test('skips exec when sandboxId is empty', async () => {
            const provider = new CloudflareSandboxProvider({
                workerUrl: WORKER_URL,
                sandboxId: '',
            });
            const result = await provider.initialize({});
            expect(result).toEqual({});
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    // 2. ping
    describe('ping', () => {
        test('returns true on successful exec', async () => {
            mockFetch.mockImplementationOnce(() =>
                Promise.resolve(execResponse('ping\n', '', 0, true)),
            );
            const provider = makeProvider();
            const result = await provider.ping();

            expect(result).toBe(true);
            expect(fetchBody().command).toBe('echo "ping"');
        });

        test('returns false when exec throws', async () => {
            mockFetch.mockImplementationOnce(() =>
                Promise.reject(new Error('network down')),
            );
            const provider = makeProvider();
            const result = await provider.ping();
            expect(result).toBe(false);
        });

        test('returns false when Worker returns error', async () => {
            mockFetch.mockImplementationOnce(() =>
                Promise.resolve(errorResponse('timeout')),
            );
            const provider = makeProvider();
            const result = await provider.ping();
            expect(result).toBe(false);
        });
    });

    // 3. readFile
    describe('readFile', () => {
        test('calls /sandbox/file/read and returns content', async () => {
            mockFetch.mockImplementationOnce(() =>
                Promise.resolve(jsonResponse({ content: 'hello world' })),
            );
            const provider = makeProvider();
            const result = await provider.readFile({
                args: { path: '/workspace/app.tsx' },
            });

            expect(result).toEqual({ content: 'hello world' });
            expect(fetchUrl()).toBe(`${WORKER_URL}/sandbox/file/read`);

            const body = fetchBody();
            expect(body.sandboxId).toBe(SANDBOX_ID);
            expect(body.path).toBe('/workspace/app.tsx');
        });
    });

    // 4. writeFile
    describe('writeFile', () => {
        test('calls /sandbox/file/write with path and content', async () => {
            mockFetch.mockImplementationOnce(() =>
                Promise.resolve(jsonResponse({})),
            );
            const provider = makeProvider();
            const result = await provider.writeFile({
                args: { path: '/workspace/index.ts', content: 'const x = 1;' },
            });

            expect(result).toEqual({});
            expect(fetchUrl()).toBe(`${WORKER_URL}/sandbox/file/write`);

            const body = fetchBody();
            expect(body.sandboxId).toBe(SANDBOX_ID);
            expect(body.path).toBe('/workspace/index.ts');
            expect(body.content).toBe('const x = 1;');
        });
    });

    // 5. listFiles
    describe('listFiles', () => {
        test('calls /sandbox/file/list and maps entries', async () => {
            mockFetch.mockImplementationOnce(() =>
                Promise.resolve(
                    jsonResponse({
                        entries: [
                            { name: 'app.tsx', type: 'file' },
                            { name: 'components', type: 'directory' },
                        ],
                    }),
                ),
            );
            const provider = makeProvider();
            const result = await provider.listFiles({
                args: { path: '/workspace' },
            });

            expect(fetchUrl()).toBe(`${WORKER_URL}/sandbox/file/list`);
            expect(fetchBody().path).toBe('/workspace');
            expect(result.files).toEqual([
                { path: '/workspace/app.tsx', type: 'file' },
                { path: '/workspace/components', type: 'directory' },
            ]);
        });

        test('returns empty array when no entries', async () => {
            mockFetch.mockImplementationOnce(() =>
                Promise.resolve(jsonResponse({ entries: [] })),
            );
            const provider = makeProvider();
            const result = await provider.listFiles({
                args: { path: '/empty' },
            });
            expect(result.files).toEqual([]);
        });
    });

    // 6. deleteFiles
    describe('deleteFiles', () => {
        test('calls exec with rm -rf for each path', async () => {
            const provider = makeProvider();
            const result = await provider.deleteFiles({
                args: { paths: ['/workspace/old.ts', '/workspace/tmp'] } as any,
            });

            expect(result).toEqual({});
            expect(mockFetch).toHaveBeenCalledTimes(2);

            const body0 = fetchBody(0);
            expect(body0.command).toBe('rm -rf "/workspace/old.ts"');

            const body1 = fetchBody(1);
            expect(body1.command).toBe('rm -rf "/workspace/tmp"');
        });
    });

    // 7. createDirectory
    describe('createDirectory', () => {
        test('calls exec with mkdir -p', async () => {
            const provider = makeProvider();
            const result = await provider.createDirectory({
                args: { path: '/workspace/src/components' },
            });

            expect(result).toEqual({});
            expect(fetchUrl()).toBe(`${WORKER_URL}/sandbox/exec`);
            expect(fetchBody().command).toBe(
                'mkdir -p "/workspace/src/components"',
            );
        });
    });

    // 8. runCommand
    describe('runCommand', () => {
        test('calls /sandbox/exec and returns stdout+stderr', async () => {
            mockFetch.mockImplementationOnce(() =>
                Promise.resolve(execResponse('build ok\n', 'warn: unused\n')),
            );
            const provider = makeProvider();
            const result = await provider.runCommand({
                args: { command: 'bun run build' },
            });

            expect(result.output).toBe('build ok\nwarn: unused\n');
            expect(fetchUrl()).toBe(`${WORKER_URL}/sandbox/exec`);
            expect(fetchBody().command).toBe('bun run build');
        });

        test('returns empty output on clean execution', async () => {
            mockFetch.mockImplementationOnce(() =>
                Promise.resolve(execResponse('', '')),
            );
            const provider = makeProvider();
            const result = await provider.runCommand({
                args: { command: 'true' },
            });
            expect(result.output).toBe('');
        });
    });

    // 9. createTerminal
    describe('createTerminal', () => {
        test('returns a terminal with expected methods', async () => {
            const provider = makeProvider();
            const { terminal } = await provider.createTerminal({
                args: { id: 'my-term' },
            } as any);

            expect(terminal.id).toBe('my-term');
            expect(terminal.name).toBe('cf-terminal-my-term');
            expect(typeof terminal.open).toBe('function');
            expect(typeof terminal.write).toBe('function');
            expect(typeof terminal.run).toBe('function');
            expect(typeof terminal.kill).toBe('function');
            expect(typeof terminal.onOutput).toBe('function');
        });

        test('terminal.write calls exec and fires output callback', async () => {
            mockFetch.mockImplementation(() =>
                Promise.resolve(execResponse('output line', '')),
            );
            const provider = makeProvider();
            const { terminal } = await provider.createTerminal({
                args: { id: 't1' },
            } as any);

            const received: string[] = [];
            terminal.onOutput((data) => received.push(data));

            await terminal.write('ls -la');
            expect(received).toEqual(['output line']);
            expect(fetchBody(0).command).toBe('ls -la');
        });

        test('terminal.run calls exec and fires output callback', async () => {
            mockFetch.mockImplementation(() =>
                Promise.resolve(execResponse('run result', 'run err')),
            );
            const provider = makeProvider();
            const { terminal } = await provider.createTerminal({
                args: { id: 't2' },
            } as any);

            const received: string[] = [];
            terminal.onOutput((data) => received.push(data));

            await terminal.run('npm test');
            expect(received).toEqual(['run resultrun err']);
        });

        test('uses default id when none provided', async () => {
            const provider = makeProvider();
            const { terminal } = await provider.createTerminal({} as any);
            expect(terminal.id).toBe('default');
        });
    });

    // 10. getTask
    describe('getTask', () => {
        test('returns a task with open/run/stop methods', async () => {
            const provider = makeProvider();
            const { task } = await provider.getTask({
                args: { id: 'dev' },
            });

            expect(task.id).toBe('dev');
            expect(task.name).toBe('dev');
            expect(task.command).toBe('dev');
            expect(typeof task.open).toBe('function');
            expect(typeof task.run).toBe('function');
            expect(typeof task.restart).toBe('function');
            expect(typeof task.stop).toBe('function');
            expect(typeof task.onOutput).toBe('function');
        });

        test('task.run calls exec and fires output', async () => {
            mockFetch.mockImplementation(() =>
                Promise.resolve(execResponse('Task dev started\n', '')),
            );
            const provider = makeProvider();
            const { task } = await provider.getTask({ args: { id: 'dev' } });

            const received: string[] = [];
            task.onOutput((data) => received.push(data));

            await task.run();
            expect(received.length).toBeGreaterThan(0);
            expect(received[0]).toContain('Task dev started');
        });

        test('uses default id when none provided', async () => {
            const provider = makeProvider();
            const { task } = await provider.getTask({} as any);
            expect(task.id).toBe('dev');
        });
    });

    // 11. statFile
    describe('statFile', () => {
        test('parses stat JSON for a regular file', async () => {
            mockFetch.mockImplementationOnce(() =>
                Promise.resolve(
                    execResponse('{"size":1024,"isDir":"regular file"}\n'),
                ),
            );
            const provider = makeProvider();
            const result = await provider.statFile({
                args: { path: '/workspace/index.ts' },
            });

            expect(result.stat).toEqual({
                size: 1024,
                isDirectory: false,
            });

            const body = fetchBody();
            expect(body.command).toContain('stat');
            expect(body.command).toContain('/workspace/index.ts');
        });

        test('parses stat JSON for a directory', async () => {
            mockFetch.mockImplementationOnce(() =>
                Promise.resolve(
                    execResponse('{"size":4096,"isDir":"directory"}\n'),
                ),
            );
            const provider = makeProvider();
            const result = await provider.statFile({
                args: { path: '/workspace/src' },
            });

            expect(result.stat).toEqual({
                size: 4096,
                isDirectory: true,
            });
        });

        test('returns null stat when file does not exist', async () => {
            mockFetch.mockImplementationOnce(() =>
                Promise.resolve(execResponse('{"error":true}\n')),
            );
            const provider = makeProvider();
            const result = await provider.statFile({
                args: { path: '/workspace/missing.ts' },
            });

            expect(result.stat).toBeNull();
        });

        test('returns null stat on unparseable output', async () => {
            mockFetch.mockImplementationOnce(() =>
                Promise.resolve(execResponse('not json')),
            );
            const provider = makeProvider();
            const result = await provider.statFile({
                args: { path: '/workspace/bad' },
            });

            expect(result.stat).toBeNull();
        });
    });

    // 12. Additional coverage: destroy, renameFile, gitStatus
    describe('destroy', () => {
        test('clears sandboxId', async () => {
            const provider = makeProvider();
            await provider.destroy();
            // After destroy, ping should not send sandboxId
            mockFetch.mockImplementationOnce(() =>
                Promise.resolve(execResponse('ping\n', '', 0, true)),
            );
            await provider.ping();
            expect(fetchBody().sandboxId).toBe('');
        });
    });

    describe('renameFile', () => {
        test('calls exec with mv command', async () => {
            const provider = makeProvider();
            await provider.renameFile({
                args: { oldPath: '/workspace/a.ts', newPath: '/workspace/b.ts' },
            });

            expect(fetchBody().command).toBe(
                'mv "/workspace/a.ts" "/workspace/b.ts"',
            );
        });
    });

    describe('gitStatus', () => {
        test('returns changed files from git diff output', async () => {
            mockFetch.mockImplementationOnce(() =>
                Promise.resolve(
                    execResponse('src/app.tsx\nsrc/index.ts\n'),
                ),
            );
            const provider = makeProvider();
            const result = await provider.gitStatus({});

            expect(result.changedFiles).toEqual([
                'src/app.tsx',
                'src/index.ts',
            ]);
        });

        test('returns empty array when no changes', async () => {
            mockFetch.mockImplementationOnce(() =>
                Promise.resolve(execResponse('')),
            );
            const provider = makeProvider();
            const result = await provider.gitStatus({});
            expect(result.changedFiles).toEqual([]);
        });
    });

    describe('workerFetch error handling', () => {
        test('throws when Worker returns an error field', async () => {
            mockFetch.mockImplementationOnce(() =>
                Promise.resolve(errorResponse('sandbox expired')),
            );
            const provider = makeProvider();
            await expect(
                provider.readFile({ args: { path: '/fail' } }),
            ).rejects.toThrow('sandbox expired');
        });
    });
});
