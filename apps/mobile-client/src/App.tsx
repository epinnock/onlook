import { useEffect } from 'react';
import { Platform } from 'react-native';

import { AppRouter } from './navigation';
import { startTapBridge } from './nativeEvents/tapBridge';

/**
 * @onlook/mobile-client — root component.
 *
 * Phase F task MCF8 established the boot-to-black-screen placeholder.
 * MC3.20 wires the AppRouter, which renders the launcher screen on
 * cold-start and provides stack navigation to scan, settings, error,
 * and version-mismatch screens.
 *
 * MC2.5 follow-up: on iOS we start the native tap bridge at app boot so
 * `UITapGestureRecognizer`-captured taps from the Fabric root view flow
 * through `OnlookTapForwarder` into `OnlookRuntime.dispatchEvent('onlook:tap', …)`.
 * The bridge is a no-op on Android (native module absent), but we gate with
 * `Platform.OS` anyway to avoid even constructing the NativeEventEmitter there.
 *
 * In Wave 2, `OnlookRuntime.runApplication(bundleSource, props)` becomes the
 * primary mount path; AppRouter stays as the fallback shell that gets
 * mounted when the app cold-starts without a session.
 */
export default function App() {
    useEffect(() => {
        if (Platform.OS !== 'ios') return;
        const stopTapBridge = startTapBridge();
        return () => {
            stopTapBridge();
        };
    }, []);

    return <AppRouter />;
}
