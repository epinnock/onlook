/**
 * Minimal Expo blank template. Uploaded into Supabase Storage at
 * `expo-projects/{projectId}/{branchId}/…` when a new project with
 * providerType='expo_browser' is created, so the editor's file tree is
 * populated from the first render. Runtime bundling happens browser-side via
 * @onlook/browser-metro — no `npm install` is required before the preview is
 * scannable.
 */

export interface ExpoBrowserTemplateFile {
    path: string;
    content: string;
}

const PACKAGE_JSON = JSON.stringify(
    {
        name: 'new-project',
        version: '1.0.0',
        main: 'node_modules/expo/AppEntry.js',
        scripts: {
            start: 'expo start',
            android: 'expo start --android',
            ios: 'expo start --ios',
            web: 'expo start --web',
        },
        dependencies: {
            expo: '~51.0.0',
            'expo-status-bar': '~1.12.1',
            react: '18.2.0',
            'react-native': '0.74.5',
        },
        devDependencies: {
            '@babel/core': '^7.20.0',
            '@types/react': '~18.2.45',
            typescript: '^5.1.3',
        },
        private: true,
    },
    null,
    2,
) + '\n';

const APP_JSON = JSON.stringify(
    {
        expo: {
            name: 'New Project',
            slug: 'new-project',
            version: '1.0.0',
            orientation: 'portrait',
            userInterfaceStyle: 'light',
            ios: { supportsTablet: true },
            android: { adaptiveIcon: { backgroundColor: '#ffffff' } },
            web: { bundler: 'metro' },
        },
    },
    null,
    2,
) + '\n';

const APP_TSX = `import './onlook-preload-script.js';
import { StyleSheet, Text, View } from 'react-native';

export default function App() {
    return (
        <View style={styles.container}>
            <Text style={styles.title}>Hello, Onlook!</Text>
            <Text style={styles.subtitle}>Edit App.tsx to start building.</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
    title: {
        fontSize: 28,
        fontWeight: '700',
        marginBottom: 12,
    },
    subtitle: {
        fontSize: 16,
        color: '#555',
        textAlign: 'center',
    },
});
`;

const BABEL_CONFIG_JS = `module.exports = function (api) {
    api.cache(true);
    return {
        presets: ['babel-preset-expo'],
    };
};
`;

const TSCONFIG_JSON = JSON.stringify(
    {
        extends: 'expo/tsconfig.base',
        compilerOptions: {
            strict: true,
            jsx: 'react-jsx',
        },
        include: ['**/*.ts', '**/*.tsx'],
    },
    null,
    2,
) + '\n';

// Dual-runtime entry. Native (Expo Go / Hermes): AppRegistry.registerComponent
// is enough — the native runtime calls runApplication('main', …) itself. Web
// (@onlook/browser-metro bundle): we also explicitly call runApplication with
// a rootTag so the component mounts into the `#root` / `#main` element the
// preview page provides. Wrapped in `Platform.OS === 'web'` so the DOM branch
// is dead-code-eliminated on native and never touches `document`.
const INDEX_TS = `import { AppRegistry, Platform } from 'react-native';

import App from './App';

AppRegistry.registerComponent('main', () => App);

if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const rootTag =
        document.getElementById('root') ?? document.getElementById('main');
    if (rootTag) {
        AppRegistry.runApplication('main', { rootTag });
    }
}
`;

// Stub the editor-injected preload script so App.tsx's top-level import
// resolves even before the editor writes its real version on first save.
// The browser bundler resolves the bare specifier 'onlook-preload-script.js'
// to an empty module regardless (it's in the bundler's built-in allowlist),
// but having a real file means the editor's file tree isn't missing it and
// the user can inspect / override it.
const ONLOOK_PRELOAD_SCRIPT_JS = `// Onlook preload script — the editor overwrites this on first edit.
// Keep this file as a no-op until then so the \`import './onlook-preload-script.js'\`
// in App.tsx resolves cleanly.
export {};
`;

export const expoBlankTemplate: readonly ExpoBrowserTemplateFile[] = [
    { path: 'package.json', content: PACKAGE_JSON },
    { path: 'app.json', content: APP_JSON },
    { path: 'App.tsx', content: APP_TSX },
    { path: 'babel.config.js', content: BABEL_CONFIG_JS },
    { path: 'tsconfig.json', content: TSCONFIG_JSON },
    { path: 'index.ts', content: INDEX_TS },
    { path: 'onlook-preload-script.js', content: ONLOOK_PRELOAD_SCRIPT_JS },
];

export const EXPO_BROWSER_TEMPLATES = {
    expo_blank: expoBlankTemplate,
} as const;

export type ExpoBrowserTemplateId = keyof typeof EXPO_BROWSER_TEMPLATES;
