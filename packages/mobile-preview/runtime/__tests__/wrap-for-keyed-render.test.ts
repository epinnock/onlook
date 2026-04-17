import { describe, expect, it } from 'bun:test';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — CommonJS module, no .d.ts
import { wrapForKeyedRender } from '../wrap-for-keyed-render.js';

interface StubElement {
    type: unknown;
    props: Record<string, unknown>;
    key: string | null;
}

interface ReactStub {
    Fragment: symbol;
    createElement: (
        type: unknown,
        props: Record<string, unknown> | null,
        ...children: unknown[]
    ) => StubElement;
    cloneElement: (element: StubElement, overrides: Record<string, unknown>) => StubElement;
}

function createReactStub(): ReactStub {
    const Fragment = Symbol('React.Fragment');
    return {
        Fragment,
        createElement(type, props, ...children) {
            const flat = children.length === 1 ? children[0] : children;
            const mergedProps = { ...(props ?? {}), children: flat };
            return {
                type,
                props: mergedProps,
                key: (props && typeof props === 'object' && 'key' in props ? (props as Record<string, unknown>).key : null) as
                    | string
                    | null,
            };
        },
        cloneElement(element, overrides) {
            const { key: overrideKey, ...rest } = overrides;
            return {
                type: element.type,
                props: { ...element.props, ...rest },
                key: (overrideKey as string | undefined) ?? element.key,
            };
        },
    };
}

describe('wrapForKeyedRender', () => {
    it('wraps an unkeyed element in a Fragment and injects a sequence key', () => {
        const React = createReactStub();
        const input: StubElement = { type: 'View', props: { style: { flex: 1 } }, key: null };

        const wrapped = wrapForKeyedRender(React, input, 7);

        expect(wrapped.type).toBe(React.Fragment);
        const child = wrapped.props.children as StubElement;
        expect(child.type).toBe('View');
        expect(child.key).toBe('__onlook_render_7');
        expect(child.props.style).toEqual({ flex: 1 });
    });

    it('generates a distinct key per sequence so Fabric sees a new reactTag', () => {
        const React = createReactStub();
        const input: StubElement = { type: 'View', props: {}, key: null };

        const first = wrapForKeyedRender(React, input, 1);
        const second = wrapForKeyedRender(React, input, 2);

        const firstChild = first.props.children as StubElement;
        const secondChild = second.props.children as StubElement;
        expect(firstChild.key).toBe('__onlook_render_1');
        expect(secondChild.key).toBe('__onlook_render_2');
        expect(firstChild.key).not.toBe(secondChild.key);
    });

    it('preserves a caller-provided key instead of overwriting it', () => {
        const React = createReactStub();
        const input: StubElement = { type: 'View', props: {}, key: 'caller-key' };

        const wrapped = wrapForKeyedRender(React, input, 99);

        expect(wrapped.type).toBe(React.Fragment);
        const child = wrapped.props.children as StubElement;
        expect(child).toBe(input);
        expect(child.key).toBe('caller-key');
    });

    it('passes non-object elements (strings, numbers) through the Fragment unchanged', () => {
        const React = createReactStub();

        const withString = wrapForKeyedRender(React, 'hello', 1);
        expect(withString.type).toBe(React.Fragment);
        expect(withString.props.children).toBe('hello');

        const withNumber = wrapForKeyedRender(React, 42, 2);
        expect(withNumber.type).toBe(React.Fragment);
        expect(withNumber.props.children).toBe(42);
    });
});
