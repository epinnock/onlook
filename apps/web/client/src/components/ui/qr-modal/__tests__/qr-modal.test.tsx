/**
 * Tests for QrModal / QrModalBody (TQ3.1).
 *
 * We render the portal-free `QrModalBody` subtree via React's
 * `renderToStaticMarkup` because neither `@testing-library/react` nor a
 * DOM (jsdom/happy-dom) are available in this workspace. The assertions
 * target data-testid markers + substrings so they're robust to class
 * name churn.
 */

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { QrModalBody, type QrModalStatus } from '../index';

function render(status: QrModalStatus, onRetry?: () => void): string {
    return renderToStaticMarkup(
        <QrModalBody status={status} onRetry={onRetry} />,
    );
}

describe('QrModalBody', () => {
    test('status=idle renders idle copy', () => {
        const html = render({ kind: 'idle' });
        expect(html).toContain('data-testid="qr-status-idle"');
        expect(html).toContain('Preview on device');
    });

    test('status=preparing renders preparing copy', () => {
        const html = render({ kind: 'preparing' });
        expect(html).toContain('data-testid="qr-status-preparing"');
        expect(html).toContain('Preparing project source');
    });

    test('status=building renders bundling copy', () => {
        const html = render({ kind: 'building' });
        expect(html).toContain('data-testid="qr-status-building"');
        expect(html).toContain('Bundling for Expo Go');
    });

    test('status=ready renders QR svg, manifest URL, and copy button', () => {
        const svg = '<svg data-test-qr="1"><rect/></svg>';
        const manifestUrl =
            'https://cf-expo-relay.example.workers.dev/manifest/' +
            'a'.repeat(64);
        const html = render({ kind: 'ready', manifestUrl, qrSvg: svg });
        expect(html).toContain('data-testid="qr-svg-wrapper"');
        // The svg should be inlined via dangerouslySetInnerHTML.
        expect(html).toContain('data-test-qr="1"');
        expect(html).toContain('data-testid="qr-manifest-url"');
        expect(html).toContain(manifestUrl);
        expect(html).toContain('data-testid="qr-copy-btn"');
        expect(html).toContain('Copy URL');
    });

    test('status=error with onRetry renders error + retry button', () => {
        const html = render(
            { kind: 'error', message: 'boom' },
            () => undefined,
        );
        expect(html).toContain('data-testid="qr-status-error"');
        expect(html).toContain('Error: boom');
        expect(html).toContain('data-testid="qr-retry-btn"');
        expect(html).toContain('Retry');
    });

    test('status=error without onRetry omits retry button', () => {
        const html = render({ kind: 'error', message: 'nope' });
        expect(html).toContain('data-testid="qr-status-error"');
        expect(html).toContain('Error: nope');
        expect(html).not.toContain('data-testid="qr-retry-btn"');
    });
});
