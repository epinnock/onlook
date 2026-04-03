import { test, expect } from './helpers/sandbox-fixtures';

test.describe('E2E Infrastructure Smoke Test', () => {
    test('test fixtures are available', async ({ mockSandbox }) => {
        expect(mockSandbox).toBeDefined();
        expect(mockSandbox.id).toContain('mock-sandbox-');
        expect(mockSandbox.status).toBe('running');
    });

    test('mock sandbox has valid structure', async ({ mockSandbox }) => {
        expect(mockSandbox).toHaveProperty('id');
        expect(mockSandbox).toHaveProperty('previewUrl');
        expect(mockSandbox).toHaveProperty('status');
    });
});
