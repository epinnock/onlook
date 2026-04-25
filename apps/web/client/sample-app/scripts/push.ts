#!/usr/bin/env bun
/**
 * Push the sample app at `apps/web/client/sample-app/App.tsx` as an
 * ABI-v1 overlay to a running cf-expo-relay. Prints the
 * `onlook://launch?session=…&relay=…` deep-link the mobile-client's
 * deeplink handler (commit `f8d70396`) routes through the URL
 * pipeline.
 *
 * Pipeline:
 *   1. esbuild bundle App.tsx → single-module CJS with externals
 *      matching the base bundle alias map (react / react-native /
 *      expo* / expo-status-bar / expo-router / etc.).
 *   2. wrapOverlayV1 wraps the CJS in the Hermes-safe ABI-v1 envelope
 *      (per `plans/adr/overlay-abi-v1.md`).
 *   3. POST { type: 'overlayUpdate', abi: 'v1', sessionId, source,
 *      assets, meta: { overlayHash, entryModule: 0, buildDurationMs } }
 *      to `<RELAY>/push/<sessionId>`.
 *
 * Usage:
 *   bun run apps/web/client/sample-app/scripts/push.ts \
 *       --relay=http://192.168.0.14:18788 \
 *       [--session=<sessionId>]      # defaults to `sample-<timestamp>`
 *       [--app=<absolute path>]      # defaults to ./App.tsx
 *       [--watch | -w]               # re-push on every save
 *
 * Watch mode literalizes the user's "overlay updates on save" intent:
 * fs.watch the App.tsx, debounce 100ms, re-build + re-push on every
 * change. Ctrl-C to stop. The relay's last-overlay-v1 store +
 * fan-out means any connected mobile-client picks up the new bundle
 * without restart.
 *
 * Environment:
 *   ONLOOK_RELAY     — same as --relay, falls back to it.
 *   ONLOOK_SESSION   — same as --session.
 *
 * The script does NOT spin up a relay — assumes one is already
 * listening. Stand one up via:
 *   cd apps/cf-expo-relay && bunx wrangler dev --port 18788 --local
 *
 * Exit codes:
 *   0 — pushed successfully (relay returned 202)
 *   1 — bundle failed
 *   2 — relay returned non-2xx
 *   3 — bad CLI args
 */
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

import { wrapOverlayV1 } from '@onlook/browser-bundler';

// Externals match the base bundle's alias-map keys (the runtime resolves
// these via `OnlookRuntime.require`). Keep in sync with
// `packages/base-bundle-builder/src/runtime-capabilities.ts::REQUIRED_ALIASES`
// + `OPTIONAL_CAPABILITY_GROUPS` for the modules a sample app realistically
// imports. Adjust if the base bundle's alias map is broader.
const EXTERNALS: readonly string[] = [
    'react',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'react-native',
    'react-native-safe-area-context',
    'expo',
    'expo-status-bar',
    'expo-router',
    'expo-modules-core',
];

interface CliArgs {
    readonly relay: string;
    readonly sessionId: string;
    readonly appPath: string;
    readonly watch: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs | { error: string } {
    let relay: string | undefined;
    let sessionId: string | undefined;
    let appPath: string | undefined;
    let watch = false;
    for (const a of argv) {
        if (a.startsWith('--relay=')) relay = a.slice('--relay='.length);
        else if (a.startsWith('--session=')) sessionId = a.slice('--session='.length);
        else if (a.startsWith('--app=')) appPath = a.slice('--app='.length);
        else if (a === '--watch' || a === '-w') watch = true;
    }
    relay = relay ?? process.env.ONLOOK_RELAY;
    sessionId = sessionId ?? process.env.ONLOOK_SESSION ?? `sample-${Date.now()}`;
    if (!relay) {
        return {
            error: 'missing --relay=<url> (or ONLOOK_RELAY env). Example: --relay=http://192.168.0.14:18788',
        };
    }
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    const defaultAppPath = resolve(scriptDir, '..', 'App.tsx');
    const finalAppPath = appPath ? (isAbsolute(appPath) ? appPath : resolve(appPath)) : defaultAppPath;
    return { relay: relay.replace(/\/+$/, ''), sessionId, appPath: finalAppPath, watch };
}

async function buildAndPush(args: CliArgs): Promise<number> {
    const { relay, sessionId, appPath } = args;
    // 1. Bundle.
    const t0 = performance.now();
    const result = await build({
        entryPoints: [appPath],
        bundle: true,
        format: 'cjs',
        platform: 'neutral',
        target: 'es2020',
        external: [...EXTERNALS],
        write: false,
        jsx: 'automatic',
        jsxDev: false,
        loader: { '.tsx': 'tsx', '.ts': 'ts' },
        logLevel: 'warning',
    });
    if (result.errors.length > 0) {
        console.error('[push] esbuild errors:', result.errors);
        return 1;
    }
    const out = result.outputFiles?.[0];
    if (!out) {
        console.error('[push] esbuild produced no output files');
        return 1;
    }
    const cjsCode = new TextDecoder().decode(out.contents);
    console.info(`[push] cjs bundle: ${cjsCode.length} bytes`);

    // 2. Wrap.
    const wrapped = wrapOverlayV1(cjsCode);
    if (wrapped.sizeWarning) console.warn(`[push] ${wrapped.sizeWarning}`);
    console.info(`[push] wrapped: ${wrapped.sizeBytes} bytes`);

    // 3. POST to relay's /push/<sessionId>.
    const overlayHash = createHash('sha256').update(wrapped.code).digest('hex');
    const buildDurationMs = Math.round(performance.now() - t0);
    const message = {
        type: 'overlayUpdate',
        abi: 'v1',
        sessionId,
        source: wrapped.code,
        assets: { abi: 'v1', assets: {} },
        meta: { overlayHash, entryModule: 0, buildDurationMs },
    };
    const pushUrl = `${relay}/push/${encodeURIComponent(sessionId)}`;
    console.info(`[push] POST ${pushUrl}`);
    const res = await fetch(pushUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(message),
    });
    const body = await res.text();
    console.info(`[push] status=${res.status} body=${body.slice(0, 200)}`);
    if (!res.ok) {
        console.error('[push] relay rejected the overlay');
        return 2;
    }
    console.info(`[push] ✅ pushed overlayHash=${overlayHash.slice(0, 12)}…`);
    return 0;
}

async function main(): Promise<number> {
    const args = parseArgs(process.argv.slice(2));
    if ('error' in args) {
        console.error(`[push] ${args.error}`);
        return 3;
    }
    const { relay, sessionId, appPath, watch } = args;
    console.info(`[push] app=${appPath}`);
    console.info(`[push] relay=${relay}`);
    console.info(`[push] sessionId=${sessionId}`);
    if (watch) console.info(`[push] watch mode — will re-push on every save`);

    // First push.
    const code = await buildAndPush(args);
    if (code !== 0 && !watch) return code;

    const deepLink = `onlook://launch?session=${encodeURIComponent(sessionId)}&relay=${encodeURIComponent(relay)}`;
    console.info(`[push] deeplink: ${deepLink}`);
    if (!watch) {
        console.info('[push] open the mobile-client and either scan/paste the deeplink or rely on the f8d70396 deeplink wire-up.');
        return code;
    }

    // Watch mode — re-push on every save. Uses Node's `fs.watch` which
    // fires once per save on most editors (macOS / Linux). Coalesce
    // bursts via a 100ms debounce so multi-file saves (e.g. format-on-save
    // followed by user save) only trigger one re-push.
    console.info('[push] watching for changes — Ctrl-C to stop');
    const { watch: fsWatch } = await import('node:fs');
    let pending: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    const w = fsWatch(appPath, () => {
        if (pending) clearTimeout(pending);
        pending = setTimeout(async () => {
            if (inFlight) return;
            inFlight = true;
            try {
                console.info('[push] change detected — rebuilding…');
                await buildAndPush(args);
            } finally {
                inFlight = false;
            }
        }, 100);
    });
    // Keep the process alive; SIGINT cleanup.
    process.on('SIGINT', () => {
        w.close();
        process.exit(0);
    });
    await new Promise<void>(() => {
        // Promise never resolves; the watcher drives the loop until SIGINT.
    });
    return 0; // unreachable but satisfies the return-type contract
}

main()
    .then((code) => process.exit(code))
    .catch((err) => {
        console.error('[push] unexpected error:', err);
        process.exit(1);
    });
