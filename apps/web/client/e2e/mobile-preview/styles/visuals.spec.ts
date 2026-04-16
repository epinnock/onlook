import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import {
    ensureDevLoggedIn,
    openVerificationProject,
    seedVerificationFixture,
    VERIFICATION_PROJECT_ID,
} from '../helpers/browser';

const MOBILE_PREVIEW_SERVER_BASE_URL =
    process.env.NEXT_PUBLIC_MOBILE_PREVIEW_URL?.trim() || 'http://127.0.0.1:8787';

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
    const repoRoot = resolveRepoRoot();
    seedVerificationFixture(repoRoot, {
        'App.tsx': VISUAL_FIXTURE_APP_TSX,
        'components/VisualShowcase.tsx': VISUAL_SHOWCASE_TSX,
    });
}

async function ensureLoggedIn(page: Page): Promise<void> {
    await ensureDevLoggedIn(page, `/project/${VERIFICATION_PROJECT_ID}`);
}

async function openVisualFixture(page: Page): Promise<{
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

    await openVerificationProject(page, VERIFICATION_PROJECT_ID);

    const editor = page
        .locator('[data-testid="project-editor"], body[data-onlook-loaded="true"]')
        .first();
    await editor.waitFor({ state: 'attached', timeout: 60_000 });

    const pushRequest = await pushRequestPromise;
    const payload = (pushRequest.postDataJSON() as MobilePreviewEvalPushPayload | null) ?? {};

    expect(payload.type).toBe('eval');
    expect(payload.code).toContain('VisualShowcase');
    expect(payload.code).toContain('Shadow depth');
    expect(payload.code).toContain('Border treatment');
    expect(payload.code).toContain('Wave D typography sample');

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

    return { payload, consoleErrors };
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

    test('pushes the Wave D visual fixture with shadow, border, and typography styling intact', async ({
        page,
    }) => {
        test.setTimeout(180_000);

        const { payload, consoleErrors } = await openVisualFixture(page);
        expect(payload.code).toContain('shadowColor');
        expect(payload.code).toContain('shadowOpacity');
        expect(payload.code).toContain('shadowRadius');
        expect(payload.code).toContain('borderTopWidth');
        expect(payload.code).toContain('borderBottomWidth');
        expect(payload.code).toContain('borderRightColor');
        expect(payload.code).toContain('borderTopStyle');
        expect(payload.code).toContain('letterSpacing');
        expect(payload.code).toContain('textDecorationColor');
        expect(payload.code).toContain('textShadowColor');
        expect(payload.code).toContain('textShadowRadius');
        expect(payload.code).toContain('textDecorationLine');
        expect(payload.code).toContain('borderLeftStyle');
        expect(payload.code).toContain('paddingVertical');
        expectNoRelevantConsoleErrors(consoleErrors);
    });
});
