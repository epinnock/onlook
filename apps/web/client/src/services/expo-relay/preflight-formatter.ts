/**
 * Preflight error formatter — task #81.
 *
 * Turns `AbiV1PreflightIssue[]` from `preflightAbiV1Imports` into user-facing
 * error summaries suitable for rendering in editor status UI (toast, banner,
 * error panel). Intentionally plain text — callers can split into lines and
 * decorate per their UI framework.
 */
import type { AbiV1PreflightIssue } from '@onlook/browser-bundler';

export interface PreflightSummary {
    /** Opaque header line. */
    readonly title: string;
    /** One line per unique issue. */
    readonly lines: readonly string[];
    /** The `error` kind pack for programmatic callers. */
    readonly byKind: Readonly<
        Record<AbiV1PreflightIssue['kind'], readonly AbiV1PreflightIssue[]>
    >;
}

const TITLES: Record<AbiV1PreflightIssue['kind'], string> = {
    'unsupported-native': 'Unsupported native module(s) in overlay',
    'unknown-specifier': 'Unknown bare import(s) in overlay',
};

/**
 * Format issues into a human-readable summary. Empty issue list → `null` (no
 * error state to render).
 */
export function formatPreflightSummary(
    issues: readonly AbiV1PreflightIssue[],
): PreflightSummary | null {
    if (issues.length === 0) return null;

    const byKind: Record<AbiV1PreflightIssue['kind'], AbiV1PreflightIssue[]> = {
        'unsupported-native': [],
        'unknown-specifier': [],
    };
    for (const issue of issues) {
        byKind[issue.kind].push(issue);
    }

    const headerKind: AbiV1PreflightIssue['kind'] =
        byKind['unsupported-native'].length > 0
            ? 'unsupported-native'
            : 'unknown-specifier';
    const title = TITLES[headerKind];

    const lines: string[] = [];
    if (byKind['unsupported-native'].length > 0) {
        for (const issue of byKind['unsupported-native']) {
            lines.push(
                `  ✗ ${issue.specifier} (${issue.filePath}) — native module, requires base/binary rebuild`,
            );
        }
    }
    if (byKind['unknown-specifier'].length > 0) {
        for (const issue of byKind['unknown-specifier']) {
            lines.push(
                `  ? ${issue.specifier} (${issue.filePath}) — not in base alias map`,
            );
        }
    }

    return { title, lines, byKind };
}

/** Single-line form for status-bar UIs. */
export function formatPreflightShort(
    issues: readonly AbiV1PreflightIssue[],
): string | null {
    if (issues.length === 0) return null;
    const n = issues.length;
    const uniqueSpecs = new Set(issues.map((i) => i.specifier)).size;
    return n === 1
        ? `1 import rejected: ${issues[0]!.specifier}`
        : `${n} imports rejected across ${uniqueSpecs} unique specifier${uniqueSpecs === 1 ? '' : 's'}`;
}
