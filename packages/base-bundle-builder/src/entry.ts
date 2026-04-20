import { listCuratedBaseBundleDependencySpecifiers } from './deps';

export const SYNTHETIC_BASE_BUNDLE_ENTRY_MARKER = '__onlookBaseBundleEntry';

export function createSyntheticBaseBundleEntrySource(): string {
    const specifiers = listCuratedBaseBundleDependencySpecifiers();

    return [
        ...specifiers.map((specifier) => `import ${JSON.stringify(specifier)};`),
        '',
        `globalThis.${SYNTHETIC_BASE_BUNDLE_ENTRY_MARKER} = {`,
        "    kind: 'synthetic-base-bundle-entry',",
        '    specifiers: [',
        ...specifiers.map((specifier) => `        ${JSON.stringify(specifier)},`),
        '    ],',
        '};',
        '',
    ].join('\n');
}
