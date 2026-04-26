import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Linking } from 'react-native';

import { AppRouter } from './navigation';
import { startTapBridge } from './nativeEvents/tapBridge';
import { qrToMount } from './flow/qrToMount';
import {
    startTwoTierBootstrap,
    type TwoTierBootstrapHandle,
} from './flow/twoTierBootstrap';
import { OverlayHost } from './overlay/OverlayHost';
import { consoleRelay } from './debug/consoleRelay';
import { ConsoleStreamer } from './debug/consoleStreamer';
import { exceptionCatcher } from './debug/exceptionCatcher';
import { ExceptionStreamer } from './debug/exceptionStreamer';
import { fetchPatch } from './debug/fetchPatch';
import { xhrPatch } from './debug/xhrPatch';
import { NetworkStreamer } from './debug/networkStreamer';
import { dynamicWsSender } from './relay/wsSender';
import {
    DevMenu,
    DevMenuTrigger,
    RecentLogsModal,
    type DevMenuAction,
} from './components';
import {
    createReloadAction,
    createClearStorageAction,
    createCopySessionIdAction,
    createViewLogsAction,
    createToggleInspectorAction,
} from './actions';
import {
    isDevMenuEnabled,
    loadDevMenuEnabled,
    onDevMenuEnabledChange,
} from './storage';

/**
 * Boot-time placeholder for the session id stamped on outgoing
 * `onlook:console` messages. The deeplink flow rotates the real id in
 * via `consoleStreamerRef.current?.setSessionId(...)` after qrToMount
 * resolves. Picked up by the editor's MobileConsoleTab consumer once a
 * real session id arrives; pre-handshake messages carry this sentinel.
 */
const CONSOLE_BOOT_SESSION_ID = 'pending';

export default function App() {
    useEffect(() => {
        if (Platform.OS !== 'ios') return;
        const stopTapBridge = startTapBridge();
        return () => {
            stopTapBridge();
        };
    }, []);

    /**
     * Mobile observability — patches `console.log/warn/error/info/debug`
     * once at app boot, subscribes a `ConsoleStreamer` against the
     * dynamic sender registry, and forwards entries to the editor over
     * AppRouter's Spike B WS once it opens. Pre-WS-open entries buffer
     * locally on the streamer; they drain on the next forward call
     * after `registerActiveWsSender` fires in AppRouter's `ws.onopen`.
     *
     * The streamer is created once at boot and reused across deeplink
     * sessions — `setSessionId` rotates the stamp without re-patching
     * console. consoleRelay.install() is idempotent so re-mounting
     * the App component (e.g. fast refresh in dev) doesn't double-patch.
     */
    const consoleStreamerRef = useRef<ConsoleStreamer | null>(null);
    const exceptionStreamerRef = useRef<ExceptionStreamer | null>(null);
    const networkStreamerRef = useRef<NetworkStreamer | null>(null);
    useEffect(() => {
        consoleRelay.install();
        exceptionCatcher.install();
        // fetch + XHR patches for network observability (MC5.3 + MC5.4).
        // Both are global-prototype patches so they install once at app
        // boot. uninstall() restores originals on teardown so fast-refresh
        // / unit-test re-mounts don't double-patch.
        fetchPatch.install();
        xhrPatch.install();

        const cs = new ConsoleStreamer(dynamicWsSender, CONSOLE_BOOT_SESSION_ID);
        cs.start();
        consoleStreamerRef.current = cs;

        // Pair to ConsoleStreamer — forwards exceptions captured by
        // `exceptionCatcher` (RN ErrorUtils + window.onerror) as
        // `onlook:error` messages. Matches the producer the editor's
        // source-map decoration receive-chain
        // (`wireBufferDecorationOnError` in use-mobile-preview-status.tsx,
        // wired via 5da582fe + 3b18789d) was already waiting for.
        const es = new ExceptionStreamer(dynamicWsSender, CONSOLE_BOOT_SESSION_ID);
        es.start();
        exceptionStreamerRef.current = es;

        // NetworkStreamer (MC5.5) — forwards completed fetch/XHR entries
        // as `onlook:network` messages so the editor's MobileNetworkTab
        // populates on a real session. Sources default to the
        // `fetchPatch` / `xhrPatch` singletons we just installed.
        const ns = new NetworkStreamer(
            dynamicWsSender,
            {},
            { sessionId: CONSOLE_BOOT_SESSION_ID },
        );
        ns.start();
        networkStreamerRef.current = ns;

        return () => {
            cs.stop();
            consoleStreamerRef.current = null;
            es.stop();
            exceptionStreamerRef.current = null;
            ns.stop();
            networkStreamerRef.current = null;
            fetchPatch.uninstall();
            xhrPatch.uninstall();
        };
    }, []);

    // Keep the most recent two-tier bootstrap across deeplink re-scans so a
    // new session can tear down the previous overlay channel cleanly.
    const twoTierHandleRef = useRef<TwoTierBootstrapHandle | null>(null);

    // Active session id for the dev menu's Copy Session ID action. Tracked
    // alongside `twoTierHandleRef` so the action getter reads the latest
    // value without stale-closure pitfalls.
    const activeSessionIdRef = useRef<string | null>(null);

    // Dev menu modal state — opens via the three-finger long-press gesture
    // (DevMenuTrigger / MC5.10) wrapping the app body. Closes via backdrop
    // tap or any action's onPress finishing. RecentLogsModal opens via
    // the "View Recent Logs" action and lives outside the dev menu so it
    // persists after the menu dismisses.
    const [devMenuVisible, setDevMenuVisible] = useState(false);
    const [recentLogsVisible, setRecentLogsVisible] = useState(false);
    const closeDevMenu = useCallback(() => setDevMenuVisible(false), []);
    const openDevMenu = useCallback(() => setDevMenuVisible(true), []);

    // Dev-menu trigger gating — defaults to OFF on first launch (matching
    // SettingsScreen UX); flips when the user toggles the Settings switch
    // (which calls `setDevMenuEnabled` in the same `storage` module). Both
    // sides observe the same in-memory state via `onDevMenuEnabledChange`,
    // so the toggle takes effect immediately without an app restart.
    const [devMenuTriggerEnabled, setDevMenuTriggerEnabled] = useState(
        isDevMenuEnabled(),
    );
    useEffect(() => {
        void loadDevMenuEnabled().then((v) => setDevMenuTriggerEnabled(v));
        const off = onDevMenuEnabledChange((v) => setDevMenuTriggerEnabled(v));
        return () => off();
    }, []);

    // Dev menu actions list — built once, stable across re-renders so
    // DevMenu doesn't re-render its action buttons unnecessarily. Each
    // factory returns a `DevMenuAction` `{label, onPress, destructive?}`.
    // Actions that need state read it via closures over refs (e.g.
    // `activeSessionIdRef`) so the latest value is consulted at press
    // time rather than at action-list construction time.
    const devMenuActions = useMemo<readonly DevMenuAction[]>(
        () => [
            createReloadAction(),
            createCopySessionIdAction(() => activeSessionIdRef.current),
            createViewLogsAction(setRecentLogsVisible),
            createToggleInspectorAction(),
            createClearStorageAction(),
        ],
        [],
    );

    // Wrap each action so the dev menu auto-dismisses after press. The
    // factories themselves don't know about the menu's visibility state;
    // composing the dismiss here keeps each action self-contained.
    const wrappedDevMenuActions = useMemo<readonly DevMenuAction[]>(
        () =>
            devMenuActions.map((a) => ({
                ...a,
                onPress: () => {
                    try {
                        a.onPress();
                    } finally {
                        closeDevMenu();
                    }
                },
            })),
        [devMenuActions, closeDevMenu],
    );

    useEffect(() => {
        let cancelled = false;

        const handle = (url: string | null | undefined): void => {
            if (cancelled || !url) return;
            console.log('[App] deeplink received:', url);
            void qrToMount(url).then((result) => {
                if (cancelled) return;
                if (result.ok) {
                    console.log(`[App] deeplink mount ok sessionId=${result.sessionId}`);
                    // Rotate the console streamer's session id stamp so
                    // post-deeplink `onlook:console` messages carry the
                    // real id rather than the boot placeholder. Pre-deeplink
                    // entries already in flight keep the placeholder —
                    // editor MobileConsoleTab can filter them out via
                    // `sessionId === CONSOLE_BOOT_SESSION_ID` if desired.
                    consoleStreamerRef.current?.setSessionId(result.sessionId);
                    exceptionStreamerRef.current?.setSessionId(result.sessionId);
                    networkStreamerRef.current?.setSessionId(result.sessionId);
                    activeSessionIdRef.current = result.sessionId;
                    twoTierHandleRef.current?.stop();
                    twoTierHandleRef.current = startTwoTierBootstrap({
                        sessionId: result.sessionId,
                        relayUrl: result.relay,
                    });
                } else {
                    console.log(
                        `[App] deeplink mount failed stage=${result.stage} error=${result.error}`,
                    );
                }
            });
        };

        void Linking.getInitialURL().then(handle);
        const sub = Linking.addEventListener('url', ({ url }) => handle(url));

        return () => {
            cancelled = true;
            sub.remove();
            twoTierHandleRef.current?.stop();
            twoTierHandleRef.current = null;
        };
    }, []);

    return (
        <>
            {/* DevMenuTrigger wraps the app body so a three-finger long-press
                anywhere opens the dev menu. The trigger is transparent — its
                children render normally. RecentLogsModal sits outside the
                trigger so it stays mounted after the dev menu dismisses. */}
            <DevMenuTrigger onTrigger={openDevMenu} disabled={!devMenuTriggerEnabled}>
                <AppRouter />
                <OverlayHost />
            </DevMenuTrigger>
            <DevMenu
                visible={devMenuVisible}
                onClose={closeDevMenu}
                actions={[...wrappedDevMenuActions]}
            />
            <RecentLogsModal
                visible={recentLogsVisible}
                onClose={() => setRecentLogsVisible(false)}
            />
        </>
    );
}
