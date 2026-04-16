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

    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const EXPO_PROJECT_STORAGE_BUCKET = 'expo-projects';

const LOCATION_AND_SENSORS_APP_TSX = `import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import * as Location from 'expo-location';
import { Accelerometer, Pedometer } from 'expo-sensors';

export default function App() {
  const [lines, setLines] = useState<string[]>(['status:loading']);

  useEffect(() => {
    let active = true;

    void (async () => {
      const [
        foregroundPermission,
        currentPosition,
        providerStatus,
        servicesEnabled,
        stepCount,
      ] = await Promise.all([
        Location.requestForegroundPermissionsAsync(),
        Location.getCurrentPositionAsync(),
        Location.getProviderStatusAsync(),
        Location.hasServicesEnabledAsync(),
        Pedometer.getStepCountAsync(new Date(0), new Date(0)),
      ]);

      const sensorLines = await new Promise<string[]>((resolve) => {
        let resolved = false;
        const subscription = Accelerometer.addListener((reading) => {
          if (resolved) {
            return;
          }

          resolved = true;
          subscription.remove();
          resolve([
            'accelerometer:' +
              String(reading.x) +
              ',' +
              String(reading.y) +
              ',' +
              String(reading.z),
          ]);
        });

        setTimeout(() => {
          if (resolved) {
            return;
          }

          resolved = true;
          subscription.remove();
          resolve(['accelerometer:timeout']);
        }, 100);
      });

      if (!active) {
        return;
      }

      setLines([
        'status:ready',
        'permission:' + String(foregroundPermission.status),
        'coords:' +
          String(currentPosition.coords.latitude) +
          ',' +
          String(currentPosition.coords.longitude),
        'provider:' + String(providerStatus.locationServicesEnabled),
        'servicesEnabled:' + String(servicesEnabled),
        'steps:' + String(stepCount.steps),
        ...sensorLines,
      ]);
    })();

    return () => {
      active = false;
    };
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Wave E device services</Text>
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

const FILE_SYSTEM_AND_SECURE_STORE_APP_TSX = `import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import {
  Directory,
  File,
  Paths,
  getInfoAsync,
  readAsStringAsync,
} from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

export default function App() {
  const [lines, setLines] = useState<string[]>(['status:loading']);

  useEffect(() => {
    let active = true;

    void (async () => {
      const folder = new Directory(Paths.cache, 'device-services');
      folder.create();

      const file = new File(folder, 'token.txt');
      file.create();
      file.write('secure-preview-value');

      const fileText = file.textSync();
      const legacyText = await readAsStringAsync(file.uri);
      const fileInfo = await getInfoAsync(file.uri);
      await SecureStore.setItemAsync('device-token', 'abc123');
      const secureValue = await SecureStore.getItemAsync('device-token');
      await SecureStore.deleteItemAsync('device-token');
      const deletedValue = await SecureStore.getItemAsync('device-token');

      if (!active) {
        return;
      }

      setLines([
        'status:ready',
        'cache:' + Paths.cache,
        'fileUri:' + file.uri,
        'fileText:' + fileText,
        'legacyText:' + legacyText,
        'fileInfo:' +
          String(fileInfo.exists) +
          '/' +
          String(fileInfo.isDirectory) +
          '/' +
          String(fileInfo.size),
        'secureValue:' + String(secureValue),
        'secureDeleted:' + String(deletedValue),
      ]);
    })();

    return () => {
      active = false;
    };
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Wave E device storage</Text>
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

const LOCAL_AUTH_APP_TSX = `import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';

export default function App() {
  const [lines, setLines] = useState<string[]>(['status:loading']);

  useEffect(() => {
    let active = true;

    void (async () => {
      const [
        hasHardware,
        isEnrolled,
        enrolledLevel,
        authTypes,
        authResult,
      ] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
        LocalAuthentication.getEnrolledLevelAsync(),
        LocalAuthentication.supportedAuthenticationTypesAsync(),
        LocalAuthentication.authenticateAsync({
          promptMessage: 'Use Face ID',
        }),
      ]);
      await LocalAuthentication.cancelAuthenticate();

      if (!active) {
        return;
      }

      setLines([
        'status:ready',
        'hasHardware:' + String(hasHardware),
        'isEnrolled:' + String(isEnrolled),
        'enrolledLevel:' + String(enrolledLevel),
        'authTypes:' + String(authTypes.length),
        'authResult:' +
          String(authResult.success) +
          '/' +
          String('error' in authResult ? authResult.error : 'none'),
      ]);
    })();

    return () => {
      active = false;
    };
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Wave E local auth</Text>
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

    const editor = page
        .locator('[data-testid="project-editor"], body[data-onlook-loaded="true"]')
        .first();
    await editor.waitFor({ state: 'attached', timeout: 90_000 });

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

test.describe('Mobile preview Expo device-service shims', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeAll(async () => {
        const repoRoot = resolveRepoRoot();
        runVerificationSetup(repoRoot);
    });

    test('renders location and sensor device services through Expo shims', async ({
        page,
    }) => {
        test.setTimeout(180_000);

        await expectPreviewLines(
            page,
            LOCATION_AND_SENSORS_APP_TSX,
            'Wave E device services',
            [
                'status:ready',
                'permission:granted',
                'coords:0,0',
                'provider:true',
                'servicesEnabled:true',
                'steps:0',
                'accelerometer:0,0,0',
            ],
        );
    });

    test('renders file-system and secure-store device services through Expo shims', async ({
        page,
    }) => {
        test.setTimeout(180_000);

        await expectPreviewLines(
            page,
            FILE_SYSTEM_AND_SECURE_STORE_APP_TSX,
            'Wave E device storage',
            [
                'status:ready',
                'cache:file:///onlook/cache/',
                'fileUri:file:///onlook/cache/device-services/token.txt',
                'fileText:secure-preview-value',
                'legacyText:secure-preview-value',
                'fileInfo:true/false/20',
                'secureValue:abc123',
                'secureDeleted:null',
            ],
        );
    });

    test('renders local-authentication device services through Expo shims', async ({
        page,
    }) => {
        test.setTimeout(180_000);

        await expectPreviewLines(page, LOCAL_AUTH_APP_TSX, 'Wave E local auth', [
            'status:ready',
            'hasHardware:false',
            'isEnrolled:false',
            'enrolledLevel:0',
            'authTypes:0',
            'authResult:false/not_available',
        ]);
    });
});
