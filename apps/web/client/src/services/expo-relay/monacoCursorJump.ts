/**
 * Monaco cursor-jump helper (MC4.17).
 *
 * Consumer-side glue that takes a normalized `OnlookSelectMessage`
 * (delivered by MC4.15's `onlookSelectReceiver`) and moves the Monaco
 * editor cursor to the tapped source location. When the target file
 * differs from the file Monaco currently shows, we defer to the
 * editor's existing navigation mechanism — `IdeManager` exposes a
 * `_codeNavigationOverride` driven by `openCodeBlock(...)`; the
 * receiver glue in `wireCursorJump.ts` is responsible for invoking
 * that path. This module only handles the in-editor move.
 *
 * Kept deliberately free of any Monaco import: during the CodeMirror
 * → Monaco migration the editor object is not yet available at this
 * layer. Typing the editor structurally means callers can hand us
 * either the real `monaco.editor.IStandaloneCodeEditor` or a test
 * double without `any` leaking through the boundary (see CLAUDE.md
 * "DO NOT use any type unless necessary").
 */

/**
 * Structural subset of `monaco.editor.IStandaloneCodeEditor` we rely
 * on. We intentionally keep this narrow: each method corresponds to a
 * single call site below, which makes the test double trivial and
 * keeps us honest about new Monaco API dependencies.
 */
export interface MonacoLikeEditor {
    /** `monaco.IPosition` uses 1-indexed lines and columns. */
    setPosition(position: { lineNumber: number; column: number }): void;
    /** Scrolls the target line to the vertical center of the viewport. */
    revealLineInCenter(lineNumber: number): void;
    /**
     * Optional: returns the path of the file currently shown. When
     * omitted, callers treat the jump as same-file (no navigation).
     * Monaco itself exposes `getModel()?.uri.path`; in tests we
     * expose a simpler string getter so the fake stays small.
     */
    getCurrentFileName?(): string | null;
    /** Optional focus hook so the keyboard caret is visible after jump. */
    focus?(): void;
}

/**
 * Optional navigator invoked when the target file differs from the
 * one Monaco currently shows. The caller wires this to
 * `editorEngine.ide.openCodeBlock(...)` or a similar route-level
 * action. We keep this as a callback rather than importing the store
 * directly so the helper stays free of app globals and remains
 * unit-testable without MobX.
 */
export type FileNavigator = (fileName: string) => void;

/**
 * Options surface. Splitting the navigator out (instead of putting it
 * on the editor) lets `wireCursorJump` pass both sides without
 * mutating the editor instance.
 */
export interface JumpToSourceOptions {
    /**
     * Invoked when the jump target lives in a file other than the one
     * Monaco currently shows. Optional — if omitted, we fall through
     * to the local `setPosition` call (still useful in tests and in
     * the early MC4.17 wiring where only a single file is open).
     */
    onDifferentFile?: FileNavigator;
}

/**
 * Move the Monaco cursor to the given source location.
 *
 * Behaviour:
 *   1. Normalize the `column` so a 0-based input from the mobile
 *      client maps to Monaco's 1-based column. Lines on both sides
 *      are 1-indexed so no adjustment is needed.
 *   2. If `getCurrentFileName()` is available and disagrees with
 *      `fileName`, fire the `onDifferentFile` navigator (MC4.17 hooks
 *      it to `openCodeBlock`). We still call `setPosition` /
 *      `revealLineInCenter` afterwards: Monaco may already have the
 *      other file's model loaded in memory and accept the move, and
 *      when it does not the call is a harmless no-op.
 *   3. `revealLineInCenter` before `setPosition` flashes visibly;
 *      setting the caret first keeps the reveal animation anchored.
 *   4. `focus()` is best-effort — only called when the editor exposes
 *      it, since tests often supply a minimal fake.
 *
 * Invalid inputs (missing editor, non-positive line, etc.) return
 * without throwing. A bad `select` event must never crash the host.
 */
export function jumpToSource(
    editor: MonacoLikeEditor | null | undefined,
    fileName: string,
    line: number,
    column: number,
    opts: JumpToSourceOptions = {},
): void {
    if (editor === null || editor === undefined) return;
    if (typeof fileName !== 'string' || fileName.length === 0) return;
    if (!Number.isFinite(line) || line <= 0) return;
    if (!Number.isFinite(column) || column < 0) return;

    // Mobile client sends 0-based columns (`TapHandler` MC4.14), Monaco
    // is 1-based. Clamp to 1 so a `column: 0` does not become an
    // invalid `column: 0` on Monaco's side.
    const monacoColumn = Math.max(1, Math.floor(column) + 1);
    const monacoLine = Math.floor(line);

    // File-level navigation: fire when we can prove the file differs.
    // When `getCurrentFileName` is not exposed we skip the check —
    // doing otherwise would call `onDifferentFile` on every jump in
    // simple setups (tests, single-file early MC4.17 wiring).
    if (typeof editor.getCurrentFileName === 'function') {
        const current = editor.getCurrentFileName();
        if (typeof current === 'string' && current !== fileName) {
            opts.onDifferentFile?.(fileName);
        }
    }

    try {
        editor.setPosition({ lineNumber: monacoLine, column: monacoColumn });
        editor.revealLineInCenter(monacoLine);
        editor.focus?.();
    } catch {
        // Monaco throws synchronously when the model is disposed mid-jump.
        // Swallow: the user will tap again, and we prefer a no-op to a
        // crashed host window.
    }
}
