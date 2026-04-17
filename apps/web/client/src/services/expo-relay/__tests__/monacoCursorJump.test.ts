/**
 * MC4.17 unit tests.
 *
 * Covers `jumpToSource` (pure helper) and `wireCursorJump` (receiver
 * glue). Tests supply a minimal `MonacoLikeEditor` fake to avoid
 * loading Monaco — the production Monaco module is ~2 MB of JS and
 * the pieces we use (`setPosition`, `revealLineInCenter`) are
 * trivially re-describable.
 */

import { afterEach, describe, expect, mock, test } from 'bun:test';

import {
    __resetOnlookSelectReceiverForTests,
    dispatchOnlookSelect,
} from '../onlookSelectReceiver';
import { jumpToSource, type MonacoLikeEditor } from '../monacoCursorJump';
import { wireCursorJump } from '../wireCursorJump';

afterEach(() => {
    __resetOnlookSelectReceiverForTests();
});

/**
 * Factory for a minimal editor fake. Spies record every call so
 * assertions stay readable even for sequence-sensitive cases
 * (setPosition must precede revealLineInCenter, etc.).
 */
function makeFakeEditor(currentFileName: string | null = 'src/app/page.tsx') {
    const setPosition = mock<MonacoLikeEditor['setPosition']>(() => {});
    const revealLineInCenter = mock<MonacoLikeEditor['revealLineInCenter']>(() => {});
    const focus = mock<() => void>(() => {});
    const getCurrentFileName = mock<() => string | null>(() => currentFileName);
    const editor: MonacoLikeEditor = {
        setPosition,
        revealLineInCenter,
        focus,
        getCurrentFileName,
    };
    return { editor, setPosition, revealLineInCenter, focus, getCurrentFileName };
}

describe('jumpToSource', () => {
    test('moves the cursor and reveals the target line', () => {
        const { editor, setPosition, revealLineInCenter, focus } = makeFakeEditor();

        jumpToSource(editor, 'src/app/page.tsx', 12, 4);

        // Monaco uses 1-based columns; 0-based input `4` becomes `5`.
        expect(setPosition).toHaveBeenCalledTimes(1);
        expect(setPosition).toHaveBeenCalledWith({ lineNumber: 12, column: 5 });
        expect(revealLineInCenter).toHaveBeenCalledTimes(1);
        expect(revealLineInCenter).toHaveBeenCalledWith(12);
        expect(focus).toHaveBeenCalledTimes(1);
    });

    test('fires onDifferentFile when the target file differs from the current one', () => {
        const { editor } = makeFakeEditor('src/app/other.tsx');
        const onDifferentFile = mock<(fileName: string) => void>(() => {});

        jumpToSource(editor, 'src/app/page.tsx', 3, 0, { onDifferentFile });

        expect(onDifferentFile).toHaveBeenCalledTimes(1);
        expect(onDifferentFile).toHaveBeenCalledWith('src/app/page.tsx');
    });

    test('does not fire onDifferentFile when the file already matches', () => {
        const { editor } = makeFakeEditor('src/app/page.tsx');
        const onDifferentFile = mock<(fileName: string) => void>(() => {});

        jumpToSource(editor, 'src/app/page.tsx', 7, 2, { onDifferentFile });

        expect(onDifferentFile).not.toHaveBeenCalled();
    });

    test('is a no-op on null editor or invalid position', () => {
        const onDifferentFile = mock<(fileName: string) => void>(() => {});

        // null editor: must not throw, must not call navigator
        jumpToSource(null, 'src/app/page.tsx', 1, 0, { onDifferentFile });
        // non-positive line
        const { editor, setPosition } = makeFakeEditor();
        jumpToSource(editor, 'src/app/page.tsx', 0, 0);
        // negative column
        jumpToSource(editor, 'src/app/page.tsx', 5, -1);
        // empty filename
        jumpToSource(editor, '', 5, 0);

        expect(onDifferentFile).not.toHaveBeenCalled();
        expect(setPosition).not.toHaveBeenCalled();
    });

    test('swallows Monaco exceptions so a disposed model does not crash the host', () => {
        const setPosition = mock<MonacoLikeEditor['setPosition']>(() => {
            throw new Error('model disposed');
        });
        const revealLineInCenter = mock<MonacoLikeEditor['revealLineInCenter']>(() => {});
        const editor: MonacoLikeEditor = { setPosition, revealLineInCenter };

        expect(() => jumpToSource(editor, 'src/app/page.tsx', 1, 0)).not.toThrow();
    });
});

describe('wireCursorJump', () => {
    test('routes dispatched select messages to jumpToSource via the editor getter', () => {
        const { editor, setPosition, revealLineInCenter } = makeFakeEditor('src/app/page.tsx');

        const unsubscribe = wireCursorJump(() => editor);

        dispatchOnlookSelect({
            type: 'onlook:select',
            source: {
                fileName: 'src/app/page.tsx',
                lineNumber: 9,
                columnNumber: 3,
            },
            timestamp: 1_700_000_000_000,
        });

        expect(setPosition).toHaveBeenCalledWith({ lineNumber: 9, column: 4 });
        expect(revealLineInCenter).toHaveBeenCalledWith(9);

        unsubscribe();
    });

    test('unsubscribe stops further dispatches from firing the handler', () => {
        const { editor, setPosition } = makeFakeEditor();

        const unsubscribe = wireCursorJump(() => editor);
        unsubscribe();

        dispatchOnlookSelect({
            type: 'onlook:select',
            source: { fileName: 'src/app/page.tsx', lineNumber: 1, columnNumber: 0 },
        });

        expect(setPosition).not.toHaveBeenCalled();
    });

    test('tolerates a null editor from the getter (route transitions)', () => {
        const onMessage = mock<() => void>(() => {});

        const unsubscribe = wireCursorJump(() => null, { onMessage });

        expect(() =>
            dispatchOnlookSelect({
                type: 'onlook:select',
                source: { fileName: 'src/app/page.tsx', lineNumber: 1, columnNumber: 0 },
            }),
        ).not.toThrow();
        // The receiver still saw the message even though no editor was available.
        expect(onMessage).toHaveBeenCalledTimes(1);

        unsubscribe();
    });
});
