import { useEffect } from 'react';
import { Platform, Linking } from 'react-native';

import { AppRouter } from './navigation';
import { startTapBridge } from './nativeEvents/tapBridge';
import { qrToMount } from './flow/qrToMount';

export default function App() {
    useEffect(() => {
        if (Platform.OS !== 'ios') return;
        const stopTapBridge = startTapBridge();
        return () => {
            stopTapBridge();
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        const handle = (url: string | null | undefined): void => {
            if (cancelled || !url) return;
            console.log('[App] deeplink received:', url);
            void qrToMount(url).then((result) => {
                if (cancelled) return;
                if (result.ok) {
                    console.log(`[App] deeplink mount ok sessionId=${result.sessionId}`);
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
        };
    }, []);

    return <AppRouter />;
}
