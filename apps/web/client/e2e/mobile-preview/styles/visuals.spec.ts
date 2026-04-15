import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type FrameLocator, type Page } from '@playwright/test';
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

const VISUAL_FIXTURE_APP_TSX = `import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { VisualShowcase } from './components/VisualShowcase';

export default function App() {
  return (
    <View style={styles.container}>
      <VisualShowcase />
      <StatusBar style="light" />
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
    paddingVertical: 32,
  },
});
`;

const VISUAL_SHOWCASE_TSX = `import { StyleSheet, Text, View } from 'react-native';

export function VisualShowcase() {
  return (
    <View style={styles.stack}>
      <View nativeID="shadow-card" testID="shadow-card" style={styles.shadowCard}>
        <Text nativeID="shadow-label" testID="shadow-label" style={styles.shadowLabel}>
          Shadow depth
        </Text>
      </View>

      <View nativeID="border-card" testID="border-card" style={styles.borderCard}>
        <Text nativeID="border-label" testID="border-label" style={styles.borderLabel}>
          Border treatment
        </Text>
      </View>

      <Text
        nativeID="typography-sample"
        testID="typography-sample"
        style={styles.typographySample}
      >
        Wave D typography sample
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    width: '100%',
    maxWidth: 320,
  },
  shadowCard: {
    backgroundColor: '#0f172a',
    borderRadius: 20,
    marginBottom: 18,
    paddingHorizontal: 20,
    paddingVertical: 18,
    shadowColor: '#112233',
    shadowOffset: { width: 4, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
  },
  shadowLabel: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '700',
  },
  borderCard: {
    backgroundColor: '#111827',
    borderRadius: 18,
    borderTopColor: 'rgba(255, 0, 0, 0.5)',
    borderTopStyle: 'dotted',
    borderTopWidth: 4,
    borderRightColor: '#445566',
    borderRightStyle: 'dashed',
    borderRightWidth: 2,
    borderBottomColor: '#112233',
    borderBottomStyle: 'solid',
    borderBottomWidth: 6,
    borderLeftColor: '#112233',
    borderLeftStyle: 'dashed',
    borderLeftWidth: 2,
    marginBottom: 18,
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  borderLabel: {
    color: '#e2e8f0',
    fontSize: 16,
    fontWeight: '600',
  },
  typographySample: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 1.5,
    lineHeight: 32,
    textDecorationColor: '#445566',
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
    textShadowColor: 'rgba(17, 34, 51, 0.5)',
    textShadowOffset: { width: 2, height: 4 },
    textShadowRadius: 6,
  },
});
`;

interface MobilePreviewEvalPushPayload {
    type?: string;
    code?: string;
}

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

async function uploadVisualFixtureOverrides(): Promise<void> {
    const supabase = createClient(LOCAL_SUPABASE_URL, LOCAL_SUPABASE_SERVICE_KEY, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });

    const uploads = [
        {
            path: 'App.tsx',
            body: VISUAL_FIXTURE_APP_TSX,
        },
        {
            path: 'components/VisualShowcase.tsx',
            body: VISUAL_SHOWCASE_TSX,
        },
    ] as const;

    for (const upload of uploads) {
        const { error } = await supabase.storage
            .from(EXPO_PROJECT_STORAGE_BUCKET)
            .upload(buildStorageKey(upload.path), upload.body, {
                upsert: true,
                contentType: 'text/plain; charset=utf-8',
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

function getPreviewFrame(page: Page): FrameLocator {
    return page
        .frameLocator('iframe[id^="frame-"], iframe[src*="/preview/"]')
        .first();
}

async function openVisualFixture(page: Page): Promise<{
    frame: FrameLocator;
    payload: MobilePreviewEvalPushPayload;
    consoleErrors: string[];
}> {
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

    await page.goto(buildAppUrl(`/project/${MOBILE_PREVIEW_FIXTURE_PROJECT_ID}`), {
        waitUntil: 'domcontentloaded',
    });

    const editor = page
        .locator('[data-testid="project-editor"], body[data-onlook-loaded="true"]')
        .first();
    await editor.waitFor({ state: 'attached', timeout: 60_000 });

    const previewFrame = page
        .locator('iframe[id^="frame-"], iframe[src*="/preview/"]')
        .first();
    await previewFrame.waitFor({ state: 'attached', timeout: 60_000 });

    const frame = getPreviewFrame(page);
    await frame
        .locator('#root, [data-onlook-preview-ready="true"]')
        .first()
        .waitFor({ state: 'attached', timeout: 30_000 });
    await frame
        .locator('#typography-sample, [data-testid="typography-sample"]')
        .first()
        .waitFor({ state: 'attached', timeout: 60_000 });

    const pushRequest = await pushRequestPromise;
    const payload = (pushRequest.postDataJSON() as MobilePreviewEvalPushPayload | null) ?? {};

    expect(payload.type).toBe('eval');
    expect(payload.code).toContain('VisualShowcase');

    return { frame, payload, consoleErrors };
}

async function readComputedStyles(
    frame: FrameLocator,
    selector: string,
    properties: readonly string[],
): Promise<Record<string, string>> {
    const locator = frame.locator(selector).first();
    await expect(locator).toBeVisible({ timeout: 60_000 });

    return locator.evaluate((node, names) => {
        const styles = window.getComputedStyle(node as HTMLElement);
        return Object.fromEntries(
            names.map((name) => [name, styles.getPropertyValue(name)]),
        );
    }, [...properties]);
}

function expectNoRelevantConsoleErrors(consoleErrors: string[]): void {
    const relevantErrors = consoleErrors.filter(
        (line) =>
            line.includes('[mobile-preview] Failed') ||
            line.includes('[preview] failed') ||
            line.includes('PROVIDER_NO_SHELL'),
    );

    expect(relevantErrors).toEqual([]);
}

test.describe('Mobile preview Wave D visuals', () => {
    test.beforeAll(async () => {
        const repoRoot = resolveRepoRoot();

        runVerificationSetup(repoRoot);
        await uploadVisualFixtureOverrides();
    });

    test('renders the shadow fixture and keeps shadow props in the push bundle', async ({
        page,
    }) => {
        test.setTimeout(180_000);

        const { frame, payload, consoleErrors } = await openVisualFixture(page);
        expect(payload.code).toContain('shadowColor');
        expect(payload.code).toContain('shadowOpacity');
        expect(payload.code).toContain('shadowRadius');

        const styles = await readComputedStyles(
            frame,
            '#shadow-card, [data-testid="shadow-card"]',
            ['background-color', 'border-radius', 'box-shadow'],
        );

        expect(styles['background-color']).toBe('rgb(15, 23, 42)');
        expect(styles['border-radius']).toBe('20px');
        expect(styles['box-shadow']).toContain('4px 12px 18px');
        expect(styles['box-shadow']).toContain('rgba(17, 34, 51, 0.35)');
        expectNoRelevantConsoleErrors(consoleErrors);
    });

    test('renders the border fixture and keeps border props in the push bundle', async ({
        page,
    }) => {
        test.setTimeout(180_000);

        const { frame, payload, consoleErrors } = await openVisualFixture(page);
        expect(payload.code).toContain('borderTopWidth');
        expect(payload.code).toContain('borderBottomWidth');
        expect(payload.code).toContain('borderRightColor');
        expect(payload.code).toContain('borderTopStyle');

        const styles = await readComputedStyles(
            frame,
            '#border-card, [data-testid="border-card"]',
            [
                'border-top-color',
                'border-top-style',
                'border-top-width',
                'border-right-color',
                'border-right-style',
                'border-bottom-width',
                'border-radius',
            ],
        );

        expect(styles['border-top-color']).toBe('rgba(255, 0, 0, 0.5)');
        expect(styles['border-top-style']).toBe('dotted');
        expect(styles['border-top-width']).toBe('4px');
        expect(styles['border-right-color']).toBe('rgb(68, 85, 102)');
        expect(styles['border-right-style']).toBe('dashed');
        expect(styles['border-bottom-width']).toBe('6px');
        expect(styles['border-radius']).toBe('18px');
        expectNoRelevantConsoleErrors(consoleErrors);
    });

    test('renders the typography fixture and keeps typography props in the push bundle', async ({
        page,
    }) => {
        test.setTimeout(180_000);

        const { frame, payload, consoleErrors } = await openVisualFixture(page);
        expect(payload.code).toContain('letterSpacing');
        expect(payload.code).toContain('textDecorationColor');
        expect(payload.code).toContain('textShadowColor');
        expect(payload.code).toContain('textShadowRadius');

        const styles = await readComputedStyles(
            frame,
            '#typography-sample, [data-testid="typography-sample"]',
            [
                'color',
                'font-weight',
                'letter-spacing',
                'text-decoration-color',
                'text-decoration-line',
                'text-decoration-style',
                'text-shadow',
            ],
        );

        expect(styles.color).toBe('rgb(248, 250, 252)');
        expect(styles['font-weight']).toBe('700');
        expect(styles['letter-spacing']).toBe('1.5px');
        expect(styles['text-decoration-color']).toBe('rgb(68, 85, 102)');
        expect(styles['text-decoration-line']).toContain('underline');
        expect(styles['text-decoration-style']).toBe('dotted');
        expect(styles['text-shadow']).toContain('2px 4px 6px');
        expect(styles['text-shadow']).toContain('rgba(17, 34, 51, 0.5)');
        expectNoRelevantConsoleErrors(consoleErrors);
    });
});
