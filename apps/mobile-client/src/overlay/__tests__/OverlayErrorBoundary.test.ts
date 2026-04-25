/**
 * Unit tests for OverlayErrorBoundary's lifecycle logic. Rather than pulling
 * in react-test-renderer (heavy, would need to be added as a dev dep just for
 * this), we drive the class methods directly: this is a thin error boundary,
 * and its entire observable behaviour lives in the three lifecycle hooks.
 */

import { describe, expect, mock, test } from 'bun:test';
import React from 'react';

import { OverlayErrorBoundary } from '../OverlayErrorBoundary';

type BoundaryState = { hasError: boolean };

describe('OverlayErrorBoundary', () => {
    test('getDerivedStateFromError flips hasError to true', () => {
        const next = (
            OverlayErrorBoundary as unknown as {
                getDerivedStateFromError: (e: Error) => BoundaryState;
            }
        ).getDerivedStateFromError(new Error('boom'));
        expect(next).toEqual({ hasError: true });
    });

    test('render returns children when hasError is false', () => {
        const child = React.createElement('safe', null, 'hi');
        const instance = new OverlayErrorBoundary({ children: child });
        // Freshly-constructed boundary starts clean.
        expect(instance.state).toEqual({ hasError: false });
        const out = instance.render();
        expect(out).toBe(child);
    });

    test('render returns null when hasError is true', () => {
        const child = React.createElement('safe', null, 'hi');
        const instance = new OverlayErrorBoundary({ children: child });
        instance.state = { hasError: true };
        expect(instance.render()).toBeNull();
    });

    test('componentDidCatch forwards the error to onError callback', () => {
        const onError = mock((_: Error) => {});
        const child = React.createElement('safe', null);
        const instance = new OverlayErrorBoundary({ children: child, onError });
        const err = new Error('overlay boom');
        instance.componentDidCatch(err);
        expect(onError).toHaveBeenCalledTimes(1);
        const call = onError.mock.calls[0] ?? [];
        expect((call[0] as Error).message).toBe('overlay boom');
    });

    test('componentDidCatch is a no-op when no onError prop is given', () => {
        const child = React.createElement('safe', null);
        const instance = new OverlayErrorBoundary({ children: child });
        // Should not throw.
        expect(() => instance.componentDidCatch(new Error('x'))).not.toThrow();
    });

    test('componentDidUpdate resets hasError when children identity changes', () => {
        const oldChild = React.createElement('old', null);
        const newChild = React.createElement('new', null);
        const instance = new OverlayErrorBoundary({ children: newChild });
        instance.state = { hasError: true };
        let nextState: BoundaryState | null = null;
        instance.setState = ((s: BoundaryState) => {
            nextState = s;
        }) as typeof instance.setState;
        instance.componentDidUpdate({ children: oldChild });
        expect(nextState).toEqual({ hasError: false });
    });

    test('componentDidUpdate does not reset when children are identical', () => {
        const child = React.createElement('same', null);
        const instance = new OverlayErrorBoundary({ children: child });
        instance.state = { hasError: true };
        let called = false;
        instance.setState = (() => {
            called = true;
        }) as typeof instance.setState;
        instance.componentDidUpdate({ children: child });
        expect(called).toBe(false);
    });

    test('componentDidUpdate does not reset when hasError is already false', () => {
        const oldChild = React.createElement('old', null);
        const newChild = React.createElement('new', null);
        const instance = new OverlayErrorBoundary({ children: newChild });
        instance.state = { hasError: false };
        let called = false;
        instance.setState = (() => {
            called = true;
        }) as typeof instance.setState;
        instance.componentDidUpdate({ children: oldChild });
        expect(called).toBe(false);
    });
});
