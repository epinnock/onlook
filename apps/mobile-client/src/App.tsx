import { AppRouter } from './navigation';

/**
 * @onlook/mobile-client — root component.
 *
 * Phase F task MCF8 established the boot-to-black-screen placeholder.
 * MC3.20 wires the AppRouter, which renders the launcher screen on
 * cold-start and provides stack navigation to scan, settings, error,
 * and version-mismatch screens.
 *
 * In Wave 2, `OnlookRuntime.runApplication(bundleSource, props)` becomes the
 * primary mount path; AppRouter stays as the fallback shell that gets
 * mounted when the app cold-starts without a session.
 */
export default function App() {
    return <AppRouter />;
}
