import { defineConfig, devices } from '@playwright/test';

const DEFAULT_PLAYWRIGHT_PORT = 3000;
const playwrightTestMatch = ['smoke.spec.ts', 'expo-browser/**/*.spec.ts'];

const parsePort = (envVarName: 'PLAYWRIGHT_PORT' | 'PORT') => {
    const rawPort = process.env[envVarName]?.trim();
    if (!rawPort) {
        return null;
    }

    const port = Number.parseInt(rawPort, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`${envVarName} must be a valid port. Received "${rawPort}".`);
    }

    return port;
};

const resolveBaseURL = () => {
    const explicitBaseURL = process.env.PLAYWRIGHT_BASE_URL?.trim();
    if (explicitBaseURL) {
        return new URL(explicitBaseURL).toString();
    }

    const port =
        parsePort('PLAYWRIGHT_PORT') ??
        parsePort('PORT') ??
        DEFAULT_PLAYWRIGHT_PORT;

    return `http://localhost:${port}`;
};

export default defineConfig({
    testDir: './e2e',
    testMatch: playwrightTestMatch,
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',
    use: {
        baseURL: resolveBaseURL(),
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
