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
    process.env.NEXT_PUBLIC_MOBILE_PREVIEW_URL?.trim() ||
    'http://127.0.0.1:8787';

const METADATA_APP_TSX = `import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import * as Battery from 'expo-battery';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Network from 'expo-network';

export default function App() {
  const [lines, setLines] = useState<string[]>(['status:loading']);

  useEffect(() => {
    let active = true;

    void (async () => {
      const [
        batteryAvailable,
        batteryState,
        deviceType,
        networkState,
        rooted,
      ] = await Promise.all([
        Battery.isAvailableAsync(),
        Battery.getBatteryStateAsync(),
        Device.getDeviceTypeAsync(),
        Network.getNetworkStateAsync(),
        Device.isRootedExperimentalAsync(),
      ]);

      if (!active) {
        return;
      }

      setLines([
        'status:ready',
        'ownership:' + String(Constants.appOwnership),
        'execution:' + String(Constants.executionEnvironment),
        'device:' + String(Device.modelName) + '/' + String(Device.osName),
        'deviceType:' + String(deviceType),
        'network:' + String(networkState.type),
        'batteryAvailable:' + String(batteryAvailable),
        'batteryState:' + String(batteryState),
        'batteryLowPower:' + String(Battery.useLowPowerMode()),
        'rooted:' + String(rooted),
      ]);
    })();

    return () => {
      active = false;
    };
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Wave E metadata utilities</Text>
      {lines.map((line) => (
        <Text key={line} style={styles.line}>
          {line}
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#050816',
    gap: 10,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  heading: {
    color: '#f9fafb',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  line: {
    color: '#cbd5e1',
    fontSize: 14,
  },
});
`;

const LINKING_APP_TSX = `import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import * as Linking from 'expo-linking';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';

export default function App() {
  const [lines, setLines] = useState<string[]>(['status:loading']);

  useEffect(() => {
    let active = true;

    void (async () => {
      const createdUrl = Linking.createURL('settings/profile', {
        queryParams: {
          hello: 'world',
          multi: ['one', 'two'],
        },
        scheme: 'scry-preview',
      });
      const parsedUrl = Linking.parse(createdUrl);
      const canOpenUrl = await Linking.canOpenURL('https://expo.dev');
      const openedUrl = await Linking.openURL('https://expo.dev');
      await SystemUI.setBackgroundColorAsync('#101010');
      const backgroundColor = await SystemUI.getBackgroundColorAsync();
      const firstPreventAutoHide = await SplashScreen.preventAutoHideAsync();
      const secondPreventAutoHide = await SplashScreen.preventAutoHideAsync();
      await SplashScreen.hideAsync();

      if (!active) {
        return;
      }

      setLines([
        'status:ready',
        'created:' + createdUrl,
        'parsedPath:' + String(parsedUrl.path),
        'parsedScheme:' + String(parsedUrl.scheme),
        'background:' + String(backgroundColor),
        'canOpen:' + String(canOpenUrl),
        'openUrl:' + String(openedUrl),
        'preventAutoHide:' +
          String(firstPreventAutoHide) +
          ',' +
          String(secondPreventAutoHide),
      ]);
    })();

    return () => {
      active = false;
    };
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Wave E linking utilities</Text>
      {lines.map((line) => (
        <Text key={line} style={styles.line}>
          {line}
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#050816',
    gap: 10,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  heading: {
    color: '#f9fafb',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  line: {
    color: '#cbd5e1',
    fontSize: 14,
  },
});
`;

const BROWSER_UTILITIES_APP_TSX = `import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';

export default function App() {
  const [lines, setLines] = useState<string[]>(['status:loading']);

  useEffect(() => {
    let active = true;

    void (async () => {
      await Clipboard.setStringAsync('copied-from-preview');
      const clipboardValue = await Clipboard.getStringAsync();
      const clipboardHasString = await Clipboard.hasStringAsync();
      await Haptics.selectionAsync();
      const openBrowserResult = await WebBrowser.openBrowserAsync(
        'https://example.com',
      );
      const authSessionResult = await WebBrowser.openAuthSessionAsync(
        'https://example.com/login',
        'scry-preview://callback',
      );
      const maybeCompleteResult = WebBrowser.maybeCompleteAuthSession();

      if (!active) {
        return;
      }

      setLines([
        'status:ready',
        'clipboard:' + clipboardValue,
        'clipboardHasString:' + String(clipboardHasString),
        'impactStyle:' + String(Haptics.ImpactFeedbackStyle.Medium),
        'openBrowser:' + String(openBrowserResult.type),
        'openAuthSession:' + String(authSessionResult.type),
        'maybeComplete:' + String(maybeCompleteResult.type),
      ]);
    })();

    return () => {
      active = false;
    };
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Wave E browser utilities</Text>
      {lines.map((line) => (
        <Text key={line} style={styles.line}>
          {line}
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#050816',
    gap: 10,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  heading: {
    color: '#f9fafb',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  line: {
    color: '#cbd5e1',
    fontSize: 14,
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

async function uploadFixtureFile(
    filePath: string,
    body: string,
): Promise<void> {
    const repoRoot = resolveRepoRoot();
    seedVerificationFixture(repoRoot, { [filePath]: body });
}

async function ensureLoggedIn(page: Page): Promise<void> {
    await ensureDevLoggedIn(page, `/project/${VERIFICATION_PROJECT_ID}`);
}

async function expectPreviewPush(
    page: Page,
    appSource: string,
    requiredSpecifiers: readonly string[],
    requiredMarkers: readonly string[],
): Promise<void> {
    await uploadFixtureFile('App.tsx', appSource);
    await ensureLoggedIn(page);

    const pushRequestPromise = page.waitForRequest(
        (request) =>
            request.method() === 'POST' &&
            request.url() === `${MOBILE_PREVIEW_SERVER_BASE_URL}/push`,
        { timeout: 120_000 },
    );

    await openVerificationProject(page, VERIFICATION_PROJECT_ID);

    await expect(page.getByTestId('preview-on-device-button')).toBeVisible({
        timeout: 90_000,
    });

    const pushRequest = await pushRequestPromise;
    const payload = pushRequest.postDataJSON() as
        | { type?: string; code?: string }
        | null;

    expect(payload?.type).toBe('eval');
    expect(payload?.code).toContain(
        "const __runtimeShim = __resolveRuntimeShim(specifier);",
    );

    for (const specifier of requiredSpecifiers) {
        expect(payload?.code).toContain(`require('${specifier}')`);
    }

    for (const marker of requiredMarkers) {
        expect(payload?.code).toContain(marker);
    }

    await page.getByTestId('preview-on-device-button').click();

    const qrModalBody = page.locator('[data-testid="qr-modal-body"]').first();
    await expect(qrModalBody).toBeVisible({ timeout: 60_000 });

    const manifestUrl = page.locator('[data-testid="qr-manifest-url"]').first();
    await expect(manifestUrl).toBeVisible({ timeout: 60_000 });
    await expect(manifestUrl).toContainText('/manifest/');
}

test.describe('Mobile preview Expo utility shims', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeAll(async () => {
        const repoRoot = resolveRepoRoot();
        runVerificationSetup(repoRoot);
    });

    test('renders metadata utilities through the Expo shim registry', async ({
        page,
    }) => {
        test.setTimeout(180_000);

        await expectPreviewPush(
            page,
            METADATA_APP_TSX,
            ['expo-battery', 'expo-constants', 'expo-device', 'expo-network'],
            [
                'Wave E metadata utilities',
                'ownership:',
                'execution:',
                'deviceType:',
                'batteryState:',
            ],
        );
    });

    test('renders linking, system-ui, and splash utilities through Expo shims', async ({
        page,
    }) => {
        test.setTimeout(180_000);

        await expectPreviewPush(
            page,
            LINKING_APP_TSX,
            ['expo-linking', 'expo-splash-screen', 'expo-system-ui'],
            [
                'Wave E linking utilities',
                'created:',
                'parsedPath:',
                'background:',
                'preventAutoHide:',
            ],
        );
    });

    test('renders clipboard, haptics, and web browser utilities through Expo shims', async ({
        page,
    }) => {
        test.setTimeout(180_000);

        await expectPreviewPush(
            page,
            BROWSER_UTILITIES_APP_TSX,
            ['expo-clipboard', 'expo-haptics', 'expo-web-browser'],
            [
                'Wave E browser utilities',
                'copied-from-preview',
                'clipboardHasString:',
                'openBrowser:',
                'openAuthSession:',
                'maybeComplete:',
            ],
        );
    });
});
