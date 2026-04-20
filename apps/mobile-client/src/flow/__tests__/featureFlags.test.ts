import { describe, expect, test } from 'bun:test';

import { classifyPipelineValue } from '../featureFlags';

describe('mobile-client feature flags', () => {
    test('returns "two-tier" only for the exact literal', () => {
        expect(classifyPipelineValue('two-tier')).toBe('two-tier');
    });

    test('returns "shim" when the env var is unset', () => {
        expect(classifyPipelineValue(undefined)).toBe('shim');
    });

    test('collapses unknown values to "shim" to keep the legacy path safe', () => {
        expect(classifyPipelineValue('')).toBe('shim');
        expect(classifyPipelineValue('enabled')).toBe('shim');
        expect(classifyPipelineValue('TWO-TIER')).toBe('shim');
    });
});
