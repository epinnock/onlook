import { describe, expect, mock, test } from 'bun:test';

import {
    installDependencies,
    type DependencyInstallStatus,
    type SandboxInstallClient,
    type SandboxInstallResult,
} from '../dependency-install';
import {
    diffPackageDependencies,
    type DependencyDiff,
} from '../package-json-diff';

const mkPkg = (deps: Record<string, string>) =>
    JSON.stringify({ name: 'app', dependencies: deps });

function makeClient(
    responses: Array<SandboxInstallResult | Error>,
): {
    client: SandboxInstallClient;
    calls: () => Array<{ specifiers: readonly string[]; signal?: AbortSignal }>;
} {
    const calls: Array<{
        specifiers: readonly string[];
        signal?: AbortSignal;
    }> = [];
    let idx = 0;
    return {
        calls: () => calls,
        client: {
            async install(specifiers, signal) {
                calls.push({ specifiers, signal });
                const response = responses[Math.min(idx, responses.length - 1)]!;
                idx += 1;
                if (response instanceof Error) throw response;
                return response;
            },
        },
    };
}

const emptyDiff: DependencyDiff = {
    added: {},
    removed: {},
    changed: {},
    unchanged: { existing: '^1' },
};

describe('installDependencies', () => {
    test('empty diff → idle status, no client call', async () => {
        const { client, calls } = makeClient([]);
        const statuses: DependencyInstallStatus[] = [];
        const result = await installDependencies({
            diff: emptyDiff,
            client,
            onStatus: (s) => statuses.push(s),
        });
        expect(result.kind).toBe('idle');
        expect(statuses).toEqual([{ kind: 'idle' }]);
        expect(calls().length).toBe(0);
    });

    test('happy path: installing → ready', async () => {
        const diff = diffPackageDependencies(null, mkPkg({ lodash: '^4' }));
        const { client, calls } = makeClient([
            { ok: true, durationMs: 42 },
        ]);
        const statuses: DependencyInstallStatus[] = [];
        const result = await installDependencies({
            diff,
            client,
            onStatus: (s) => statuses.push(s),
        });
        expect(statuses.map((s) => s.kind)).toEqual([
            'installing',
            'ready',
        ]);
        expect(result.kind).toBe('ready');
        if (result.kind === 'ready') {
            expect(result.durationMs).toBe(42);
            expect(result.retryCount).toBe(0);
            expect(result.specifiers).toEqual(['lodash']);
        }
        expect(calls().length).toBe(1);
        expect(calls()[0]!.specifiers).toEqual(['lodash']);
    });

    test('retries once on transient failure', async () => {
        const diff = diffPackageDependencies(null, mkPkg({ a: '^1' }));
        const { client, calls } = makeClient([
            { ok: false, error: 'network error', durationMs: 10 },
            { ok: true, durationMs: 50 },
        ]);
        const result = await installDependencies({ diff, client });
        expect(result.kind).toBe('ready');
        if (result.kind === 'ready') {
            expect(result.retryCount).toBe(1);
            expect(result.durationMs).toBe(60); // accumulated
        }
        expect(calls().length).toBe(2);
    });

    test('fails after retries exhausted', async () => {
        const diff = diffPackageDependencies(null, mkPkg({ a: '^1' }));
        const { client, calls } = makeClient([
            { ok: false, error: 'err1', durationMs: 10 },
            { ok: false, error: 'err2', durationMs: 10 },
        ]);
        const result = await installDependencies({
            diff,
            client,
            maxRetries: 1,
        });
        expect(result.kind).toBe('failed');
        if (result.kind === 'failed') {
            expect(result.error).toBe('err2');
            expect(result.retryCount).toBe(1);
        }
        expect(calls().length).toBe(2);
    });

    test('maxRetries: 0 disables retry', async () => {
        const diff = diffPackageDependencies(null, mkPkg({ a: '^1' }));
        const { client, calls } = makeClient([
            { ok: false, error: 'once-and-done', durationMs: 10 },
        ]);
        const result = await installDependencies({
            diff,
            client,
            maxRetries: 0,
        });
        expect(result.kind).toBe('failed');
        if (result.kind === 'failed') {
            expect(result.error).toBe('once-and-done');
            expect(result.retryCount).toBe(0);
        }
        expect(calls().length).toBe(1);
    });

    test('client throw is caught + retried', async () => {
        const diff = diffPackageDependencies(null, mkPkg({ a: '^1' }));
        const { client, calls } = makeClient([
            new Error('kaboom'),
            { ok: true, durationMs: 50 },
        ]);
        const result = await installDependencies({ diff, client });
        expect(result.kind).toBe('ready');
        expect(calls().length).toBe(2);
    });

    test('pre-aborted signal: short-circuits to failed/aborted', async () => {
        const diff = diffPackageDependencies(null, mkPkg({ a: '^1' }));
        const { client, calls } = makeClient([{ ok: true, durationMs: 10 }]);
        const controller = new AbortController();
        controller.abort();
        const result = await installDependencies({
            diff,
            client,
            signal: controller.signal,
        });
        expect(result.kind).toBe('failed');
        if (result.kind === 'failed') {
            expect(result.error).toBe('aborted');
        }
        expect(calls().length).toBe(0);
    });

    test('signal forwarded to client.install', async () => {
        const diff = diffPackageDependencies(null, mkPkg({ a: '^1' }));
        const { client, calls } = makeClient([{ ok: true, durationMs: 10 }]);
        const controller = new AbortController();
        await installDependencies({
            diff,
            client,
            signal: controller.signal,
        });
        expect(calls()[0]!.signal).toBe(controller.signal);
    });

    test('specifiers passed to client match listChangedSpecifiers', async () => {
        const diff = diffPackageDependencies(
            mkPkg({ kept: '^1', removed: '^1', bumped: '^1' }),
            mkPkg({ kept: '^1', bumped: '^2', added: '^1' }),
        );
        const { client, calls } = makeClient([{ ok: true, durationMs: 10 }]);
        await installDependencies({ diff, client });
        expect(calls()[0]!.specifiers).toEqual(['added', 'bumped', 'removed']);
    });

    test('onStatus consumer errors are swallowed', async () => {
        const diff = diffPackageDependencies(null, mkPkg({ a: '^1' }));
        const { client } = makeClient([{ ok: true, durationMs: 10 }]);
        const badHandler = mock(() => {
            throw new Error('consumer explodes');
        });
        const result = await installDependencies({
            diff,
            client,
            onStatus: badHandler,
        });
        expect(result.kind).toBe('ready');
        expect(badHandler).toHaveBeenCalled();
    });
});
