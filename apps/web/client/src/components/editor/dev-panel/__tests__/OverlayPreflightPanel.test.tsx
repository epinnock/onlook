import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { AbiV1PreflightIssue } from '@onlook/browser-bundler';

import { formatPreflightSummary } from '@/services/expo-relay/preflight-formatter';

import {
    OverlayPreflightIssueRow,
    OverlayPreflightPanel,
} from '../OverlayPreflightPanel';

function nativeIssue(
    spec: string,
    file = 'src/App.tsx',
): AbiV1PreflightIssue {
    return { kind: 'unsupported-native', specifier: spec, filePath: file };
}

function unknownIssue(
    spec: string,
    file = 'src/App.tsx',
): AbiV1PreflightIssue {
    return { kind: 'unknown-specifier', specifier: spec, filePath: file };
}

describe('OverlayPreflightIssueRow', () => {
    test('renders a native-kind row with red badge + specifier + file', () => {
        const markup = renderToStaticMarkup(
            <OverlayPreflightIssueRow issue={nativeIssue('react-native-video', 'src/Player.tsx')} />,
        );
        expect(markup).toContain('data-testid="overlay-preflight-row"');
        expect(markup).toContain('data-kind="unsupported-native"');
        expect(markup).toContain('NATIVE');
        expect(markup).toContain('red-500/25');
        expect(markup).toContain('react-native-video');
        expect(markup).toContain('src/Player.tsx');
    });

    test('renders an unknown-kind row with amber badge', () => {
        const markup = renderToStaticMarkup(
            <OverlayPreflightIssueRow issue={unknownIssue('some-pkg')} />,
        );
        expect(markup).toContain('data-kind="unknown-specifier"');
        expect(markup).toContain('UNKNOWN');
        expect(markup).toContain('amber-500/25');
        expect(markup).toContain('some-pkg');
    });
});

describe('OverlayPreflightPanel', () => {
    test('renders empty-state when summary is null', () => {
        const markup = renderToStaticMarkup(<OverlayPreflightPanel summary={null} />);
        expect(markup).toContain('data-testid="overlay-preflight-empty"');
        expect(markup).toContain('No unsupported imports detected');
    });

    test('renders native section with header + one row per issue', () => {
        const summary = formatPreflightSummary([
            nativeIssue('react-native-video', 'src/A.tsx'),
            nativeIssue('react-native-webrtc', 'src/B.tsx'),
        ]);
        const markup = renderToStaticMarkup(<OverlayPreflightPanel summary={summary} />);
        expect(markup).toContain('data-testid="overlay-preflight-panel"');
        expect(markup).toContain('data-testid="overlay-preflight-title"');
        expect(markup).toContain('Unsupported native module(s)');
        expect(markup).toContain('2 issues');
        const rowCount = (markup.match(/overlay-preflight-row/g) ?? []).length;
        expect(rowCount).toBe(2);
        expect(markup).toContain('data-testid="overlay-preflight-section-native"');
        expect(markup).not.toContain('data-testid="overlay-preflight-section-unknown"');
    });

    test('renders unknown section when only unknown issues present', () => {
        const summary = formatPreflightSummary([unknownIssue('random-pkg')]);
        const markup = renderToStaticMarkup(<OverlayPreflightPanel summary={summary} />);
        expect(markup).toContain('Unknown bare import(s)');
        expect(markup).toContain('1 issue');
        expect(markup).toContain('data-testid="overlay-preflight-section-unknown"');
        expect(markup).not.toContain('data-testid="overlay-preflight-section-native"');
    });

    test('renders both sections when kinds mix; native takes header precedence', () => {
        const summary = formatPreflightSummary([
            unknownIssue('foo'),
            nativeIssue('bar'),
            unknownIssue('baz'),
        ]);
        const markup = renderToStaticMarkup(<OverlayPreflightPanel summary={summary} />);
        expect(markup).toContain('Unsupported native module(s)'); // header
        expect(markup).toContain('3 issues');
        expect(markup).toContain('data-testid="overlay-preflight-section-native"');
        expect(markup).toContain('data-testid="overlay-preflight-section-unknown"');
        const rowCount = (markup.match(/overlay-preflight-row/g) ?? []).length;
        expect(rowCount).toBe(3);
    });

    test('singular label when exactly 1 issue', () => {
        const summary = formatPreflightSummary([nativeIssue('only-one')]);
        const markup = renderToStaticMarkup(<OverlayPreflightPanel summary={summary} />);
        expect(markup).toContain('1 issue');
        expect(markup).not.toContain('1 issues');
    });

    test('outer class prop composes with defaults', () => {
        const markup = renderToStaticMarkup(
            <OverlayPreflightPanel summary={null} className="custom-class" />,
        );
        expect(markup).toContain('custom-class');
    });

    test('includes the fix-suggestion description for native section', () => {
        const summary = formatPreflightSummary([nativeIssue('rn-module')]);
        const markup = renderToStaticMarkup(<OverlayPreflightPanel summary={summary} />);
        expect(markup).toContain('needs native code');
    });
});
