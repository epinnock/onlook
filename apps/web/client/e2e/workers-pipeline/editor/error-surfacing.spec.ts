/**
 * workers-pipeline editor — error-surfacing.
 *
 * Asserts the editor-side error contract: preflight rejections and esbuild
 * build failures must surface with a clear file-scoped message, and an
 * invalid build must NOT trigger a /push call (the fake relay records all
 * requests — empty means we correctly short-circuited).
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { expect, test } from '@playwright/test';

import { DEFAULT_BASE_EXTERNALS } from '../helpers/browser-bundler-harness';
import {
    preflightUnsupportedImports,
    assertNoUnsupportedImports,
} from '../../../../../../packages/browser-bundler/src/preflight';
import { pushOverlay } from '../../../../../../apps/web/client/src/services/expo-relay/push-overlay';

async function startRecordingRelay(): Promise<{ baseUrl: string; pushes: string[]; close(): Promise<void> }> {
    const pushes: string[] = [];
    const server = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url?.startsWith('/push/')) {
            const chunks: Buffer[] = [];
            req.on('data', (c) => chunks.push(c as Buffer));
            req.on('end', () => {
                pushes.push(Buffer.concat(chunks).toString('utf8'));
                res.writeHead(202, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ delivered: 0 }));
            });
            return;
        }
        res.writeHead(404);
        res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    return {
        baseUrl: `http://127.0.0.1:${port}`,
        pushes,
        close: () => new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r()))),
    };
}

test.describe('workers-pipeline editor — error surfacing', () => {
    test('preflight errors include the offending file path and specifier', () => {
        const issues = preflightUnsupportedImports({
            files: {
                '/src/App.tsx': [
                    "import { foo } from 'some-not-base-lib';",
                    "export default function App() { return null; }",
                ].join('\n'),
            },
            externalSpecifiers: DEFAULT_BASE_EXTERNALS,
        });

        expect(issues).toHaveLength(1);
        expect(issues[0]!.filePath).toBe('/src/App.tsx');
        expect(issues[0]!.specifier).toBe('some-not-base-lib');
        expect(issues[0]!.message).toMatch(/Unsupported bare import.*some-not-base-lib/);
    });

    test('preflight throw path aggregates multiple issues into one message', () => {
        expect(() =>
            assertNoUnsupportedImports({
                files: {
                    '/App.tsx': "import 'lodash'; import 'moment';",
                    '/other.tsx': "import 'dayjs';",
                },
                externalSpecifiers: DEFAULT_BASE_EXTERNALS,
            }),
        ).toThrow(/Unsupported imports found:[\s\S]*lodash[\s\S]*moment[\s\S]*dayjs/);
    });

    test('a preflight failure short-circuits before any /push call', async () => {
        const relay = await startRecordingRelay();
        try {
            // Editor-side guard: if preflight throws, don't push. This is the
            // contract the editor's build pipeline should honor.
            let pushed = false;
            try {
                assertNoUnsupportedImports({
                    files: { '/App.tsx': "import 'lodash';" },
                    externalSpecifiers: DEFAULT_BASE_EXTERNALS,
                });
                await pushOverlay({
                    relayBaseUrl: relay.baseUrl,
                    sessionId: 'err-test',
                    overlay: { code: 'noop' },
                });
                pushed = true;
            } catch {
                // expected
            }

            expect(pushed).toBe(false);
            expect(relay.pushes).toHaveLength(0);
        } finally {
            await relay.close();
        }
    });

    test('pushOverlay refuses empty overlay bodies with a clear error', async () => {
        const relay = await startRecordingRelay();
        try {
            const result = await pushOverlay({
                relayBaseUrl: relay.baseUrl,
                sessionId: 'err',
                overlay: { code: '' },
            });
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error).toMatch(/empty/);
            expect(relay.pushes).toHaveLength(0);
        } finally {
            await relay.close();
        }
    });

    test('pushOverlay surfaces 4xx relay errors without retrying', async () => {
        const server = http.createServer((req, res) => {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('invalid overlay');
        });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        const port = (server.address() as AddressInfo).port;

        try {
            const result = await pushOverlay({
                relayBaseUrl: `http://127.0.0.1:${port}`,
                sessionId: 'sess',
                overlay: { code: 'x' },
                retryBaseMs: 0,
            });
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.status).toBe(400);
            expect(result.attempts).toBe(1);
        } finally {
            await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
        }
    });
});
