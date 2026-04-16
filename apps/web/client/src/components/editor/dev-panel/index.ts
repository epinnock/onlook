/**
 * Editor-side dev-panel barrel.
 *
 * Feature entry points for the mobile client's in-editor debug surface.
 * Each tab owns its own file and is re-exported here so consumers can
 * import from `@/components/editor/dev-panel` without caring about the
 * internal layout.
 *
 * Populated so far:
 *   - MobileConsoleTab (MC5.16) — console stream rendering
 *
 * MC5.17 (`MobileNetworkTab`) adds its own line to this barrel when it
 * lands — kept intentionally out of this commit so the build doesn't
 * reference a file another agent may still be iterating on.
 */

export {
    MobileConsoleRow,
    MobileConsoleTab,
    filterConsoleMessages,
    type MobileConsoleRowProps,
    type MobileConsoleTabProps,
} from './MobileConsoleTab';
