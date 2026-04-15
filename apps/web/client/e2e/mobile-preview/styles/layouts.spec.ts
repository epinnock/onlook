import { expect, test } from '@playwright/test';

import type { MobilePreviewFixture } from '../helpers/fixture';
import { seedMobilePreviewFixture } from '../helpers/seed-fixture';

const WAVE_D_LAYOUTS_PROJECT_ID = '00000000-0000-0000-0000-0000000003d1';
const WAVE_D_LAYOUTS_BRANCH_ID = '00000000-0000-0000-0000-0000000003d2';
const WAVE_D_LAYOUTS_TITLE = 'Wave D layout fixture';
const WAVE_D_LAYOUTS_SUBTITLE =
    'Transforms, percentages, and layering should hold steady.';

const WAVE_D_LAYOUTS_PACKAGE_JSON = `{
  "name": "onlook-mobile-preview-wave-d-layouts",
  "version": "1.0.0",
  "main": "index.ts",
  "scripts": {
    "start": "expo start",
    "android": "expo start --android",
    "ios": "expo start --ios"
  },
  "dependencies": {
    "expo": "~54.0.0",
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

const WAVE_D_LAYOUTS_APP_JSON = `{
  "expo": {
    "name": "Onlook Mobile Preview Wave D Layouts",
    "slug": "onlook-mobile-preview-wave-d-layouts",
    "version": "1.0.0",
    "orientation": "portrait",
    "userInterfaceStyle": "automatic",
    "newArchEnabled": true
  }
}
`;

const WAVE_D_LAYOUTS_BABEL_CONFIG = `module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
`;

const WAVE_D_LAYOUTS_INDEX_TS = `import { AppRegistry } from 'react-native';
import App from './App';

AppRegistry.registerComponent('main', () => App);
`;

const WAVE_D_LAYOUTS_APP_TSX = `import { StyleSheet, View } from 'react-native';
import { WaveDLayoutScene } from './components/WaveDLayoutScene';

export default function App() {
  return (
    <View style={styles.container}>
      <WaveDLayoutScene
        title="${WAVE_D_LAYOUTS_TITLE}"
        subtitle="${WAVE_D_LAYOUTS_SUBTITLE}"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020617',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
});
`;

const WAVE_D_LAYOUTS_SCENE_TSX = `import { StyleSheet, Text, View } from 'react-native';

export interface WaveDLayoutSceneProps {
  title: string;
  subtitle: string;
}

export function WaveDLayoutScene({ title, subtitle }: WaveDLayoutSceneProps) {
  return (
    <View style={styles.shell} testID="wave-d-layout-shell">
      <Text style={styles.eyebrow}>Wave D layouts</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>

      <View style={styles.stage} testID="wave-d-layout-stage">
        <View style={styles.viewport} testID="wave-d-layout-viewport">
          <View style={styles.percentagePanel} testID="percentage-panel">
            <Text style={styles.panelLabel}>Percentage panel</Text>
          </View>

          <View style={[styles.layerCard, styles.baseLayer]} testID="base-layer">
            <Text style={styles.layerText}>Base layer</Text>
          </View>
          <View style={[styles.layerCard, styles.midLayer]} testID="mid-layer">
            <Text style={styles.layerText}>Mid layer</Text>
          </View>
          <View style={[styles.layerCard, styles.topLayer]} testID="top-layer">
            <Text style={styles.layerText}>Top layer</Text>
          </View>

          <View style={styles.transformBadge} testID="transform-badge">
            <Text style={styles.transformText}>Transform badge</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 18,
    backgroundColor: '#0f172a',
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
    marginBottom: 18,
  },
  stage: {
    alignItems: 'center',
  },
  viewport: {
    width: 280,
    height: 320,
    borderRadius: 22,
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#111827',
  },
  percentagePanel: {
    position: 'absolute',
    top: 18,
    left: 18,
    width: '72%',
    height: '36%',
    minWidth: '48%',
    maxWidth: '86%',
    minHeight: '28%',
    maxHeight: '52%',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#1d4ed8',
    justifyContent: 'flex-end',
  },
  panelLabel: {
    color: '#eff6ff',
    fontSize: 13,
    fontWeight: '700',
  },
  layerCard: {
    position: 'absolute',
    width: 168,
    height: 120,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: 'flex-end',
  },
  baseLayer: {
    left: 18,
    bottom: 24,
    backgroundColor: '#0f766e',
    opacity: 0.48,
    zIndex: 1,
  },
  midLayer: {
    left: 56,
    bottom: 54,
    backgroundColor: '#f97316',
    opacity: 0.72,
    zIndex: 2,
  },
  topLayer: {
    right: 18,
    bottom: 30,
    backgroundColor: '#f8fafc',
    opacity: 0.94,
    zIndex: 3,
  },
  layerText: {
    color: '#020617',
    fontSize: 12,
    fontWeight: '700',
  },
  transformBadge: {
    position: 'absolute',
    top: 72,
    right: 18,
    width: 112,
    height: 68,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e879f9',
    transform: [
      { translateX: 10 },
      { translateY: -8 },
      { rotate: '-14deg' },
      { scale: 1.08 },
    ],
    zIndex: 4,
  },
  transformText: {
    color: '#4a044e',
    fontSize: 12,
    fontWeight: '800',
  },
});
`;

const WAVE_D_LAYOUTS_TSCONFIG_JSON = `{
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

const WAVE_D_LAYOUTS_FIXTURE: MobilePreviewFixture = {
    projectId: WAVE_D_LAYOUTS_PROJECT_ID,
    branchId: WAVE_D_LAYOUTS_BRANCH_ID,
    projectName: 'onlook-mobile-preview-wave-d-layouts',
    branchName: 'wave-d-layouts',
    appName: 'Onlook Mobile Preview Wave D Layouts',
    slug: 'onlook-mobile-preview-wave-d-layouts',
    sdkVersion: '54.0.0',
    entryPath: 'index.ts',
    expectedTitle: WAVE_D_LAYOUTS_TITLE,
    expectedSubtitle: WAVE_D_LAYOUTS_SUBTITLE,
    files: [
        { path: 'package.json', content: WAVE_D_LAYOUTS_PACKAGE_JSON },
        { path: 'app.json', content: WAVE_D_LAYOUTS_APP_JSON },
        { path: 'babel.config.js', content: WAVE_D_LAYOUTS_BABEL_CONFIG },
        { path: 'index.ts', content: WAVE_D_LAYOUTS_INDEX_TS },
        { path: 'App.tsx', content: WAVE_D_LAYOUTS_APP_TSX },
        {
            path: 'components/WaveDLayoutScene.tsx',
            content: WAVE_D_LAYOUTS_SCENE_TSX,
        },
        { path: 'tsconfig.json', content: WAVE_D_LAYOUTS_TSCONFIG_JSON },
    ],
};

function getFixtureSource(path: string): string {
    const file = WAVE_D_LAYOUTS_FIXTURE.files.find((entry) => entry.path === path);

    if (!file) {
        throw new Error(`Missing fixture file: ${path}`);
    }

    return file.content;
}

test.describe('Mobile preview Wave D layouts', () => {
    test('defines the deterministic Expo fixture file tree for layout coverage', async () => {
        expect(WAVE_D_LAYOUTS_FIXTURE.projectId).toBe(WAVE_D_LAYOUTS_PROJECT_ID);
        expect(WAVE_D_LAYOUTS_FIXTURE.branchId).toBe(WAVE_D_LAYOUTS_BRANCH_ID);
        expect(WAVE_D_LAYOUTS_FIXTURE.expectedTitle).toBe(WAVE_D_LAYOUTS_TITLE);
        expect(WAVE_D_LAYOUTS_FIXTURE.expectedSubtitle).toBe(
            WAVE_D_LAYOUTS_SUBTITLE,
        );
        expect(WAVE_D_LAYOUTS_FIXTURE.files.map((file) => file.path)).toEqual([
            'package.json',
            'app.json',
            'babel.config.js',
            'index.ts',
            'App.tsx',
            'components/WaveDLayoutScene.tsx',
            'tsconfig.json',
        ]);
        expect(getFixtureSource('App.tsx')).toContain('WaveDLayoutScene');
    });

    test('covers transform-driven layout markers in the scene source', async () => {
        const sceneSource = getFixtureSource('components/WaveDLayoutScene.tsx');

        expect(sceneSource).toContain("testID=\"transform-badge\"");
        expect(sceneSource).toContain('Transform badge');
        expect(sceneSource).toContain('{ translateX: 10 }');
        expect(sceneSource).toContain('{ translateY: -8 }');
        expect(sceneSource).toContain("{ rotate: '-14deg' }");
        expect(sceneSource).toContain('{ scale: 1.08 }');
    });

    test('covers percentage dimensions relative to the viewport in the scene source', async () => {
        const sceneSource = getFixtureSource('components/WaveDLayoutScene.tsx');

        expect(sceneSource).toContain("testID=\"percentage-panel\"");
        expect(sceneSource).toContain("width: '72%'");
        expect(sceneSource).toContain("height: '36%'");
        expect(sceneSource).toContain("minWidth: '48%'");
        expect(sceneSource).toContain("maxWidth: '86%'");
        expect(sceneSource).toContain("minHeight: '28%'");
        expect(sceneSource).toContain("maxHeight: '52%'");
    });

    test('covers layered surfaces with opacity, overflow, and zIndex markers', async () => {
        const sceneSource = getFixtureSource('components/WaveDLayoutScene.tsx');

        expect(sceneSource).toContain("testID=\"base-layer\"");
        expect(sceneSource).toContain("testID=\"mid-layer\"");
        expect(sceneSource).toContain("testID=\"top-layer\"");
        expect(sceneSource).toContain("overflow: 'hidden'");
        expect(sceneSource).toContain('opacity: 0.48');
        expect(sceneSource).toContain('opacity: 0.72');
        expect(sceneSource).toContain('opacity: 0.94');
        expect(sceneSource).toContain('zIndex: 1');
        expect(sceneSource).toContain('zIndex: 2');
        expect(sceneSource).toContain('zIndex: 3');
        expect(sceneSource).toContain('zIndex: 4');
    });

    test('seeds the Wave D layout fixture deterministically for later device assertions', async () => {
        const files = new Map<string, string>();

        const target = {
            async mkdir() {
                return undefined;
            },
            async readFile(path: string) {
                const content = files.get(path);
                if (content == null) {
                    throw new Error(`ENOENT: ${path}`);
                }
                return content;
            },
            async writeFile(path: string, content: string) {
                files.set(path, content);
            },
        };

        const firstSeed = await seedMobilePreviewFixture(target, {
            basePath: 'workspace/mobile-preview-wave-d',
            fixture: WAVE_D_LAYOUTS_FIXTURE,
        });
        const secondSeed = await seedMobilePreviewFixture(target, {
            basePath: 'workspace/mobile-preview-wave-d',
            fixture: WAVE_D_LAYOUTS_FIXTURE,
        });

        expect(firstSeed.createdPaths).toHaveLength(
            WAVE_D_LAYOUTS_FIXTURE.files.length,
        );
        expect(firstSeed.updatedPaths).toHaveLength(0);
        expect(secondSeed.createdPaths).toHaveLength(0);
        expect(secondSeed.updatedPaths).toHaveLength(0);
        expect(secondSeed.unchangedPaths).toHaveLength(
            WAVE_D_LAYOUTS_FIXTURE.files.length,
        );
        expect(
            files.get('workspace/mobile-preview-wave-d/components/WaveDLayoutScene.tsx'),
        ).toContain("width: '72%'");
        expect(
            files.get('workspace/mobile-preview-wave-d/components/WaveDLayoutScene.tsx'),
        ).toContain("{ rotate: '-14deg' }");
    });
});
