import { describe, expect, mock, test } from 'bun:test';

import type {
    TerminalCommandInput,
    TerminalCommandOutput,
} from '@onlook/code-provider';

import {
    createProviderInstallClient,
    type ProviderLike,
} from '../provider-install-client';

function makeProvider(
    output: string | Error,
    durationMs = 100,
): {
    provider: ProviderLike;
    calls: () => TerminalCommandInput[];
} {
    const calls: TerminalCommandInput[] = [];
    return {
        calls: () => calls,
        provider: {
            async runCommand(input): Promise<TerminalCommandOutput> {
                calls.push(input);
                if (output instanceof Error) throw output;
                // Fake delay for the client's now()-based timing.
                await new Promise((r) => setTimeout(r, 1));
                return { output };
                void durationMs;
            },
        },
    };
}

describe('createProviderInstallClient', () => {
    test('empty specifiers → ok=true, duration=0, no runCommand call', async () => {
        const { provider, calls } = makeProvider('');
        const client = createProviderInstallClient({ provider });
        const result = await client.install([]);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.durationMs).toBe(0);
        expect(calls().length).toBe(0);
    });

    test('pre-aborted signal short-circuits without runCommand', async () => {
        const { provider, calls } = makeProvider('');
        const client = createProviderInstallClient({
            provider,
            now: () => 100,
        });
        const controller = new AbortController();
        controller.abort();
        const result = await client.install(['lodash'], controller.signal);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toBe('aborted');
        expect(calls().length).toBe(0);
    });

    test('happy path: runCommand returns clean output → ok=true', async () => {
        const { provider, calls } = makeProvider('installed 3 packages in 1.2s');
        const client = createProviderInstallClient({ provider });
        const result = await client.install(['lodash']);
        expect(result.ok).toBe(true);
        expect(calls().length).toBe(1);
        expect(calls()[0]!.args.command).toContain('bun install');
        expect(calls()[0]!.args.command).toContain('/workspace');
    });

    test('sentinel __onlook_install_fail__ → ok=false', async () => {
        const { provider } = makeProvider(
            'ERR_SOMETHING\n__onlook_install_fail__',
        );
        const client = createProviderInstallClient({ provider });
        const result = await client.install(['lodash']);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
    });

    test('npm ERR! in output → ok=false (exit-0 false-positive guard)', async () => {
        // Some PMs surface error via exit-0 + ERR! prefix.
        const { provider } = makeProvider(
            'installing...\nnpm ERR! code E404\nnpm ERR! notarget No matching version\n',
        );
        const client = createProviderInstallClient({
            provider,
            packageManager: 'npm',
        });
        const result = await client.install(['nonexistent-pkg']);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('notarget');
    });

    test('yarn error in output → ok=false', async () => {
        const { provider } = makeProvider(
            'resolving packages...\nyarn error something bad\n',
        );
        const client = createProviderInstallClient({
            provider,
            packageManager: 'yarn',
        });
        const result = await client.install(['pkg']);
        expect(result.ok).toBe(false);
    });

    test('provider throw is caught → ok=false with error message', async () => {
        const { provider } = makeProvider(new Error('provider exploded'));
        const client = createProviderInstallClient({ provider });
        const result = await client.install(['lodash']);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toBe('provider exploded');
    });

    test('custom packageManager flows into command', async () => {
        const { provider, calls } = makeProvider('ok');
        const client = createProviderInstallClient({
            provider,
            packageManager: 'pnpm',
        });
        await client.install(['lodash']);
        expect(calls()[0]!.args.command).toContain('pnpm install');
    });

    test('custom cwd flows into command (shell-quoted)', async () => {
        const { provider, calls } = makeProvider('ok');
        const client = createProviderInstallClient({
            provider,
            cwd: '/home/user/app',
        });
        await client.install(['lodash']);
        expect(calls()[0]!.args.command).toContain(`'/home/user/app'`);
    });

    test('cwd containing single quote is escaped', async () => {
        const { provider, calls } = makeProvider('ok');
        const client = createProviderInstallClient({
            provider,
            cwd: `/home/o'connor/app`,
        });
        await client.install(['lodash']);
        // Single quote is wrapped as '\''  inside single-quoted string.
        expect(calls()[0]!.args.command).toContain(`'/home/o'\\''connor/app'`);
    });

    test('duration tracked via now()', async () => {
        const { provider } = makeProvider('ok');
        let t = 0;
        const client = createProviderInstallClient({
            provider,
            now: () => {
                t += 50;
                return t;
            },
        });
        const result = await client.install(['lodash']);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.durationMs).toBe(50);
    });
});
