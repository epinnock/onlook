import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { DependencyInstallStatus } from '@/services/mobile-preview/dependency-install';

import { InstallStatusIndicator } from '../InstallStatusIndicator';

describe('InstallStatusIndicator', () => {
    test('idle → renders nothing (no UI noise)', () => {
        const markup = renderToStaticMarkup(
            <InstallStatusIndicator status={{ kind: 'idle' }} />,
        );
        expect(markup).toBe('');
    });

    test('installing with single specifier shows its name', () => {
        const markup = renderToStaticMarkup(
            <InstallStatusIndicator
                status={{
                    kind: 'installing',
                    specifiers: ['lodash'],
                }}
            />,
        );
        expect(markup).toContain('Installing: lodash');
        expect(markup).toContain('animate-pulse');
    });

    test('installing with multiple specifiers shows count', () => {
        const markup = renderToStaticMarkup(
            <InstallStatusIndicator
                status={{
                    kind: 'installing',
                    specifiers: ['a', 'b', 'c'],
                }}
            />,
        );
        expect(markup).toContain('Installing: 3 packages');
    });

    test('installing shows Cancel button when onCancel provided', () => {
        const markup = renderToStaticMarkup(
            <InstallStatusIndicator
                status={{ kind: 'installing', specifiers: ['a'] }}
                onCancel={() => undefined}
            />,
        );
        expect(markup).toContain('install-status-cancel');
        expect(markup).toContain('Cancel');
    });

    test('installing without onCancel omits the button', () => {
        const markup = renderToStaticMarkup(
            <InstallStatusIndicator
                status={{ kind: 'installing', specifiers: ['a'] }}
            />,
        );
        expect(markup).not.toContain('install-status-cancel');
    });

    test('ready shows duration rounded to integer ms', () => {
        const markup = renderToStaticMarkup(
            <InstallStatusIndicator
                status={{
                    kind: 'ready',
                    specifiers: ['lodash'],
                    durationMs: 1234.7,
                    retryCount: 0,
                }}
            />,
        );
        expect(markup).toContain('Installed: lodash');
        expect(markup).toContain('1235ms');
    });

    test('failed shows error message and Retry button', () => {
        const markup = renderToStaticMarkup(
            <InstallStatusIndicator
                status={{
                    kind: 'failed',
                    specifiers: ['lodash'],
                    error: 'network timeout',
                    durationMs: 5000,
                    retryCount: 2,
                }}
                onRetry={() => undefined}
            />,
        );
        expect(markup).toContain('Install failed: lodash');
        expect(markup).toContain('network timeout');
        expect(markup).toContain('install-status-retry');
        expect(markup).toContain('Retry');
    });

    test('failed without onRetry omits the button', () => {
        const markup = renderToStaticMarkup(
            <InstallStatusIndicator
                status={{
                    kind: 'failed',
                    specifiers: ['a'],
                    error: 'x',
                    durationMs: 0,
                    retryCount: 0,
                }}
            />,
        );
        expect(markup).not.toContain('install-status-retry');
    });

    test('data-kind attribute matches the status.kind for e2e probing', () => {
        const statuses: Array<Exclude<DependencyInstallStatus, { kind: 'idle' }>> = [
            { kind: 'installing', specifiers: ['a'] },
            {
                kind: 'ready',
                specifiers: ['a'],
                durationMs: 100,
                retryCount: 0,
            },
            {
                kind: 'failed',
                specifiers: ['a'],
                error: 'e',
                durationMs: 100,
                retryCount: 0,
            },
        ];
        for (const s of statuses) {
            const markup = renderToStaticMarkup(
                <InstallStatusIndicator status={s} />,
            );
            expect(markup).toContain(`data-kind="${s.kind}"`);
        }
    });

    test('className prop composes with default styling', () => {
        const markup = renderToStaticMarkup(
            <InstallStatusIndicator
                status={{ kind: 'installing', specifiers: ['a'] }}
                className="custom-indicator-class"
            />,
        );
        expect(markup).toContain('custom-indicator-class');
    });

    test('dot color differs by kind', () => {
        const installing = renderToStaticMarkup(
            <InstallStatusIndicator
                status={{ kind: 'installing', specifiers: ['a'] }}
            />,
        );
        const ready = renderToStaticMarkup(
            <InstallStatusIndicator
                status={{
                    kind: 'ready',
                    specifiers: ['a'],
                    durationMs: 10,
                    retryCount: 0,
                }}
            />,
        );
        const failed = renderToStaticMarkup(
            <InstallStatusIndicator
                status={{
                    kind: 'failed',
                    specifiers: ['a'],
                    error: 'e',
                    durationMs: 10,
                    retryCount: 0,
                }}
            />,
        );
        expect(installing).toContain('bg-blue-500');
        expect(ready).toContain('bg-emerald-500');
        expect(failed).toContain('bg-red-500');
    });
});
