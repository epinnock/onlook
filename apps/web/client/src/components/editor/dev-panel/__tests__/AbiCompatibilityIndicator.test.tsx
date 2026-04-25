import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { AbiHelloMessage } from '@onlook/mobile-client-protocol';

import { AbiCompatibilityIndicator } from '../AbiCompatibilityIndicator';

function makeHello(): AbiHelloMessage {
    return {
        type: 'abiHello',
        abi: 'v1',
        sessionId: 'sess',
        role: 'phone',
        runtime: {
            abi: 'v1',
            baseHash: 'b'.repeat(64),
            rnVersion: '0.81.6',
            expoSdk: '54.0.0',
            platform: 'ios',
            aliases: ['react', 'react-native', 'expo'],
        },
    };
}

describe('AbiCompatibilityIndicator', () => {
    test('renders WAITING badge when state is "unknown"', () => {
        const html = renderToStaticMarkup(
            <AbiCompatibilityIndicator state="unknown" />,
        );
        expect(html).toContain('data-state="unknown"');
        expect(html).toContain('>WAITING<');
        expect(html).toContain('amber'); // amber tint class for waiting state
        // No reason line in the unknown state.
        expect(html).not.toContain('abi-compatibility-reason');
    });

    test('renders OK badge when state is "ok"', () => {
        const html = renderToStaticMarkup(
            <AbiCompatibilityIndicator state="ok" />,
        );
        expect(html).toContain('data-state="ok"');
        expect(html).toContain('>OK<');
        expect(html).toContain('emerald');
        expect(html).not.toContain('abi-compatibility-reason');
    });

    test('renders MISMATCH badge + kind+message reason when state is OnlookRuntimeError', () => {
        const html = renderToStaticMarkup(
            <AbiCompatibilityIndicator
                state={{ kind: 'abi-mismatch', message: 'phone running v0' }}
            />,
        );
        expect(html).toContain('data-state="mismatch"');
        expect(html).toContain('>MISMATCH<');
        expect(html).toContain('red'); // red tint for mismatch
        expect(html).toContain('abi-compatibility-reason');
        expect(html).toContain('abi-mismatch');
        expect(html).toContain('phone running v0');
    });

    test('hover title surfaces phone capabilities when state is "ok" and hello provided', () => {
        const html = renderToStaticMarkup(
            <AbiCompatibilityIndicator state="ok" phoneHello={makeHello()} />,
        );
        // The title attribute is HTML-encoded; check for fragments.
        expect(html).toContain('AbiHello handshake completed');
        expect(html).toContain('ios'); // platform
        expect(html).toContain('0.81.6'); // rnVersion
        expect(html).toContain('54.0.0'); // expoSdk
    });

    test('hover title explains the gate when state is "unknown"', () => {
        const html = renderToStaticMarkup(
            <AbiCompatibilityIndicator state="unknown" />,
        );
        expect(html).toContain('handshake has not completed');
        expect(html).toContain('fail-closed');
    });

    test('hover title surfaces error fix-it when state is mismatch', () => {
        const html = renderToStaticMarkup(
            <AbiCompatibilityIndicator
                state={{ kind: 'abi-mismatch', message: 'X' }}
            />,
        );
        expect(html).toContain('rebuild the phone binary');
    });

    test('non-abi-mismatch error gets generic fix-it', () => {
        const html = renderToStaticMarkup(
            <AbiCompatibilityIndicator
                state={{ kind: 'overlay-runtime', message: 'boom' }}
            />,
        );
        expect(html).toContain('see runtime error message');
    });

    test('"ok" without phoneHello still renders cleanly', () => {
        const html = renderToStaticMarkup(
            <AbiCompatibilityIndicator state="ok" phoneHello={null} />,
        );
        expect(html).toContain('Push gate is open');
        // Should NOT include capability lines without a hello.
        expect(html).not.toContain('aliases:');
    });

    test('accepts a className override on the outer wrapper', () => {
        const html = renderToStaticMarkup(
            <AbiCompatibilityIndicator
                state="ok"
                className="my-custom-class"
            />,
        );
        expect(html).toContain('my-custom-class');
    });
});
