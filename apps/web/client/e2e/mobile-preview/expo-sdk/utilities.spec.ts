import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Frame, type Page } from '@playwright/test';

import {
    ensureDevLoggedIn,
    openVerificationProject,
    seedVerificationFixture,
    VERIFICATION_PROJECT_ID,
} from '../helpers/browser';

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

async function openPreviewFrame(page: Page): Promise<Frame> {
    await openVerificationProject(page, VERIFICATION_PROJECT_ID);

    await expect(page.getByTestId('preview-on-device-button')).toBeVisible({
        timeout: 90_000,
    });

    const previewFrameElement = page
        .locator('iframe[id^="frame-"], iframe[src*="/preview/"]')
        .first();
    await previewFrameElement.waitFor({ state: 'attached', timeout: 60_000 });

    const frameHandle = await previewFrameElement.elementHandle();
    const previewFrame = await frameHandle?.contentFrame();

    if (!previewFrame) {
        throw new Error('Expected the editor preview iframe to expose a frame.');
    }

    return previewFrame;
}

async function expectPreviewLines(
    page: Page,
    appSource: string,
    heading: string,
    expectedLines: readonly string[],
): Promise<void> {
    await uploadFixtureFile('App.tsx', appSource);
    await ensureLoggedIn(page);

    const previewFrame = await openPreviewFrame(page);
    await expect(previewFrame.locator(`text=${heading}`)).toBeVisible({
        timeout: 120_000,
    });

    for (const line of expectedLines) {
        await expect(previewFrame.locator(`text=${line}`)).toBeVisible({
            timeout: 120_000,
        });
    }
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

        await expectPreviewLines(page, METADATA_APP_TSX, 'Wave E metadata utilities', [
            'status:ready',
            'ownership:expo',
            'execution:storeClient',
            'device:iPhone/iOS',
            'deviceType:1',
            'network:WIFI',
            'batteryAvailable:true',
            'batteryState:3',
            'batteryLowPower:false',
            'rooted:false',
        ]);
    });

    test('renders linking, system-ui, and splash utilities through Expo shims', async ({
        page,
    }) => {
        test.setTimeout(180_000);

        await expectPreviewLines(page, LINKING_APP_TSX, 'Wave E linking utilities', [
            'status:ready',
            'created:scry-preview://settings/profile?hello=world&multi=one&multi=two',
            'parsedPath:settings/profile',
            'parsedScheme:scry-preview',
            'background:#101010',
            'canOpen:true',
            'openUrl:true',
            'preventAutoHide:true,false',
        ]);
    });

    test('renders clipboard, haptics, and web browser utilities through Expo shims', async ({
        page,
    }) => {
        test.setTimeout(180_000);

        await expectPreviewLines(
            page,
            BROWSER_UTILITIES_APP_TSX,
            'Wave E browser utilities',
            [
                'status:ready',
                'clipboard:copied-from-preview',
                'clipboardHasString:true',
                'impactStyle:Medium',
                'openBrowser:opened',
                'openAuthSession:cancel',
                'maybeComplete:failed',
            ],
        );
    });
});
