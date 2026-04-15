import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

import {
    MOBILE_PREVIEW_FIXTURE_BRANCH_ID,
    MOBILE_PREVIEW_FIXTURE_PROJECT_ID,
} from '../helpers/fixture';

const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
const LOCAL_SUPABASE_SERVICE_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const EXPO_PROJECT_STORAGE_BUCKET = 'expo-projects';

const MOBILE_PREVIEW_SERVER_BASE_URL =
    process.env.NEXT_PUBLIC_MOBILE_PREVIEW_URL?.trim() || 'http://127.0.0.1:8787';
const PLAYWRIGHT_APP_BASE_URL =
    process.env.PLAYWRIGHT_BASE_URL?.trim() || 'http://127.0.0.1:3000';

const FIXTURE_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6p6nQAAAAASUVORK5CYII=';
const FIXTURE_PNG_DATA_URL = `data:image/png;base64,${FIXTURE_PNG_BASE64}`;

const ASSET_FIXTURE_APP_TSX = `import { Image, StyleSheet, Text, View } from 'react-native';
import fixtureLogo from './assets/fixture-logo.png';

export default function App() {
  return (
    <View style={styles.container}>
      <Image
        source={fixtureLogo}
        style={styles.logo}
        resizeMode="contain"
        accessibilityLabel="Fixture logo"
        testID="fixture-logo"
      />
      <Text style={styles.title}>Mobile preview asset fixture</Text>
      <Text style={styles.subtitle}>
        Local PNG assets should inline into the preview bundle.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050816',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  logo: {
    width: 112,
    height: 112,
    marginBottom: 20,
  },
  title: {
    color: '#f9fafb',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    color: '#cbd5e1',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 280,
  },
});
`;

function resolveRepoRoot(): string {
    const cwd = process.cwd();
    const rootFromCwd = path.join(
        cwd,
        'apps/web/client/verification/onlook-editor/setup.sh',
    );

    if (existsSync(rootFromCwd)) {
        return cwd;
    }

    const rootFromApp = path.resolve(cwd, '../../..');
    if (
        existsSync(
            path.join(
                rootFromApp,
                'apps/web/client/verification/onlook-editor/setup.sh',
            ),
        )
    ) {
        return rootFromApp;
    }

    throw new Error(`Unable to resolve repo root from cwd: ${cwd}`);
}

function buildStorageKey(filePath: string): string {
    const normalizedPath = filePath.replace(/^\/+/, '').replace(/^\.\//, '');
    return `${MOBILE_PREVIEW_FIXTURE_PROJECT_ID}/${MOBILE_PREVIEW_FIXTURE_BRANCH_ID}/${normalizedPath}`;
}

function buildAppUrl(pathname: string): string {
    return new URL(pathname, PLAYWRIGHT_APP_BASE_URL).toString();
}

function runVerificationSetup(repoRoot: string): void {
    const setupScriptPath = path.join(
        repoRoot,
        'apps/web/client/verification/onlook-editor/setup.sh',
    );

    try {
        execFileSync('bash', [setupScriptPath], {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: 'pipe',
            timeout: 300_000,
        });
    } catch (error) {
        const stdout =
            error && typeof error === 'object' && 'stdout' in error
                ? String(error.stdout)
                : '';
        const stderr =
            error && typeof error === 'object' && 'stderr' in error
                ? String(error.stderr)
                : '';

        throw new Error(
            `verification setup failed.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        );
    }
}

async function uploadExpoFixtureOverrides(): Promise<void> {
    const supabase = createClient(LOCAL_SUPABASE_URL, LOCAL_SUPABASE_SERVICE_KEY, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });

    const uploads = [
        {
            path: 'App.tsx',
            body: ASSET_FIXTURE_APP_TSX,
            contentType: 'text/plain; charset=utf-8',
        },
        {
            path: 'assets/fixture-logo.png',
            body: Buffer.from(FIXTURE_PNG_BASE64, 'base64'),
            contentType: 'image/png',
        },
    ] as const;

    for (const upload of uploads) {
        const { error } = await supabase.storage
            .from(EXPO_PROJECT_STORAGE_BUCKET)
            .upload(buildStorageKey(upload.path), upload.body, {
                upsert: true,
                contentType: upload.contentType,
            });

        if (error) {
            throw new Error(`failed to upload ${upload.path}: ${error.message}`);
        }
    }
}

async function ensureLoggedIn(page: Page): Promise<void> {
    const response = await page.goto(buildAppUrl('/login'));
    if (response && response.status() >= 500) {
        throw new Error(
            `login page returned ${response.status()} at ${response.url()}`,
        );
    }

    const devLoginButton = page.getByRole('button', {
        name: /dev mode: sign in as demo user/i,
    });

    if (await devLoginButton.isVisible().catch(() => false)) {
        await devLoginButton.click();
    }

    await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
        timeout: 60_000,
    });
}

test.describe('Mobile preview asset rendering', () => {
    test.beforeAll(async () => {
        const repoRoot = resolveRepoRoot();

        runVerificationSetup(repoRoot);
        await uploadExpoFixtureOverrides();
    });

    test('pushes an eval bundle that inlines local image assets and exposes a manifest', async ({
        page,
    }) => {
        test.setTimeout(180_000);

        const consoleErrors: string[] = [];
        page.on('console', (message) => {
            if (message.type() === 'error') {
                consoleErrors.push(message.text());
            }
        });

        await ensureLoggedIn(page);

        const pushRequestPromise = page.waitForRequest(
            (request) =>
                request.method() === 'POST' &&
                request.url() === `${MOBILE_PREVIEW_SERVER_BASE_URL}/push`,
            { timeout: 120_000 },
        );

        await page.goto(buildAppUrl(`/project/${MOBILE_PREVIEW_FIXTURE_PROJECT_ID}`));

        const editor = page
            .locator('[data-testid="project-editor"], body[data-onlook-loaded="true"]')
            .first();
        await editor.waitFor({ state: 'attached', timeout: 60_000 });

        const pushRequest = await pushRequestPromise;
        const payload = pushRequest.postDataJSON() as
            | { type?: string; code?: string }
            | null;

        expect(payload?.type).toBe('eval');
        expect(payload?.code).toContain(FIXTURE_PNG_DATA_URL);
        expect(payload?.code).toContain('assets/fixture-logo.png');
        expect(payload?.code).toContain('fixture-logo');
        expect(payload?.code).toContain('Mobile preview asset fixture');

        const previewOnDeviceButton = page
            .locator('[data-testid="preview-on-device-button"]')
            .first();
        await expect(previewOnDeviceButton).toBeVisible({ timeout: 60_000 });
        await previewOnDeviceButton.click();

        const qrModalBody = page.locator('[data-testid="qr-modal-body"]').first();
        await expect(qrModalBody).toBeVisible({ timeout: 60_000 });

        const manifestUrl = page.locator('[data-testid="qr-manifest-url"]').first();
        await expect(manifestUrl).toBeVisible({ timeout: 60_000 });

        const manifestText = (await manifestUrl.textContent())?.trim() ?? '';
        expect(manifestText).toContain('/manifest/');
        expect(manifestText).toMatch(/^exp:\/\//);

        const mobilePreviewFailures = consoleErrors.filter(
            (line) =>
                line.includes('[mobile-preview] Failed') ||
                line.includes('Failed to sync app to phone'),
        );
        expect(mobilePreviewFailures).toEqual([]);
    });
});
