/**
 * AppRouter — MC3.20 of plans/onlook-mobile-client-task-queue.md.
 *
 * Minimal custom stack navigator for the Onlook Mobile Client. Uses React
 * state instead of @react-navigation to avoid a heavy dependency for a
 * 5-screen app.
 *
 * Screens:
 *  - launcher       (initial / home)
 *  - scan           (QR scanner)
 *  - settings       (relay host, clear cache, dev menu)
 *  - error          (generic error display)
 *  - versionMismatch (relay version incompatibility)
 *
 * Navigation helpers (`navigate`, `goBack`) are exposed via
 * NavigationContext so any descendant can trigger screen transitions.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import {
    CrashScreen,
    ErrorScreen,
    LauncherScreen,
    ScanScreen,
    ScreensGalleryScreen,
    SettingsScreen,
    VersionMismatchScreen,
} from '../screens';
import { qrToMount } from '../flow/qrToMount';
import { parseOnlookDeepLink } from '../deepLink/parse';
import { fetchManifest } from '../relay/manifestFetcher';
import { fetchBundle } from '../relay/bundleFetcher';

type RuntimeWithRun = { runApplication?: (src: string, props: { sessionId: string }) => void };

function timeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race<T>([
        p,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
        ),
    ]);
}
import {
    NavigationContext,
    type Screen,
    type NavigationParams,
} from './NavigationContext';

const AUTO_RUN_URL =
    'exp://192.168.0.14:8787/manifest/dc8ead785627ac182bd9f331f2eee7a73afbd48d72fc585d8d1fccfa9c439bf6';

function buildUrlPipelineRunner(actions: NavActions) {
    return (data: string) => {
        const log: string[] = [];
        const show = (title: string, extra = '') => {
            actions.resetTo('error', {
                errorTitle: title,
                errorMessage: log.join('\n') + (extra ? '\n' + extra : ''),
            });
        };
        (async () => {
            log.push(`url=${data.slice(0, 140)}`);
            show('Opening…');

            // Stage 0a: external fetch
            try {
                log.push('preflight GET https://1.1.1.1/');
                show('Preflight A (external)…');
                const r = await timeout(
                    fetch('https://1.1.1.1/', { method: 'GET' }),
                    8000,
                    'preflight external',
                );
                log.push(`preflight A ${r.status}`);
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                show('Preflight A failed (external)', msg);
                return;
            }
            // Stage 0b: LAN fetch to /status
            try {
                const hostMatch = data.match(/^(?:exp|https?):\/\/([^\/]+)/i);
                const host = hostMatch?.[1];
                if (host) {
                    const statusUrl = `http://${host}/status`;
                    log.push(`preflight GET ${statusUrl}`);
                    show('Preflight B (LAN)…');
                    const r = await timeout(
                        fetch(statusUrl, { method: 'GET' }),
                        8000,
                        'preflight LAN',
                    );
                    const body = (await r.text()).slice(0, 160);
                    log.push(`preflight B ${r.status} body=${body}`);
                }
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                show('Preflight B failed (LAN)', msg);
                return;
            }

            // Stage 1: parse
            const parsed = parseOnlookDeepLink(data);
            if (!parsed || !parsed.sessionId || !parsed.relay) {
                show('Parse failed', `parsed=${JSON.stringify(parsed)}`);
                return;
            }
            log.push(`parse ok sessionId=${parsed.sessionId.slice(0, 12)}…`);
            log.push(`relay=${parsed.relay}`);
            show('Fetching manifest…');

            // Stage 2: manifest
            let manifest;
            try {
                const r = await timeout(fetchManifest(parsed.relay), 15000, 'fetchManifest');
                if (!r.ok) {
                    show('Manifest failed', r.error);
                    return;
                }
                manifest = r.manifest;
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                show('Manifest threw', msg);
                return;
            }
            const bundleUrl = manifest.launchAsset.url;
            log.push(`manifest ok bundleUrl=${bundleUrl}`);
            show('Fetching bundle…');

            // Stage 3: bundle
            let bundleSource: string;
            try {
                const r = await timeout(fetchBundle(bundleUrl), 30000, 'fetchBundle');
                if (!r.ok) {
                    show('Bundle failed', r.error);
                    return;
                }
                bundleSource = r.source;
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                show('Bundle threw', msg);
                return;
            }
            log.push(`bundle ok bytes=${bundleSource.length}`);
            show('Mounting…');
            // Give React a full commit cycle so the 'Mounting…' paint lands
            // BEFORE we invoke onlookMount. Otherwise the scheduled commit
            // for this setState runs AFTER our reconciler's renderApp and
            // overwrites the remote UI on Fabric rootTag=11.
            await new Promise((r) => setTimeout(r, 600));

            // Stage 4: mount.
            //
            // The OnlookRuntime.runApplication JSI binding isn't installed in
            // this build (the cpp files exist but nothing calls the
            // installer). Fall back to evaluating the bundle directly in the
            // host Hermes context — the bundle's shell.js defines
            // `globalThis.onlookMount` which we then invoke.
            //
            // Note: evaluating the bundle reinstalls `RCTDeviceEventEmitter`
            // via RN$registerCallableModule, which breaks further RN fetch
            // calls. By this point the only fetches are done, so it's OK.
            try {
                // eslint-disable-next-line no-eval
                (0, eval)(bundleSource);
                log.push('bundle eval OK');
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                const stack = e instanceof Error && e.stack ? e.stack.slice(0, 400) : '';
                show('Bundle eval threw', `${msg}\n${stack}`);
                return;
            }
            const mountFn = (globalThis as unknown as { onlookMount?: (p: Record<string, unknown>) => void }).onlookMount;
            if (typeof mountFn !== 'function') {
                show('Mount failed', 'globalThis.onlookMount not defined after bundle eval');
                return;
            }
            const hostMatch2 = data.match(/^(?:exp|https?):\/\/([^:\/]+)/i);
            const relayHost = hostMatch2?.[1] || '192.168.0.17';
            try {
                mountFn({
                    sessionId: parsed.sessionId,
                    rootTag: 11,
                    relayHost,
                    relayPort: 8788,
                });
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                const stack = e instanceof Error && e.stack ? e.stack.slice(0, 400) : '';
                show('onlookMount threw', `${msg}\n${stack}`);
                return;
            }
            log.push(`mount ok relayHost=${relayHost} rootTag=11`);

            // Open the live-update WebSocket using RN's built-in WebSocket
            // class — bypasses the CallableJSModule plumbing that shell.js
            // relies on but that doesn't seem to receive events in this
            // build. On message, reuse shell.js's `_handleMessage` so the
            // eval path stays identical to the Expo Go path.
            const gt = globalThis as unknown as Record<string, unknown>;
            const hook = gt.nativeLoggingHook as ((msg: string, level: number) => void) | undefined;
            const slog = (m: string) => hook && hook('[SPIKE_B] ' + m, 1);
            const WSCtor = gt.WebSocket as (new (url: string) => {
                onopen: (() => void) | null;
                onmessage: ((ev: { data: string }) => void) | null;
                onerror: ((ev: unknown) => void) | null;
                onclose: (() => void) | null;
            }) | undefined;
            if (typeof WSCtor === 'function') {
                try {
                    const wsUrl = `ws://${relayHost}:8788`;
                    slog('ws (native): connecting to ' + wsUrl);
                    const ws = new WSCtor(wsUrl);
                    ws.onopen = () => {
                        gt.wsConnected = true;
                        slog('ws (native): OPEN');
                    };
                    ws.onmessage = (ev) => {
                        try {
                            slog('ws (native): MSG ' + String(ev.data).slice(0, 80));
                            const payload = JSON.parse(ev.data);
                            const handle = gt._handleMessage as ((m: unknown) => void) | undefined;
                            if (typeof handle === 'function') {
                                handle(payload);
                            }
                        } catch (err: unknown) {
                            const m = err instanceof Error ? err.message : String(err);
                            slog('ws (native): parse/handle err ' + m);
                        }
                    };
                    ws.onerror = (ev) => {
                        try {
                            slog('ws (native): ERR ' + JSON.stringify(ev).slice(0, 120));
                        } catch (_) { slog('ws (native): ERR (unserializable)'); }
                    };
                    ws.onclose = () => {
                        gt.wsConnected = false;
                        slog('ws (native): CLOSED');
                    };
                } catch (e: unknown) {
                    const msg = e instanceof Error ? e.message : String(e);
                    slog('ws (native): ctor threw ' + msg);
                    log.push(`ws ctor threw: ${msg}`);
                }
            } else {
                log.push('ws: globalThis.WebSocket not available');
                slog('ws: globalThis.WebSocket not available');
            }
            // Intentionally NOT navigating after successful mount — any
            // further React state update causes RN's reconciler to re-paint
            // rootTag=11, overwriting the custom reconciler's output.
        })();
    };
}

export default function AppRouter() {
    const [stack, setStack] = useState<Array<{ screen: Screen; params?: NavigationParams }>>([
        { screen: 'launcher' },
    ]);
    const autoRanRef = useRef(false);

    const current = stack[stack.length - 1]!;

    const navigate = useCallback((screen: Screen, params?: NavigationParams) => {
        setStack((prev) => [...prev, { screen, params }]);
    }, []);

    const goBack = useCallback(() => {
        setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
    }, []);

    const resetTo = useCallback((screen: Screen, params?: NavigationParams) => {
        setStack([{ screen, params }]);
    }, []);

    /**
     * Replace the top of the stack in place. Used by the URL-entry status
     * tracer to update the visible error screen as each stage completes
     * without wiping the launcher from the stack (which is what makes Go
     * Back work).
     */
    const replaceCurrent = useCallback((screen: Screen, params?: NavigationParams) => {
        setStack((prev) => {
            if (prev.length === 0) return [{ screen, params }];
            return [...prev.slice(0, -1), { screen, params }];
        });
    }, []);

    const contextValue = useMemo(
        () => ({ navigate, goBack, resetTo, currentScreen: current.screen }),
        [navigate, goBack, resetTo, current.screen],
    );

    // Auto-run disabled — re-enable by setting AUTO_RUN=true if you need
    // headless SSH-driven verification again.
    const AUTO_RUN = false;
    useEffect(() => {
        if (!AUTO_RUN || autoRanRef.current) return;
        autoRanRef.current = true;
        const t = setTimeout(() => {
            buildUrlPipelineRunner({ navigate, goBack, resetTo })(AUTO_RUN_URL);
        }, 1500);
        return () => clearTimeout(t);
    }, [navigate, goBack, resetTo]);

    return (
        <NavigationContext.Provider value={contextValue}>
            <View style={styles.root}>
                {renderScreen(current.screen, current.params, { navigate, goBack, resetTo })}
            </View>
        </NavigationContext.Provider>
    );
}

interface NavActions {
    navigate: (screen: Screen, params?: NavigationParams) => void;
    goBack: () => void;
    resetTo: (screen: Screen, params?: NavigationParams) => void;
}

function renderScreen(
    screen: Screen,
    params: NavigationParams | undefined,
    actions: NavActions,
): React.ReactElement {
    switch (screen) {
        case 'launcher':
            return (
                <LauncherScreen
                    onScanPress={() => actions.navigate('scan')}
                    onSettingsPress={() => actions.navigate('settings')}
                    onUrlSubmit={buildUrlPipelineRunner(actions)}
                />
            );

        case 'scan':
            return (
                <ScanScreen
                    onScan={buildUrlPipelineRunner(actions)}
                    onCancel={() => actions.goBack()}
                />
            );

        case 'settings':
            return <SettingsScreen onGoBack={() => actions.goBack()} />;

        case 'error':
            return (
                <ErrorScreen
                    title={params?.errorTitle ?? 'Something went wrong'}
                    message={params?.errorMessage ?? 'An unexpected error occurred.'}
                    details={params?.errorDetails}
                    onRetry={params?.onRetry}
                    onGoBack={() => actions.goBack()}
                />
            );

        case 'versionMismatch':
            return (
                <VersionMismatchScreen
                    clientVersion={params?.clientVersion ?? '0.0.0'}
                    serverVersion={params?.serverVersion ?? '0.0.0'}
                    onRetry={params?.onRetry}
                    onGoBack={() => actions.goBack()}
                />
            );

        case 'crash': {
            // Synthesize an Error from the generic NavigationParams so the
            // Screen Gallery can preview this screen without needing to
            // capture a real exception. On the happy path (MC5.6 error
            // boundary), CrashScreen is rendered imperatively with a real
            // Error + component stack rather than through the navigator.
            const crashError = new Error(
                params?.errorMessage ?? 'Unknown runtime error',
            );
            crashError.name = params?.errorTitle ?? 'Error';
            return (
                <CrashScreen
                    error={crashError}
                    componentStack={params?.errorDetails ?? null}
                    onReload={() => actions.resetTo('launcher')}
                />
            );
        }

        case 'gallery':
            return <ScreensGalleryScreen />;
    }
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: '#0A0A0A',
    },
});
