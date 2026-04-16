import Foundation
import os.log

/// `[onlook-runtime]`-prefixed logger for the Onlook Mobile Client native layer.
///
/// All native-side messages (AppDelegate boot, Hermes bootstrap, JSI binding
/// hooks, inspector events, crash overlays) route through this enum so the
/// prefix stays consistent and downstream log-scraping — e.g. the Maestro
/// flows that assert `[onlook-runtime] hermes ready` in the device log for
/// MC1.4 / MC1.7 validation — has a single string to grep for.
///
/// Writes to Apple's unified logging system under subsystem `com.onlook.mobile`
/// with a `runtime` category, so messages are visible in Console.app (filter
/// by subsystem), `log stream --predicate 'subsystem == "com.onlook.mobile"'`
/// on a connected simulator / device, and the Xcode debug console. Using
/// `os_log` rather than `print` also lets us opt into `.debug` on release
/// builds without leaving plaintext `print()` calls to redact later.
///
/// Task queue reference: MC1.10 of plans/onlook-mobile-client-task-queue.md.
/// Kotlin mirror lives in MC1.10a; the method surface must stay aligned so
/// JS code can call `OnlookRuntime.log(...)` without platform branching.
public enum OnlookLogger {
    public static let subsystem = "com.onlook.mobile"
    public static let category = "runtime"

    private static let log = OSLog(subsystem: subsystem, category: category)

    public static func debug(_ message: String) {
        os_log("[onlook-runtime] %{public}@", log: log, type: .debug, message)
    }

    public static func info(_ message: String) {
        os_log("[onlook-runtime] %{public}@", log: log, type: .info, message)
    }

    public static func notice(_ message: String) {
        os_log("[onlook-runtime] %{public}@", log: log, type: .default, message)
    }

    public static func error(_ message: String) {
        os_log("[onlook-runtime] %{public}@", log: log, type: .error, message)
    }

    public static func fault(_ message: String) {
        os_log("[onlook-runtime] %{public}@", log: log, type: .fault, message)
    }
}
