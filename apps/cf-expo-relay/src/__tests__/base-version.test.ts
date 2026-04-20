import { describe, expect, test } from 'bun:test';

import {
    CURRENT_BASE_BUNDLE_VERSION_KEY,
    parseBaseBundleVersionRecord,
    readCurrentBaseBundleVersion,
} from '../lib/base-version';

const HASH = 'a'.repeat(64);
const CREATED_AT = '2026-04-20T12:00:00.000Z';

describe('base bundle version reader', () => {
    test('returns null when the current pointer is missing', async () => {
        const record = await readCurrentBaseBundleVersion({
            BUNDLES: {
                async get(key: string) {
                    expect(key).toBe(CURRENT_BASE_BUNDLE_VERSION_KEY);
                    return null;
                },
            },
        });

        expect(record).toBeNull();
    });

    test('reads and validates the current pointer', async () => {
        const record = await readCurrentBaseBundleVersion({
            BUNDLES: {
                async get() {
                    return JSON.stringify({ hash: HASH, createdAt: CREATED_AT });
                },
            },
        });

        expect(record).toEqual({ hash: HASH, createdAt: CREATED_AT });
    });

    test('rejects invalid pointer records', () => {
        expect(() => parseBaseBundleVersionRecord({ hash: 'bad', createdAt: CREATED_AT }))
            .toThrow('invalid hash');
        expect(() => parseBaseBundleVersionRecord({ hash: HASH, createdAt: 'bad' }))
            .toThrow('invalid createdAt');
    });
});
