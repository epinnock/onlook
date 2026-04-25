/**
 * Tests for reportOverlayBoundaryError — the pure helper that OverlayHost
 * wires as the error-boundary's onError handler. Routes React error-boundary
 * catches through `OnlookRuntime.reportError` so the editor's ack-tracking
 * loop sees overlay React errors as 'failed' status.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';

// Short-circuit react-native — the OverlayHost import chain pulls it in, but
// reportOverlayBoundaryError is a pure helper that only touches globalThis.
mock.module('react-native', () => ({
    View: () => null,
    StyleSheet: { create: (s: Record<string, unknown>) => s },
}));

const { reportOverlayBoundaryError } = (await import('../OverlayHost')) as typeof import(
    '../OverlayHost'
);

type CapturedError = {
    kind: string;
    message: string;
    stack?: string;
};

type MockRuntime = {
    reportError?: (err: CapturedError) => void;
};

const origRuntime = (globalThis as { OnlookRuntime?: MockRuntime }).OnlookRuntime;
afterEach(() => {
    (globalThis as { OnlookRuntime?: MockRuntime }).OnlookRuntime = origRuntime;
});

describe('reportOverlayBoundaryError', () => {
    test('forwards error to OnlookRuntime.reportError as kind="overlay-react"', () => {
        const captured: CapturedError[] = [];
        (globalThis as { OnlookRuntime?: MockRuntime }).OnlookRuntime = {
            reportError: (e) => captured.push(e),
        };

        const err = new Error('boom in render');
        reportOverlayBoundaryError(err);

        expect(captured).toHaveLength(1);
        expect(captured[0]?.kind).toBe('overlay-react');
        expect(captured[0]?.message).toBe('boom in render');
        expect(captured[0]?.stack).toBeDefined();
    });

    test('is a silent no-op when OnlookRuntime is absent', () => {
        (globalThis as { OnlookRuntime?: MockRuntime }).OnlookRuntime = undefined;
        expect(() => reportOverlayBoundaryError(new Error('x'))).not.toThrow();
    });

    test('is a silent no-op when OnlookRuntime has no reportError', () => {
        (globalThis as { OnlookRuntime?: MockRuntime }).OnlookRuntime = {};
        expect(() => reportOverlayBoundaryError(new Error('x'))).not.toThrow();
    });

    test('swallows errors thrown BY the reportError sink (never takes down host)', () => {
        (globalThis as { OnlookRuntime?: MockRuntime }).OnlookRuntime = {
            reportError: () => {
                throw new Error('sink exploded');
            },
        };
        expect(() => reportOverlayBoundaryError(new Error('x'))).not.toThrow();
    });

    test('stack is undefined when the Error has no stack (e.g. synthesized)', () => {
        const captured: CapturedError[] = [];
        (globalThis as { OnlookRuntime?: MockRuntime }).OnlookRuntime = {
            reportError: (e) => captured.push(e),
        };
        const err = new Error('no stack');
        // Force stack off to simulate a stripped error (some RN setups do this).
        Object.defineProperty(err, 'stack', { value: undefined });
        reportOverlayBoundaryError(err);
        expect(captured[0]?.stack).toBeUndefined();
    });

    test('reportError receives a fresh object per call (no shared payload)', () => {
        const captured: CapturedError[] = [];
        const runtime: MockRuntime = {
            reportError: (e) => captured.push(e),
        };
        (globalThis as { OnlookRuntime?: MockRuntime }).OnlookRuntime = runtime;
        reportOverlayBoundaryError(new Error('a'));
        reportOverlayBoundaryError(new Error('b'));
        expect(captured).toHaveLength(2);
        expect(captured[0]?.message).toBe('a');
        expect(captured[1]?.message).toBe('b');
        // Different objects (not aliased).
        expect(captured[0]).not.toBe(captured[1]);
    });
});
