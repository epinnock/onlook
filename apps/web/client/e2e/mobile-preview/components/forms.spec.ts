import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type FrameLocator, type Page } from '@playwright/test';

import {
    ensureDevLoggedIn,
    openVerificationProject,
    seedVerificationFixture,
    VERIFICATION_PROJECT_ID,
} from '../helpers/browser';

const MOBILE_PREVIEW_SERVER_BASE_URL =
    process.env.NEXT_PUBLIC_MOBILE_PREVIEW_URL?.trim() || 'http://127.0.0.1:8787';

const FORMS_FIXTURE_APP_TSX = `import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet } from 'react-native';
import { FormsShowcase } from './components/FormsShowcase';

export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <FormsShowcase />
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020617',
  },
});
`;

const FORMS_SHOWCASE_TSX = `import { useState } from 'react';
import {
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

export function FormsShowcase() {
  const [displayName, setDisplayName] = useState('Ada Lovelace');
  const [notes, setNotes] = useState('Build browser-native mobile previews.');
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  return (
    <View style={styles.screen}>
      <View style={styles.card} testID="forms-card">
        <Text style={styles.eyebrow}>Wave C controls</Text>
        <Text style={styles.title}>Forms and controls fixture</Text>
        <Text style={styles.subtitle}>
          TextInput and Switch should stay interactive in the browser preview.
        </Text>

        <View style={styles.fieldBlock}>
          <Text style={styles.label}>Display name</Text>
          <TextInput
            nativeID="profile-name-input"
            testID="profile-name-input"
            placeholder="Display name"
            placeholderTextColor="#64748b"
            style={styles.singleLineInput}
            value={displayName}
            onChangeText={setDisplayName}
          />
          <Text style={styles.valueText} testID="profile-name-value">
            Current name: {displayName}
          </Text>
        </View>

        <View style={styles.fieldBlock}>
          <Text style={styles.label}>Project notes</Text>
          <TextInput
            multiline
            nativeID="notes-input"
            testID="notes-input"
            numberOfLines={4}
            placeholder="Project notes"
            placeholderTextColor="#64748b"
            style={styles.multilineInput}
            value={notes}
            onChangeText={setNotes}
          />
          <Text style={styles.valueText} testID="notes-value">
            Notes mirror: {notes}
          </Text>
        </View>

        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <Text style={styles.label}>Push notifications</Text>
            <Text style={styles.switchHint}>
              Toggle to verify the mapped Switch host control.
            </Text>
          </View>
          <Switch
            ios_backgroundColor="#334155"
            testID="marketing-switch"
            value={notificationsEnabled}
            onValueChange={setNotificationsEnabled}
            thumbColor={notificationsEnabled ? '#f8fafc' : '#cbd5e1'}
            trackColor={{ false: '#475569', true: '#22c55e' }}
          />
        </View>

        <Text style={styles.valueText} testID="switch-value">
          Notifications: {notificationsEnabled ? 'enabled' : 'disabled'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 28,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    backgroundColor: '#0f172a',
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  eyebrow: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  title: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '700',
  },
  subtitle: {
    color: '#cbd5e1',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 20,
  },
  fieldBlock: {
    marginBottom: 18,
  },
  label: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  singleLineInput: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    color: '#f8fafc',
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  multilineInput: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    color: '#f8fafc',
    minHeight: 112,
    paddingHorizontal: 14,
    paddingVertical: 12,
    textAlignVertical: 'top',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 16,
    marginBottom: 12,
  },
  switchCopy: {
    flex: 1,
    marginRight: 16,
  },
  switchHint: {
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 18,
  },
  valueText: {
    color: '#cbd5e1',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
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

async function uploadFormsFixtureOverrides(): Promise<void> {
    const repoRoot = resolveRepoRoot();

    seedVerificationFixture(repoRoot, {
        'App.tsx': FORMS_FIXTURE_APP_TSX,
        'components/FormsShowcase.tsx': FORMS_SHOWCASE_TSX,
    });
}

function getPreviewFrame(page: Page): FrameLocator {
    return page
        .frameLocator('iframe[id^="frame-"], iframe[src*="/preview/"]')
        .first();
}

async function openFormsFixture(page: Page): Promise<{
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

    const pushRequestPromise = page.waitForRequest(
        (request) =>
            request.method() === 'POST' &&
            request.url() === `${MOBILE_PREVIEW_SERVER_BASE_URL}/push`,
        { timeout: 120_000 },
    );

    await ensureDevLoggedIn(page, `/project/${VERIFICATION_PROJECT_ID}`);
    await openVerificationProject(page, VERIFICATION_PROJECT_ID);

    await page
        .locator('[data-testid="project-editor"], body[data-onlook-loaded="true"]')
        .first()
        .waitFor({ state: 'attached', timeout: 60_000 });

    await page
        .locator('iframe[id^="frame-"], iframe[src*="/preview/"]')
        .first()
        .waitFor({ state: 'attached', timeout: 60_000 });

    const frame = getPreviewFrame(page);
    await frame
        .locator('#forms-card, [data-testid="forms-card"]')
        .first()
        .waitFor({ state: 'attached', timeout: 60_000 });

    const pushRequest = await pushRequestPromise;
    const payload = (pushRequest.postDataJSON() as MobilePreviewEvalPushPayload | null) ?? {};

    expect(payload.type).toBe('eval');
    expect(payload.code).toContain('FormsShowcase');

    return { frame, payload, consoleErrors };
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

test.describe('Mobile preview Wave C forms and controls', () => {
    test.beforeAll(async () => {
        const repoRoot = resolveRepoRoot();

        runVerificationSetup(repoRoot);
        await uploadFormsFixtureOverrides();
    });

    test('renders TextInput and Switch controls in the pushed preview bundle', async ({
        page,
    }) => {
        test.setTimeout(180_000);

        const { frame, payload, consoleErrors } = await openFormsFixture(page);

        expect(payload.code).toContain('TextInput');
        expect(payload.code).toContain('Switch');
        expect(payload.code).toContain('multiline');

        await expect(
            frame.locator('#profile-name-input, [data-testid="profile-name-input"]').first(),
        ).toBeVisible({ timeout: 60_000 });
        await expect(
            frame.locator('#notes-input, [data-testid="notes-input"]').first(),
        ).toBeVisible({ timeout: 60_000 });
        await expect(
            frame.locator('#marketing-switch, [data-testid="marketing-switch"]').first(),
        ).toBeVisible({ timeout: 60_000 });

        expectNoRelevantConsoleErrors(consoleErrors);
    });

    test('keeps TextInput and Switch interactions live inside the preview frame', async ({
        page,
    }) => {
        test.setTimeout(180_000);

        const { frame, consoleErrors } = await openFormsFixture(page);
        const singleLineInput = frame
            .locator(
                '#profile-name-input, [data-testid="profile-name-input"], input[placeholder="Display name"]',
            )
            .first();
        const multilineInput = frame
            .locator(
                '#notes-input, [data-testid="notes-input"], textarea[placeholder="Project notes"]',
            )
            .first();
        const switchControl = frame
            .locator(
                '#marketing-switch, [data-testid="marketing-switch"], [role="switch"], input[type="checkbox"]',
            )
            .first();

        await expect(singleLineInput).toBeVisible({ timeout: 60_000 });
        await expect(multilineInput).toBeVisible({ timeout: 60_000 });
        await expect(switchControl).toBeVisible({ timeout: 60_000 });

        await singleLineInput.fill('Grace Hopper');
        await expect(
            frame.locator('#profile-name-value, [data-testid="profile-name-value"]').first(),
        ).toContainText('Grace Hopper');

        await multilineInput.fill('Preview controls now respond inside the browser runtime.');
        await expect(
            frame.locator('#notes-value, [data-testid="notes-value"]').first(),
        ).toContainText('Preview controls now respond inside the browser runtime.');

        await expect(
            frame.locator('#switch-value, [data-testid="switch-value"]').first(),
        ).toContainText('disabled');
        await switchControl.click();
        await expect(
            frame.locator('#switch-value, [data-testid="switch-value"]').first(),
        ).toContainText('enabled');

        expectNoRelevantConsoleErrors(consoleErrors);
    });
});
