/**
 * ExpoBrowserProvider integration smoke test.
 *
 * Exercises the wired provider against the live local Supabase instance
 * (http://127.0.0.1:54321 + the 'expo-projects' bucket created in setup).
 *
 * Skipped automatically when local Supabase is unreachable so this file
 * doesn't break the unit-test suite for developers without the backend
 * running. CI runs `bun --filter @onlook/backend start` first.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { ExpoBrowserProvider } from '../index';
import { intercept } from '../utils/run-command';

const SUPABASE_URL = 'http://127.0.0.1:54321';
// Local-only anon key, well-known + safe to commit. Identical to the
// 'sb_publishable_*' value emitted by `supabase status` for any local
// supabase instance — never grants access to anything beyond local Docker.
const LOCAL_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const LOCAL_SERVICE_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

let supabaseAvailable = false;
beforeAll(async () => {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
            headers: { apikey: LOCAL_ANON_KEY },
        });
        supabaseAvailable = res.ok;
    } catch {
        supabaseAvailable = false;
    }
});

const PROJECT_ID = '00000000-0000-0000-0000-000000000001';
const BRANCH_ID = '00000000-0000-0000-0000-000000000abc';

async function cleanupBranch() {
    // Best-effort cleanup of any objects this test wrote so re-runs don't
    // accumulate. Uses the service key for unrestricted delete.
    try {
        const list = await fetch(
            `${SUPABASE_URL}/storage/v1/object/list/expo-projects`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    apikey: LOCAL_SERVICE_KEY,
                    Authorization: `Bearer ${LOCAL_SERVICE_KEY}`,
                },
                body: JSON.stringify({ prefix: `${PROJECT_ID}/${BRANCH_ID}`, limit: 1000 }),
            },
        );
        if (!list.ok) return;
        const entries = (await list.json()) as Array<{ name: string }>;
        if (entries.length === 0) return;
        await fetch(`${SUPABASE_URL}/storage/v1/object/expo-projects`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                apikey: LOCAL_SERVICE_KEY,
                Authorization: `Bearer ${LOCAL_SERVICE_KEY}`,
            },
            body: JSON.stringify({
                prefixes: entries.map((e) => `${PROJECT_ID}/${BRANCH_ID}/${e.name}`),
            }),
        });
    } catch {
        // ignored
    }
}

afterAll(async () => {
    if (supabaseAvailable) await cleanupBranch();
});

describe('ExpoBrowserProvider', () => {
    it('initializes against local Supabase', async () => {
        if (!supabaseAvailable) return; // skip
        const provider = new ExpoBrowserProvider({
            projectId: PROJECT_ID,
            branchId: BRANCH_ID,
            supabaseUrl: SUPABASE_URL,
            supabaseAnonKey: LOCAL_SERVICE_KEY,
        });
        await provider.initialize({});
        expect(await provider.ping()).toBe(true);
        await provider.destroy();
    });

    it('writeFile + readFile round-trip', async () => {
        if (!supabaseAvailable) return;
        const provider = new ExpoBrowserProvider({
            projectId: PROJECT_ID,
            branchId: BRANCH_ID,
            supabaseUrl: SUPABASE_URL,
            supabaseAnonKey: LOCAL_SERVICE_KEY,
        });
        await provider.initialize({});

        await provider.writeFile({
            args: { path: 'src/App.tsx', content: 'export default function App(){return null}' },
        });
        const result = await provider.readFile({ args: { path: 'src/App.tsx' } });
        expect(result.file.content).toContain('App');
        expect(result.file.toString()).toContain('return null');

        await provider.destroy();
    });

    it('listFiles surfaces written entries', async () => {
        if (!supabaseAvailable) return;
        const provider = new ExpoBrowserProvider({
            projectId: PROJECT_ID,
            branchId: BRANCH_ID,
            supabaseUrl: SUPABASE_URL,
            supabaseAnonKey: LOCAL_SERVICE_KEY,
        });
        await provider.initialize({});

        await provider.writeFile({ args: { path: 'src/index.ts', content: '// hi' } });
        const list = await provider.listFiles({ args: { path: 'src' } });
        const names = list.files.map((f) => f.name);
        expect(names).toContain('index.ts');

        await provider.destroy();
    });

    it('runCommand routes through the narrow interceptor', async () => {
        if (!supabaseAvailable) return;
        const provider = new ExpoBrowserProvider({
            projectId: PROJECT_ID,
            branchId: BRANCH_ID,
            supabaseUrl: SUPABASE_URL,
            supabaseAnonKey: LOCAL_SERVICE_KEY,
        });
        await provider.initialize({});

        // Seed a package.json the interceptor can read.
        await provider.writeFile({
            args: { path: 'package.json', content: '{"dependencies":{}}' },
        });

        const installResult = await provider.runCommand({
            args: { command: 'npm install react-native-paper' },
        });
        expect(installResult.output).toContain('added 1 package');

        const after = await provider.readFile({ args: { path: 'package.json' } });
        expect(after.file.toString()).toContain('react-native-paper');

        const noShellResult = await provider.runCommand({
            args: { command: 'cat /etc/passwd' },
        });
        expect(noShellResult.output).toContain('PROVIDER_NO_SHELL');

        await provider.destroy();
    });

    it('getCapabilities reflects no-shell mode', () => {
        const provider = new ExpoBrowserProvider({
            projectId: PROJECT_ID,
            branchId: BRANCH_ID,
            supabaseUrl: SUPABASE_URL,
            supabaseAnonKey: LOCAL_ANON_KEY,
        });
        const caps = provider.getCapabilities();
        expect(caps.supportsTerminal).toBe(false);
        expect(caps.supportsShell).toBe(false);
        expect(caps.supportsHibernate).toBe(false);
    });
});

// -- pure unit tests for the interceptor that don't need Supabase ---------

describe('intercept (interceptor pure unit tests)', () => {
    function makeCtx(initialPkgJson = '{"dependencies":{}}') {
        let pkgJsonContent = initialPkgJson;
        let bundleCalls = 0;
        return {
            ctx: {
                readPackageJson: async () => pkgJsonContent,
                writePackageJson: async (content: string) => {
                    pkgJsonContent = content;
                },
                triggerBundle: async () => {
                    bundleCalls++;
                },
            },
            getPkg: () => pkgJsonContent,
            getBundleCalls: () => bundleCalls,
        };
    }

    it('npm install adds a single package', async () => {
        const harness = makeCtx();
        const result = await intercept(
            { args: { command: 'npm install react-native-paper' } },
            harness.ctx,
        );
        expect(result.output).toContain('added 1 package');
        expect(JSON.parse(harness.getPkg()).dependencies['react-native-paper']).toBe('latest');
    });

    it('bun add with version pin', async () => {
        const harness = makeCtx();
        await intercept(
            { args: { command: 'bun add react@19.0.0 react-dom@19.0.0' } },
            harness.ctx,
        );
        const pkg = JSON.parse(harness.getPkg());
        expect(pkg.dependencies.react).toBe('19.0.0');
        expect(pkg.dependencies['react-dom']).toBe('19.0.0');
    });

    it('scoped package preserves @scope/name', async () => {
        const harness = makeCtx();
        await intercept(
            { args: { command: 'npm install @react-navigation/native' } },
            harness.ctx,
        );
        const pkg = JSON.parse(harness.getPkg());
        expect(pkg.dependencies['@react-navigation/native']).toBe('latest');
    });

    it('npm uninstall removes a package', async () => {
        const harness = makeCtx('{"dependencies":{"react":"19.0.0","lodash":"4.0.0"}}');
        await intercept(
            { args: { command: 'npm uninstall lodash' } },
            harness.ctx,
        );
        const pkg = JSON.parse(harness.getPkg());
        expect(pkg.dependencies.lodash).toBeUndefined();
        expect(pkg.dependencies.react).toBe('19.0.0');
    });

    it('npm run dev triggers a bundle', async () => {
        const harness = makeCtx();
        await intercept({ args: { command: 'npm run dev' } }, harness.ctx);
        expect(harness.getBundleCalls()).toBe(1);
    });

    it('expo start triggers a bundle', async () => {
        const harness = makeCtx();
        await intercept({ args: { command: 'expo start' } }, harness.ctx);
        expect(harness.getBundleCalls()).toBe(1);
    });

    it('npm run build triggers a bundle', async () => {
        const harness = makeCtx();
        await intercept({ args: { command: 'npm run build' } }, harness.ctx);
        expect(harness.getBundleCalls()).toBe(1);
    });

    it('unknown commands return PROVIDER_NO_SHELL', async () => {
        const harness = makeCtx();
        const result = await intercept(
            { args: { command: 'cat /etc/passwd' } },
            harness.ctx,
        );
        expect(result.output).toContain('PROVIDER_NO_SHELL');
    });

    it('git config (a real shell call) is not allowlisted', async () => {
        const harness = makeCtx();
        const result = await intercept(
            { args: { command: 'git config user.name "Onlook"' } },
            harness.ctx,
        );
        expect(result.output).toContain('PROVIDER_NO_SHELL');
    });
});
