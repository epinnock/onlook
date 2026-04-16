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

const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
const LOCAL_SUPABASE_SERVICE_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const EXPO_PROJECT_STORAGE_BUCKET = 'expo-projects';

const MOBILE_PREVIEW_SERVER_BASE_URL =
    process.env.NEXT_PUBLIC_MOBILE_PREVIEW_URL?.trim() ||
    'http://127.0.0.1:8787';

const MEDIA_FIXTURE_APP_TSX = `import { Text, View } from 'react-native';
import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';

export default function App() {
  const [cameraPermission] = useCameraPermissions();
  const [mediaLibraryPermission] = ImagePicker.useMediaLibraryPermissions();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: '#050816',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
        gap: 12,
      }}
    >
      <CameraView
        facing={CameraType.front}
        enableTorch
        testID="fixture-camera-view"
        style={{ width: 180, height: 120, borderRadius: 16, backgroundColor: '#1e293b' }}
      />
      <Text style={{ color: '#f8fafc', fontSize: 24, fontWeight: '700' }}>
        Mobile preview media fixture
      </Text>
      <Text style={{ color: '#cbd5e1', textAlign: 'center' }}>
        Camera permission: {cameraPermission?.status ?? 'unknown'}
      </Text>
      <Text style={{ color: '#cbd5e1', textAlign: 'center' }}>
        Media library permission: {mediaLibraryPermission?.status ?? 'unknown'}
      </Text>
      <Text style={{ color: '#94a3b8', textAlign: 'center' }}>
        Picker mode: {ImagePicker.MediaTypeOptions.Images}
      </Text>
    </View>
  );
}
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
    return `${VERIFICATION_PROJECT_ID}/${VERIFICATION_BRANCH_ID}/${normalizedPath}`;
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

async function uploadMediaFixtureOverrides(): Promise<void> {
    const repoRoot = resolveRepoRoot();
    seedVerificationFixture(repoRoot, { 'App.tsx': MEDIA_FIXTURE_APP_TSX });
}

async function ensureLoggedIn(page: Page): Promise<void> {
    await ensureDevLoggedIn(page, `/project/${VERIFICATION_PROJECT_ID}`);
}

test.describe('Mobile preview Expo media bundle', () => {
    test.beforeAll(async () => {
        const repoRoot = resolveRepoRoot();

        runVerificationSetup(repoRoot);
        await uploadMediaFixtureOverrides();
    });

    test('pushes an eval bundle with expo-camera and expo-image-picker runtime shims', async ({
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

        await openVerificationProject(page, VERIFICATION_PROJECT_ID);

        const editor = page
            .locator('[data-testid="project-editor"], body[data-onlook-loaded="true"]')
            .first();
        await editor.waitFor({ state: 'attached', timeout: 60_000 });

        const pushRequest = await pushRequestPromise;
        const payload = pushRequest.postDataJSON() as
            | { type?: string; code?: string }
            | null;

        expect(payload?.type).toBe('eval');
        expect(payload?.code).toContain("require('expo-camera')");
        expect(payload?.code).toContain("require('expo-image-picker')");
        expect(payload?.code).toContain(
            "const __runtimeShim = __resolveRuntimeShim(specifier);",
        );
        expect(payload?.code).toContain("__onlookShims");
        expect(payload?.code).toContain('Mobile preview media fixture');
        expect(payload?.code).toContain('fixture-camera-view');
        expect(payload?.code).toContain('Camera permission');
        expect(payload?.code).toContain('Media library permission');

        const previewOnDeviceButton = page
            .locator('[data-testid="preview-on-device-button"]')
            .first();
        await expect(previewOnDeviceButton).toBeVisible({ timeout: 60_000 });
        await previewOnDeviceButton.click();

        const qrModalBody = page.locator('[data-testid="qr-modal-body"]').first();
        await expect(qrModalBody).toBeVisible({ timeout: 60_000 });

        const manifestUrl = page.locator('[data-testid="qr-manifest-url"]').first();
        await expect(manifestUrl).toBeVisible({ timeout: 60_000 });
        await expect(manifestUrl).toContainText('/manifest/');

        const mobilePreviewFailures = consoleErrors.filter(
            (line) =>
                line.includes('[mobile-preview] Failed') ||
                line.includes('Failed to sync app to phone') ||
                line.includes('Unsupported package import'),
        );
        expect(mobilePreviewFailures).toEqual([]);
    });
});
