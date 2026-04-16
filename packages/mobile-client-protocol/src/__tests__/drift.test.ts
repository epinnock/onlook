import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { WsMessageSchema } from '../ws-messages';
import { ManifestSchema } from '../manifest';
import { ONLOOK_RUNTIME_VERSION } from '../runtime-version';

const FIXTURES_DIR = join(import.meta.dir, 'fixtures');

// Harness establishes a baseline for N-1 compatibility checks. Replace these
// fixtures with genuine previous-version payloads when the protocol bumps.
describe('protocol drift — N-1 fixtures parse against current schemas', () => {
    const files = readdirSync(FIXTURES_DIR);
    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        test(`fixture ${file} parses`, () => {
            const raw = JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf8'));
            const schema = file.startsWith('manifest-') ? ManifestSchema : WsMessageSchema;
            const result = schema.safeParse(raw);
            if (!result.success) {
                throw new Error(`${file} failed to parse: ${JSON.stringify(result.error.issues)}`);
            }
        });
    }
});

describe('current version emits current payloads', () => {
    test('ONLOOK_RUNTIME_VERSION is a semver string', () => {
        expect(ONLOOK_RUNTIME_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    });
});
