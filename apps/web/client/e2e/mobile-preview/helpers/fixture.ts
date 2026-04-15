export interface MobilePreviewFixtureFile {
    path: string;
    content: string;
}

export interface MobilePreviewFixture {
    projectId: string;
    branchId: string;
    projectName: string;
    branchName: string;
    appName: string;
    slug: string;
    sdkVersion: string;
    entryPath: string;
    expectedTitle: string;
    expectedSubtitle: string;
    files: readonly MobilePreviewFixtureFile[];
}

export const MOBILE_PREVIEW_FIXTURE_PROJECT_ID =
    '00000000-0000-0000-0000-000000000301';
export const MOBILE_PREVIEW_FIXTURE_BRANCH_ID =
    '00000000-0000-0000-0000-000000000303';
export const MOBILE_PREVIEW_FIXTURE_PROJECT_NAME =
    'onlook-mobile-preview-fixture';
export const MOBILE_PREVIEW_FIXTURE_BRANCH_NAME = 'wave-0';
export const MOBILE_PREVIEW_FIXTURE_APP_NAME =
    'Onlook Mobile Preview Fixture';
export const MOBILE_PREVIEW_FIXTURE_SLUG = 'onlook-mobile-preview-fixture';
export const MOBILE_PREVIEW_FIXTURE_SDK_VERSION = '54.0.0';
export const MOBILE_PREVIEW_FIXTURE_ENTRY_PATH = 'index.ts';
export const MOBILE_PREVIEW_FIXTURE_TITLE = 'Hello from mobile preview';
export const MOBILE_PREVIEW_FIXTURE_SUBTITLE = 'Wave 0 deterministic fixture';

const PACKAGE_JSON = `{
  "name": "onlook-mobile-preview-fixture",
  "version": "1.0.0",
  "main": "index.ts",
  "scripts": {
    "start": "expo start",
    "android": "expo start --android",
    "ios": "expo start --ios"
  },
  "dependencies": {
    "expo": "~54.0.0",
    "expo-status-bar": "~2.0.0",
    "react": "19.1.0",
    "react-native": "0.81.0"
  },
  "devDependencies": {
    "@babel/core": "^7.25.0",
    "@types/react": "~19.1.0",
    "typescript": "~5.6.0"
  },
  "private": true
}
`;

const APP_JSON = `{
  "expo": {
    "name": "Onlook Mobile Preview Fixture",
    "slug": "onlook-mobile-preview-fixture",
    "version": "1.0.0",
    "orientation": "portrait",
    "userInterfaceStyle": "automatic",
    "newArchEnabled": true,
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.onlook.mobilepreview.fixture"
    },
    "android": {
      "package": "com.onlook.mobilepreview.fixture"
    }
  }
}
`;

const BABEL_CONFIG = `module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
`;

const INDEX_TS = `import { AppRegistry } from 'react-native';
import App from './App';

AppRegistry.registerComponent('main', () => App);
`;

const APP_TSX = `import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { FixtureCard } from './components/FixtureCard';

export default function App() {
  return (
    <View style={styles.container}>
      <FixtureCard
        title="${MOBILE_PREVIEW_FIXTURE_TITLE}"
        subtitle="${MOBILE_PREVIEW_FIXTURE_SUBTITLE}"
      />
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
  },
});
`;

const FIXTURE_CARD_TSX = `import { StyleSheet, Text, View } from 'react-native';

export interface FixtureCardProps {
  title: string;
  subtitle: string;
}

export function FixtureCard({ title, subtitle }: FixtureCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 18,
    backgroundColor: '#111827',
  },
  title: {
    color: '#f9fafb',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    color: '#cbd5e1',
    fontSize: 14,
    lineHeight: 20,
  },
});
`;

const TSCONFIG_JSON = `{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "jsx": "react-jsx"
  },
  "include": [
    "**/*.ts",
    "**/*.tsx"
  ]
}
`;

const MOBILE_PREVIEW_FIXTURE_FILES: readonly MobilePreviewFixtureFile[] = [
    { path: 'package.json', content: PACKAGE_JSON },
    { path: 'app.json', content: APP_JSON },
    { path: 'babel.config.js', content: BABEL_CONFIG },
    { path: 'index.ts', content: INDEX_TS },
    { path: 'App.tsx', content: APP_TSX },
    { path: 'components/FixtureCard.tsx', content: FIXTURE_CARD_TSX },
    { path: 'tsconfig.json', content: TSCONFIG_JSON },
] as const;

export const MOBILE_PREVIEW_E2E_FIXTURE: MobilePreviewFixture = {
    projectId: MOBILE_PREVIEW_FIXTURE_PROJECT_ID,
    branchId: MOBILE_PREVIEW_FIXTURE_BRANCH_ID,
    projectName: MOBILE_PREVIEW_FIXTURE_PROJECT_NAME,
    branchName: MOBILE_PREVIEW_FIXTURE_BRANCH_NAME,
    appName: MOBILE_PREVIEW_FIXTURE_APP_NAME,
    slug: MOBILE_PREVIEW_FIXTURE_SLUG,
    sdkVersion: MOBILE_PREVIEW_FIXTURE_SDK_VERSION,
    entryPath: MOBILE_PREVIEW_FIXTURE_ENTRY_PATH,
    expectedTitle: MOBILE_PREVIEW_FIXTURE_TITLE,
    expectedSubtitle: MOBILE_PREVIEW_FIXTURE_SUBTITLE,
    files: MOBILE_PREVIEW_FIXTURE_FILES,
};

export function normalizeMobilePreviewFixturePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '');
}

export function getMobilePreviewFixtureFile(
    path: string,
): MobilePreviewFixtureFile | null {
    const normalizedPath = normalizeMobilePreviewFixturePath(path);

    for (const file of MOBILE_PREVIEW_E2E_FIXTURE.files) {
        if (file.path === normalizedPath) {
            return file;
        }
    }

    return null;
}

export function getMobilePreviewFixtureFileMap(): Map<string, string> {
    return new Map(
        MOBILE_PREVIEW_E2E_FIXTURE.files.map((file) => [file.path, file.content]),
    );
}

export function cloneMobilePreviewFixture(): MobilePreviewFixture {
    return {
        ...MOBILE_PREVIEW_E2E_FIXTURE,
        files: MOBILE_PREVIEW_E2E_FIXTURE.files.map((file) => ({ ...file })),
    };
}

const bunRuntime = (
    globalThis as typeof globalThis & {
        Bun?: { env?: Record<string, string | undefined> };
    }
).Bun;

if (bunRuntime && process.env.NODE_ENV === 'test') {
    const { describe, expect, test } = await import('bun:test');

    describe('MOBILE_PREVIEW_E2E_FIXTURE', () => {
        test('locks the fixture file tree', () => {
            expect(MOBILE_PREVIEW_E2E_FIXTURE.files.map((file) => file.path)).toEqual([
                'package.json',
                'app.json',
                'babel.config.js',
                'index.ts',
                'App.tsx',
                'components/FixtureCard.tsx',
                'tsconfig.json',
            ]);
        });

        test('keeps the package entry aligned with the fixture entry path', () => {
            const packageJson = getMobilePreviewFixtureFile('package.json');

            expect(packageJson?.content).toContain(
                `"main": "${MOBILE_PREVIEW_E2E_FIXTURE.entryPath}"`,
            );
            expect(getMobilePreviewFixtureFile('/index.ts')?.path).toBe('index.ts');
        });

        test('pins the expected render copy for later e2e assertions', () => {
            const appSource = getMobilePreviewFixtureFile('App.tsx');
            const componentSource = getMobilePreviewFixtureFile(
                'components/FixtureCard.tsx',
            );

            expect(appSource?.content).toContain('FixtureCard');
            expect(appSource?.content).toContain(
                MOBILE_PREVIEW_E2E_FIXTURE.expectedTitle,
            );
            expect(appSource?.content).toContain(
                MOBILE_PREVIEW_E2E_FIXTURE.expectedSubtitle,
            );
            expect(componentSource?.content).toContain('title: string');
            expect(componentSource?.content).toContain('subtitle: string');
        });
    });
}
