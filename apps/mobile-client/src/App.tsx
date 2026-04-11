import { View } from 'react-native';

/**
 * @onlook/mobile-client — root component.
 *
 * Phase F task MCF8. This is the boot-to-black-screen placeholder the source
 * plan targets as the Phase 1 smoke test. The real UI (launcher screen, QR
 * scanner, settings) is wired up by Wave 3 (`MC3.5`, `MC3.6`, `MC3.10`,
 * `MC3.20`) once the Phase F foundation is in place.
 *
 * In Wave 2, `OnlookRuntime.runApplication(bundleSource, props)` becomes the
 * primary mount path; this component stays as the fallback shell that gets
 * mounted when the app cold-starts without a session.
 */
export default function App() {
    return <View style={{ flex: 1, backgroundColor: '#000000' }} />;
}
