import React, { useEffect, useRef } from 'react';
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
import { dynamicWsSender } from './relay/wsSender';

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
    useEffect(() => {
        consoleRelay.install();
        const streamer = new ConsoleStreamer(
            dynamicWsSender,
            CONSOLE_BOOT_SESSION_ID,
        );
        streamer.start();
        consoleStreamerRef.current = streamer;
        return () => {
            streamer.stop();
            consoleStreamerRef.current = null;
        };
    }, []);

    // Keep the most recent two-tier bootstrap across deeplink re-scans so a
    // new session can tear down the previous overlay channel cleanly.
    const twoTierHandleRef = useRef<TwoTierBootstrapHandle | null>(null);

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
            <AppRouter />
            <OverlayHost />
        </>
    );
}
