/**
 * Tests for useInstallDependencies — composed hook that bridges
 * usePackageJsonWatch + installDependencies.
 *
 * Since this workspace lacks @testing-library/react, the tests
 * focus on (a) smoke-rendering with various null-prop combinations
 * and (b) verifying the composition contract through the
 * underlying primitives (already covered individually in their own
 * test files).
 */
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { MobilePreviewVfs } from '@/services/mobile-preview';
import type { SandboxInstallClient } from '@/services/mobile-preview/dependency-install';

import { useInstallDependencies } from '../use-install-dependencies';

function nullClient(): SandboxInstallClient {
    return {
        async install() {
            return { ok: true, durationMs: 0 };
        },
    };
}

function nullVfs(): MobilePreviewVfs {
    return {
        async listAll() {
            return [];
        },
        async readFile() {
            return '';
        },
        watchDirectory() {
            return () => undefined;
        },
    };
}

describe('useInstallDependencies — smoke', () => {
    test('renders with both null (idle)', () => {
        function Probe() {
            const { status } = useInstallDependencies({
                fileSystem: null,
                client: null,
            });
            return <div data-testid="probe" data-kind={status.kind} />;
        }
        const markup = renderToStaticMarkup(<Probe />);
        expect(markup).toContain('data-kind="idle"');
    });

    test('renders with real vfs + client without throwing', () => {
        function Probe() {
            const { status } = useInstallDependencies({
                fileSystem: nullVfs(),
                client: nullClient(),
            });
            return <div data-testid="probe" data-kind={status.kind} />;
        }
        const markup = renderToStaticMarkup(<Probe />);
        expect(markup).toContain('data-kind="idle"');
    });

    test('exposes cancel function', () => {
        function Probe() {
            const { cancel } = useInstallDependencies({
                fileSystem: null,
                client: null,
            });
            return (
                <div
                    data-testid="probe"
                    data-has-cancel={typeof cancel === 'function' ? 'y' : 'n'}
                />
            );
        }
        const markup = renderToStaticMarkup(<Probe />);
        expect(markup).toContain('data-has-cancel="y"');
    });

    test('accepts fields override + maxRetries options', () => {
        // Type-check smoke — pass through every option.
        function Probe() {
            useInstallDependencies({
                fileSystem: null,
                client: null,
                fields: ['dependencies', 'devDependencies'],
                maxRetries: 3,
                onDiffDetected: (summary) => void summary,
            });
            return <div data-testid="probe" />;
        }
        const markup = renderToStaticMarkup(<Probe />);
        expect(markup).toContain('data-testid="probe"');
    });
});
