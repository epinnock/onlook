import {
    classifyImportPath,
    createExternalSpecifierSet,
} from './plugins/external';
import type { VirtualFsFileMap } from './plugins/virtual-fs-resolve';

export interface UnsupportedImportPreflightOptions {
    readonly files: VirtualFsFileMap;
    readonly externalSpecifiers: Iterable<string>;
}

export interface UnsupportedImportPreflightIssue {
    readonly filePath: string;
    readonly specifier: string;
    readonly message: string;
}

// ─── ABI v1 preflight — two-tier-overlay-v2 task #44 ─────────────────────────

export type AbiV1PreflightIssueKind =
    | 'unsupported-native'   // specifier is in the disallowed-native set
    | 'unknown-specifier';   // specifier is bare but not in the base alias map

export interface AbiV1PreflightIssue {
    readonly filePath: string;
    readonly specifier: string;
    readonly kind: AbiV1PreflightIssueKind;
    readonly message: string;
}

export interface AbiV1PreflightOptions {
    readonly files: VirtualFsFileMap;
    /**
     * The set of bare specifiers the currently-deployed base bundle serves via
     * `OnlookRuntime.require`. Usually sourced from `BaseManifest.aliases`
     * exported by `@onlook/base-bundle-builder` (task #10).
     */
    readonly baseAliases: Iterable<string>;
    /**
     * Bare specifiers that are known to require native binaries the base bundle
     * does not ship. Editor MUST reject these regardless of `baseAliases`
     * membership. Usually sourced from `DISALLOWED_NATIVE_ALIASES` in
     * `@onlook/base-bundle-builder/runtime-capabilities`.
     */
    readonly disallowed?: Iterable<string>;
}

const STATIC_IMPORT_PATTERN =
    /\b(?:import(?!\s*\()|export)\b[\s\S]*?(?:from\s*)?(['"])([^'"\\]*(?:\\.[^'"\\]*)*)\1/g;
const REQUIRE_PATTERN = /\brequire\s*\(\s*(['"])([^'"\\]*(?:\\.[^'"\\]*)*)\1\s*\)/g;

export function preflightUnsupportedImports(
    options: UnsupportedImportPreflightOptions,
): readonly UnsupportedImportPreflightIssue[] {
    const externalSpecifiers = createExternalSpecifierSet(options.externalSpecifiers);
    const issues: UnsupportedImportPreflightIssue[] = [];
    const seenIssues = new Set<string>();
    const filePaths = Object.keys(options.files).sort();

    for (const filePath of filePaths) {
        const contents = options.files[filePath];
        if (contents === undefined) {
            continue;
        }

        for (const specifier of collectStaticSpecifiers(contents)) {
            if (classifyImportPath(specifier, externalSpecifiers) !== 'unsupported-bare') {
                continue;
            }

            const issueKey = `${filePath}\n${specifier}`;
            if (seenIssues.has(issueKey)) {
                continue;
            }

            seenIssues.add(issueKey);
            issues.push({
                filePath,
                specifier,
                message: `Unsupported bare import "${specifier}" in ${filePath}. Add it to the base bundle or rewrite it as a local import.`,
            });
        }
    }

    return issues;
}

export const findUnsupportedImports = preflightUnsupportedImports;

export function assertNoUnsupportedImports(options: UnsupportedImportPreflightOptions): void {
    const issues = preflightUnsupportedImports(options);
    if (issues.length === 0) {
        return;
    }

    throw new Error(
        ['Unsupported imports found:', ...issues.map((issue) => `- ${issue.message}`)].join('\n'),
    );
}

/**
 * ABI v1 preflight — classifies every bare import in the user's virtual FS
 * against the base bundle's alias map and the disallowed-native policy.
 * Issues an `unsupported-native` error for disallowed specifiers (even when
 * pre-bundled into the user's node_modules), and `unknown-specifier` for bare
 * specifiers the base bundle does not serve.
 *
 * Matches the error surface kinds defined in ADR-0001 §"Error surface".
 */
export function preflightAbiV1Imports(
    options: AbiV1PreflightOptions,
): readonly AbiV1PreflightIssue[] {
    const baseSet = new Set<string>();
    for (const alias of options.baseAliases) {
        if (alias.trim().length > 0) {
            baseSet.add(alias);
        }
    }
    const disallowedSet = new Set<string>();
    for (const spec of options.disallowed ?? []) {
        if (spec.trim().length > 0) {
            disallowedSet.add(spec);
        }
    }

    const issues: AbiV1PreflightIssue[] = [];
    const seenIssues = new Set<string>();
    const filePaths = Object.keys(options.files).sort();

    for (const filePath of filePaths) {
        const contents = options.files[filePath];
        if (contents === undefined) {
            continue;
        }

        for (const specifier of collectStaticSpecifiers(contents)) {
            if (!isBareForPreflight(specifier)) {
                continue;
            }

            const kind: AbiV1PreflightIssueKind | null = disallowedSet.has(specifier)
                ? 'unsupported-native'
                : baseSet.has(specifier)
                    ? null
                    : 'unknown-specifier';

            if (kind === null) {
                continue;
            }

            const issueKey = `${filePath}\n${specifier}\n${kind}`;
            if (seenIssues.has(issueKey)) {
                continue;
            }
            seenIssues.add(issueKey);

            const message =
                kind === 'unsupported-native'
                    ? `Unsupported native module "${specifier}" in ${filePath}. This package requires a native binary the base bundle does not ship; adding it requires a base/binary rebuild.`
                    : `Unknown bare import "${specifier}" in ${filePath}. The currently-deployed base bundle does not serve this specifier. Add it to the base bundle or rewrite as a local import.`;

            issues.push({ filePath, specifier, kind, message });
        }
    }

    return issues;
}

export function assertAbiV1Imports(options: AbiV1PreflightOptions): void {
    const issues = preflightAbiV1Imports(options);
    if (issues.length === 0) {
        return;
    }
    throw new Error(
        ['ABI v1 preflight rejected overlay:', ...issues.map((i) => `- [${i.kind}] ${i.message}`)].join('\n'),
    );
}

function isBareForPreflight(specifier: string): boolean {
    if (specifier.length === 0) {
        return false;
    }
    const first = specifier[0];
    // Relative / absolute / URL imports are not bare.
    if (first === '.' || first === '/') {
        return false;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(specifier)) {
        return false; // http:, https:, file:, data:, node:, etc.
    }
    return true;
}

function collectStaticSpecifiers(contents: string): string[] {
    const strippedContents = stripComments(contents);
    const specifiers = new Set<string>();

    for (const match of strippedContents.matchAll(STATIC_IMPORT_PATTERN)) {
        const specifier = match[2];
        if (specifier !== undefined) {
            specifiers.add(specifier);
        }
    }

    for (const match of strippedContents.matchAll(REQUIRE_PATTERN)) {
        const specifier = match[2];
        if (specifier !== undefined) {
            specifiers.add(specifier);
        }
    }

    return [...specifiers];
}

function stripComments(contents: string): string {
    let result = '';
    let index = 0;

    while (index < contents.length) {
        const current = contents[index];
        const next = contents[index + 1];

        if (current === '/' && next === '/') {
            result += '  ';
            index += 2;

            while (index < contents.length) {
                const char = contents[index];
                if (char === '\n') {
                    result += char;
                    index += 1;
                    break;
                }

                result += ' ';
                index += 1;
            }
            continue;
        }

        if (current === '/' && next === '*') {
            result += '  ';
            index += 2;

            while (index < contents.length) {
                const char = contents[index];
                const following = contents[index + 1];

                if (char === '*' && following === '/') {
                    result += '  ';
                    index += 2;
                    break;
                }

                result += char === '\n' ? '\n' : ' ';
                index += 1;
            }
            continue;
        }

        result += current;
        index += 1;
    }

    return result;
}
