import { useEffect, useRef } from 'react';
import { Platform, Linking } from 'react-native';

import { AppRouter } from './navigation';
import { startTapBridge } from './nativeEvents/tapBridge';
import { qrToMount } from './flow/qrToMount';
import {
    startTwoTierBootstrap,
    type TwoTierBootstrapHandle,
} from './flow/twoTierBootstrap';

export default function App() {
    useEffect(() => {
        if (Platform.OS !== 'ios') return;
        const stopTapBridge = startTapBridge();
        return () => {
            stopTapBridge();
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

    return <AppRouter />;
}
