#!/usr/bin/env bun
/**
 * scripts/seed-expo-fixture.ts
 *
 * TR0.6 — seeds the canonical Expo fixture from
 * `plans/expo-browser-fixture-spec.md` into the local Supabase Storage
 * bucket `expo-projects` under the test PROJECT_ID/BRANCH_ID prefix.
 *
 * Idempotent: every upload uses { upsert: true }, so re-running the
 * script leaves the bucket byte-identical.
 *
 * Run via:
 *   bun run scripts/seed-expo-fixture.ts
 *
 * The fixture file list is hardcoded below to keep this script standalone
 * and to make the bytes byte-stable across re-runs. Contents are copied
 * verbatim from `plans/expo-browser-fixture-spec.md` (TR0.2). When that
 * spec changes, this file MUST update in lockstep — see TR0.2/TR0.6/TH1.3/
 * TH4.2 cross-references in the spec.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOCAL_API_URL = 'http://127.0.0.1:54321';
// Same value as `LOCAL_SERVICE_KEY` in
// apps/web/client/verification/onlook-editor/setup.sh — the local-dev
// Supabase service-role key. NOT a secret; only valid against the local
// container.
const LOCAL_SERVICE_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const PROJECT_ID = '2bff33ae-7334-457e-a69e-93a5d90b18b3';
const BRANCH_ID = 'fcebdee5-1010-4147-9748-823a27dc36a3';
const BUCKET = 'expo-projects';

// ---------------------------------------------------------------------------
// Fixture file list — verbatim from plans/expo-browser-fixture-spec.md
// ---------------------------------------------------------------------------

interface FixtureFile {
    /** Logical path relative to the fixture root (no leading slash). */
    path: string;
    /** Raw file contents — ASCII; no trailing newline normalization. */
    content: string;
}

const PACKAGE_JSON = `{
  "name": "onlook-expo-fixture",
  "version": "1.0.0",
  "main": "index.ts",
  "scripts": {
    "start": "expo start",
    "android": "expo start --android",
    "ios": "expo start --ios",
    "web": "expo start --web"
  },
  "dependencies": {
    "expo": "~54.0.0",
    "expo-status-bar": "~2.0.0",
    "react": "19.1.0",
    "react-native": "0.81.0",
    "react-native-web": "~0.21.0"
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
    "name": "onlook-expo-fixture",
    "slug": "onlook-expo-fixture",
    "version": "1.0.0",
    "orientation": "portrait",
    "userInterfaceStyle": "automatic",
    "newArchEnabled": true,
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.onlook.fixture"
    },
    "android": {
      "package": "com.onlook.fixture"
    },
    "web": {
      "bundler": "metro"
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

// Required for Hermes / Expo Go (Phase H). Must register before the JS
// bundle finishes evaluating; the runtime looks up 'main' on first frame.
AppRegistry.registerComponent('main', () => App);
`;

const APP_TSX = `import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { Hello } from './components/Hello';

export default function App() {
  return (
    <View style={styles.container}>
      <Hello name="Onlook" />
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0b0f',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
`;

const HELLO_TSX = `import { StyleSheet, Text, View } from 'react-native';

export interface HelloProps {
  name: string;
}

export function Hello({ name }: HelloProps) {
  return (
    <View style={styles.box}>
      <Text style={styles.text}>Hello, {name}!</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#1a1a22',
  },
  text: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
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

const FIXTURE_FILES: readonly FixtureFile[] = [
    { path: 'package.json', content: PACKAGE_JSON },
    { path: 'app.json', content: APP_JSON },
    { path: 'babel.config.js', content: BABEL_CONFIG },
    { path: 'index.ts', content: INDEX_TS },
    { path: 'App.tsx', content: APP_TSX },
    { path: 'components/Hello.tsx', content: HELLO_TSX },
    { path: 'tsconfig.json', content: TSCONFIG_JSON },
];

// ---------------------------------------------------------------------------
// Upload logic
// ---------------------------------------------------------------------------

/**
 * Build a bucket key matching `SupabaseStorageAdapter.toKey` —
 * `${projectId}/${branchId}/<logicalPath>` with no leading slash.
 */
function buildKey(logicalPath: string): string {
    const trimmed = logicalPath.replace(/^\/+/, '').replace(/^\.\//, '');
    return `${PROJECT_ID}/${BRANCH_ID}/${trimmed}`;
}

async function uploadFixtureFile(
    client: SupabaseClient,
    file: FixtureFile,
): Promise<void> {
    const key = buildKey(file.path);
    const body = new Blob([file.content], { type: 'application/octet-stream' });
    const { error } = await client.storage.from(BUCKET).upload(key, body, {
        upsert: true,
        contentType: 'application/octet-stream',
    });
    if (error) {
        throw new Error(`upload failed for ${key}: ${error.message}`);
    }
}

async function main(): Promise<void> {
    const client: SupabaseClient = createClient(LOCAL_API_URL, LOCAL_SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
    });

    let uploaded = 0;
    for (const file of FIXTURE_FILES) {
        await uploadFixtureFile(client, file);
        uploaded += 1;
    }

    console.log(
        `[seed-expo-fixture] uploaded ${uploaded} files to ${BUCKET}/${PROJECT_ID}/${BRANCH_ID}/`,
    );
}

// Only execute when run directly (not when imported by the validate-only
// `bun -e import('./scripts/seed-expo-fixture.ts')` smoke test in TR0.6).
if (import.meta.main) {
    try {
        await main();
        process.exit(0);
    } catch (err) {
        console.error('[seed-expo-fixture] failed:', err);
        process.exit(1);
    }
}
