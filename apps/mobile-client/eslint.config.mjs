// MC1.8 — Expo module allowlist enforcement (ESLint half).
//
// Extends @onlook/eslint/base and adds a `no-restricted-imports` rule that
// rejects any `expo-*` import not in ALLOWED_EXPO_MODULES
// (see apps/mobile-client/src/supported-modules.ts and SUPPORTED_MODULES.md).
//
// The Metro resolver block half of the allowlist is deferred to a follow-up.

import base from '@onlook/eslint/base';

// Banned expo-* packages — everything NOT in the allowlist that might
// plausibly be imported. Additions welcome; the allowlist in
// src/supported-modules.ts is the source of truth for what's allowed.
const banned = [
    'expo-av',
    'expo-location',
    'expo-file-system',
    'expo-asset',
    'expo-constants',
    'expo-font',
    'expo-keep-awake',
    'expo-fetch',
    'expo-print',
    'expo-sensors',
    'expo-sqlite',
    'expo-image',
    'expo-blur',
    'expo-gl',
];

const message =
    'Not in the MC1.8 allowlist — see apps/mobile-client/SUPPORTED_MODULES.md. ' +
    'Allowed expo-* modules are enumerated in apps/mobile-client/src/supported-modules.ts.';

export default [
    ...base,
    {
        // verification/ + e2e/ + ios/ + android/ + scripts/ + test files
        // are not in tsconfig.json's `include`. typescript-eslint's
        // project service can't resolve them and emits "not found by
        // the project service" parse errors on every lint run. The
        // contents of those paths use Bun's runtime types via `bun test`
        // / shebang scripts, not the package's RN types graph, so they
        // shouldn't share the production tsconfig anyway.
        ignores: [
            'verification/**',
            'e2e/**',
            'ios/**',
            'android/**',
            'scripts/**',
            'src/**/*.test.ts',
            'src/**/__tests__/**',
        ],
    },
    {
        files: ['**/*.js', '**/*.ts', '**/*.tsx'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    paths: banned.map((name) => ({ name, message })),
                    patterns: banned.map((name) => ({
                        group: [`${name}/*`],
                        message,
                    })),
                },
            ],
        },
    },
];
