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
