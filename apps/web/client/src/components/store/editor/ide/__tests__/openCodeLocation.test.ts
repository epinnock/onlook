/**
 * Focused tests for IdeManager.openCodeLocation — the file+line+column
 * navigation path added in 9eda7ddb to drive tap-to-source from phone
 * taps. Bypasses the OID metadata lookup `openCodeBlock` performs.
 *
 * Stub-engine strategy: openCodeLocation only touches
 *   - this._codeNavigationOverride (private field, observed via the
 *     `codeNavigationOverride` getter)
 *   - this.editorEngine.state.editorMode (writable enum field)
 *
 * The `branches` field on EditorEngine is reachable from `openCodeBlock`
 * but NEVER reached by `openCodeLocation`, so we don't stub it. A minimal
 * `{state: {editorMode}}` engine stub is enough.
 */
import { describe, expect, test } from 'bun:test';
import { EditorMode } from '@onlook/models';

import { IdeManager } from '../index';

// Class-based stub — `makeAutoObservable(this)` inside IdeManager
// observes the `editorEngine` reference. When the engine is a plain
// object literal, MobX may snapshot its `state` field on first access
// and the IdeManager's writes route to the snapshot rather than back
// to the test's reference. A class instance works around this because
// MobX leaves non-decorated class instances alone — its non-observable
// internal state stays addressable through the original reference.
class StubEngine {
    state = { editorMode: EditorMode.DESIGN };
}

function makeIdeManager(): { ide: IdeManager; engine: StubEngine } {
    const engine = new StubEngine();
    // The constructor signature takes an `EditorEngine`, but at runtime
    // `openCodeLocation` only touches `state.editorMode`. Cast through
    // `unknown` to satisfy TS without pulling in the heavy real engine.
    const ide = new IdeManager(engine as unknown as ConstructorParameters<typeof IdeManager>[0]);
    return { ide, engine };
}

describe('IdeManager.openCodeLocation', () => {
    test('sets _codeNavigationOverride to a zero-length range at the position', () => {
        const { ide } = makeIdeManager();
        ide.openCodeLocation('src/App.tsx', 24, 8);
        const target = ide.codeNavigationOverride;
        expect(target).not.toBeNull();
        if (target === null) return;
        expect(target.filePath).toBe('src/App.tsx');
        expect(target.range.start).toEqual({ line: 24, column: 8 });
        expect(target.range.end).toEqual({ line: 24, column: 8 });
    });

    test('switches editorMode to CODE', () => {
        const { ide, engine } = makeIdeManager();
        expect(engine.state.editorMode).toBe(EditorMode.DESIGN);
        ide.openCodeLocation('src/App.tsx', 1, 0);
        expect(engine.state.editorMode).toBe(EditorMode.CODE);
    });

    test('hasCodeNavigationOverride flips to true after a successful call', () => {
        const { ide } = makeIdeManager();
        expect(ide.hasCodeNavigationOverride()).toBe(false);
        ide.openCodeLocation('src/App.tsx', 5, 3);
        expect(ide.hasCodeNavigationOverride()).toBe(true);
    });

    test('clearCodeNavigationOverride resets the override to null', () => {
        const { ide } = makeIdeManager();
        ide.openCodeLocation('src/App.tsx', 5, 3);
        expect(ide.hasCodeNavigationOverride()).toBe(true);
        ide.clearCodeNavigationOverride();
        expect(ide.hasCodeNavigationOverride()).toBe(false);
        expect(ide.codeNavigationOverride).toBeNull();
    });

    test('rejects empty fileName — does not set override or change editorMode', () => {
        const { ide, engine } = makeIdeManager();
        ide.openCodeLocation('', 1, 0);
        expect(ide.codeNavigationOverride).toBeNull();
        expect(engine.state.editorMode).toBe(EditorMode.DESIGN);
    });

    test('rejects lineNumber <= 0 — does not set override', () => {
        const { ide, engine } = makeIdeManager();
        ide.openCodeLocation('a.tsx', 0, 0);
        expect(ide.codeNavigationOverride).toBeNull();
        ide.openCodeLocation('a.tsx', -5, 0);
        expect(ide.codeNavigationOverride).toBeNull();
        expect(engine.state.editorMode).toBe(EditorMode.DESIGN);
    });

    test('rejects negative columnNumber — does not set override', () => {
        const { ide, engine } = makeIdeManager();
        ide.openCodeLocation('a.tsx', 1, -1);
        expect(ide.codeNavigationOverride).toBeNull();
        expect(engine.state.editorMode).toBe(EditorMode.DESIGN);
    });

    test('accepts columnNumber === 0 (start of line)', () => {
        const { ide } = makeIdeManager();
        ide.openCodeLocation('a.tsx', 1, 0);
        expect(ide.codeNavigationOverride).not.toBeNull();
        expect(ide.codeNavigationOverride?.range.start.column).toBe(0);
    });

    test('repeated calls overwrite the prior target (last-write-wins)', () => {
        const { ide } = makeIdeManager();
        ide.openCodeLocation('a.tsx', 1, 0);
        ide.openCodeLocation('b.tsx', 99, 5);
        expect(ide.codeNavigationOverride?.filePath).toBe('b.tsx');
        expect(ide.codeNavigationOverride?.range.start.line).toBe(99);
    });
});
