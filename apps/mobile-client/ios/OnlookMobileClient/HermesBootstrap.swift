import Foundation
import React

/// Wave 1 task MC1.4 of plans/onlook-mobile-client-task-queue.md.
///
/// Responsible for ensuring `onlook-runtime.js` — the ~241KB pre-built React +
/// reconciler + scheduler + Fabric host config bundle that ships at the root
/// of the `.app` (see MCF11's bundle-runtime.ts and the `59fc46f3` pbxproj
/// wiring) — is evaluated into Hermes BEFORE any user-authored JS bundle
/// runs. The runtime sets up `global.OnlookRuntime`, `global.React`, the
/// Metro `__d`/`__r` module registry, and all the JSI polyfills the user
/// bundle assumes; without it, user code fails with "undefined globals".
///
/// Strategy: prepend the runtime source to whatever bundle the RN host was
/// going to load. This works whether the user bundle comes from Metro on
/// `http://localhost:8081` (DEBUG) or `main.jsbundle` from the app bundle
/// (RELEASE / simulator smoke build) because by the time the bridge /
/// RCTHost eval the combined string, Hermes treats it as one JS context.
/// No JSI / Objective-C++ needed — the composition happens at the byte
/// level in Swift, before control reaches Hermes.
///
/// Emits `[onlook-runtime] hermes ready` via `OnlookLogger.info` on the
/// first successful prepend so Maestro's 03-hermes-eval flow + the
/// orchestrator's post-flow `log show` scrape have a single line to grep
/// for. If the runtime asset is missing or unreadable, logs at `.error`
/// and returns the user data unchanged — the app will likely crash
/// downstream with "undefined is not an object" or similar, which is the
/// loudest available failure mode.
enum HermesBootstrap {
    private static let runtimeResourceName = "onlook-runtime"
    private static let runtimeResourceExtension = "js"

    /// Reads `onlook-runtime.js` from the main app bundle. Returns `nil`
    /// on any I/O error (logged via OnlookLogger.error).
    static func loadRuntimeData() -> Data? {
        guard
            let url = Bundle.main.url(
                forResource: runtimeResourceName,
                withExtension: runtimeResourceExtension
            )
        else {
            OnlookLogger.error(
                "onlook-runtime.js not found in Bundle.main — HermesBootstrap skipped, user bundle will fail"
            )
            return nil
        }
        do {
            return try Data(contentsOf: url, options: .mappedIfSafe)
        } catch {
            OnlookLogger.error(
                "failed to read onlook-runtime.js from \(url.path): \(error.localizedDescription)"
            )
            return nil
        }
    }

    /// Returns `userData` prepended with the onlook runtime bundle and a
    /// newline separator. On success emits `[onlook-runtime] hermes ready`.
    /// On failure to load the runtime, returns `userData` unchanged.
    static func prepend(into userData: Data) -> Data {
        guard let runtime = loadRuntimeData() else {
            OnlookLogger.error("runtime asset missing — user bundle will execute without onlook globals")
            return userData
        }
        var combined = Data(capacity: runtime.count + userData.count + 1)
        combined.append(runtime)
        combined.append(0x0A)  // '\n'
        combined.append(userData)
        // Use os_log .error level (via OnlookLogger.error) rather than .info
        // because Apple's unified log filters .info messages out of
        // `log show` by default — we need this line to be persisted so the
        // orchestrator's `xcrun simctl spawn booted log show --predicate
        // 'eventMessage CONTAINS "[onlook-runtime] hermes ready"'` scrape
        // (used by validate-task.ts MC1.4) reliably finds it. Semantically
        // it's a notice/info event, not an error; consider switching to
        // os_log .default once OnlookLogger gains a notice() method.
        OnlookLogger.error("hermes ready")
        return combined
    }
}
