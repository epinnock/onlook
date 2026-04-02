import { test as base } from '@playwright/test';

export interface MockSandbox {
    id: string;
    previewUrl: string;
    status: 'running' | 'paused' | 'stopped';
}

export function createMockSandbox(overrides?: Partial<MockSandbox>): MockSandbox {
    return {
        id: `mock-sandbox-${Date.now()}`,
        previewUrl: `http://localhost:8080`,
        status: 'running',
        ...overrides,
    };
}

export const test = base.extend<{ mockSandbox: MockSandbox }>({
    mockSandbox: async ({}, use) => {
        const sandbox = createMockSandbox();
        await use(sandbox);
    },
});

export { expect } from '@playwright/test';
