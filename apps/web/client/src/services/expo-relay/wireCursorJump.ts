/**
 * MC4.17 wiring: connect the MC4.15 `onlook:select` receiver to the
 * Monaco cursor-jump helper.
 *
 * The editor engine owns the Monaco instance through a ref that is
 * not stable across re-renders (file tabs swap the active editor).
 * Rather than taking the editor by value, callers pass a getter:
 * `wireCursorJump(() => currentMonacoEditor)`. Each incoming
 * `onlook:select` reads the freshest editor reference before calling
 * `jumpToSource`.
 *
 * The returned function unsubscribes from the receiver, mirroring
 * `registerOnlookSelectHandler`'s contract (MC4.15).
 */

import {
    registerOnlookSelectHandler,
    type OnlookSelectMessage,
} from './onlookSelectReceiver';
import {
    jumpToSource,
    type FileNavigator,
    type MonacoLikeEditor,
} from './monacoCursorJump';

/**
 * Getter for the live Monaco editor instance. Returning `null`/
 * `undefined` is legal and common — e.g. during route transitions
 * when no file is open. `jumpToSource` handles that case gracefully.
 */
export type EditorGetter = () => MonacoLikeEditor | null | undefined;

export interface WireCursorJumpOptions {
    /**
     * Invoked when the tapped source lives in a different file than
     * Monaco currently shows. In app code this calls
     * `editorEngine.ide.openCodeBlock(...)` or an equivalent route
     * action; in tests it can be a spy. Optional.
     */
    onDifferentFile?: FileNavigator;
    /**
     * Diagnostic hook — receives every select message just before
     * `jumpToSource` runs. Handy for MC4.17 integration logs without
     * coupling this module to any logging framework.
     */
    onMessage?: (msg: OnlookSelectMessage) => void;
}

/**
 * Subscribe the cursor-jump handler to the MC4.15 receiver.
 *
 * @param editorGetter Returns the current Monaco editor (or `null`
 *   when none is mounted).
 * @param opts         File-navigation + diagnostic hooks.
 * @returns Unsubscribe function. Safe to call more than once.
 */
export function wireCursorJump(
    editorGetter: EditorGetter,
    opts: WireCursorJumpOptions = {},
): () => void {
    return registerOnlookSelectHandler((msg) => {
        opts.onMessage?.(msg);
        const editor = editorGetter();
        jumpToSource(editor, msg.fileName, msg.lineNumber, msg.columnNumber, {
            onDifferentFile: opts.onDifferentFile,
        });
    });
}
