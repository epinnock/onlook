/**
 * wireOnlookSelectToIdeManager — production wiring for tap-to-source.
 *
 * The editor uses CodeMirror, not Monaco, so the existing
 * {@link wireCursorJump} helper (which manipulates a `MonacoLikeEditor`
 * directly) does not match the production stack. This module provides a
 * CodeMirror-native wiring path: each `onlook:select` message arriving
 * from the phone calls `IdeManager.openCodeLocation(fileName, line, col)`,
 * which sets the existing `_codeNavigationOverride` MobX state — the
 * same mechanism `openCodeBlock` already uses to drive the
 * `useCodeNavigation` hook + CodeMirror EditorView.
 *
 * Composition contract — wire this once at editor mount:
 *
 *   useEffect(() => wireOnlookSelectToIdeManager(editorEngine.ide), [editorEngine.ide]);
 *
 * The returned function is the unsubscribe; React's effect cleanup
 * fires it on unmount or dependency change.
 *
 * Test-coverage strategy: the helper is a thin glue layer between the
 * receiver (already tested in `onlookSelectReceiver.test.ts`) + the
 * IdeManager method (tested in `ide.test.ts` to be added). This module's
 * own test asserts the glue: a dispatched `onlook:select` becomes an
 * `openCodeLocation` call with the correct args.
 */
import {
    registerOnlookSelectHandler,
    type OnlookSelectMessage,
} from './onlookSelectReceiver';

/**
 * Minimal IdeManager surface — declared locally (not imported from the
 * editor's MobX store) so this module can be unit-tested without
 * pulling the full editor engine + MobX into the test runtime. The
 * production caller passes the real `IdeManager`; tests pass a spy.
 */
export interface OpenCodeLocationCapableIde {
    openCodeLocation(fileName: string, lineNumber: number, columnNumber: number): void;
}

export interface WireOnlookSelectOptions {
    /**
     * Diagnostic hook — receives every dispatched select message just
     * before it routes to the IdeManager. Keeps this module decoupled
     * from any logging framework.
     */
    onMessage?: (msg: OnlookSelectMessage) => void;
}

/**
 * Subscribe an IdeManager to the `onlook:select` channel. Returns an
 * unsubscribe function. Safe to call multiple times — each call adds
 * an independent subscription.
 */
export function wireOnlookSelectToIdeManager(
    ide: OpenCodeLocationCapableIde,
    opts: WireOnlookSelectOptions = {},
): () => void {
    return registerOnlookSelectHandler((msg) => {
        opts.onMessage?.(msg);
        ide.openCodeLocation(msg.fileName, msg.lineNumber, msg.columnNumber);
    });
}
