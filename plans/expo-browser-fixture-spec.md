# Expo browser fixture spec — minimal real-Expo project

**Owner task:** `TR0.2` (Wave R0 of `plans/expo-browser-e2e-task-queue.md`).
**Consumed by:** `TR0.6` (seed script), `TH1.3` (cf-esm-builder Container fixture), `TH4.2` (editor source-tar test).
**Source plan:** `plans/expo-browser-implementation.md`.

This file locks the **exact contents** of the smallest valid runnable Expo
project we will seed into Supabase Storage and ship through the Phase R / H / Q
pipelines. Every downstream task that needs "the fixture" reads file paths and
contents from here — there is one source of truth.

---

## Why Expo SDK 54

We pin **`expo@~54.0.0`** (React Native 0.81, React 19.1) for four concrete reasons:

1. **React version alignment.** Onlook's editor ships React 19.2.x. SDK 54
   is the first SDK that supports React 19.1, so the bundled `react` graph
   inside the canvas iframe is one minor away from the host — no duplicated
   React, no hook-context errors.
2. **Precompiled `react-native` C++ artifacts are default in SDK 54.** This
   cuts Phase H Container cold-build time by ~3–5 minutes compared to SDK 52,
   which is the difference between a usable smoke test and a CI timeout.
3. **Hermes is the default engine in SDK 54.** Phase H needs Hermes bytecode
   output (`0xc6 0x1f 0xbc 0x03` magic header, asserted in scenario 12) — no
   need to flip `jsEngine` in `app.json`.
4. **New Architecture is on by default.** Matches the Expo Go runtime that
   scenario 14 (TH6.1) scans manually with a phone, so we don't ship a fixture
   that diverges from real-world device defaults.

`react-native-web@~0.21` is the matching peer for RN 0.81 and is the version
the canvas iframe (`packages/browser-metro`) resolves through `esm.sh` in
Phase R.

---

## File tree

```
fixture/
├── package.json
├── app.json
├── babel.config.js
├── index.ts
├── App.tsx
├── tsconfig.json
└── components/
    └── Hello.tsx
```

Seven files, no assets, no native code, no `.gitignore`. Total ≈ 60 LOC of
hand-written source — small enough that `TH4.2`'s deterministic-tar test can
pin the exact byte count, large enough to exercise multi-file imports.

---

## File-by-file contents

### `package.json`

```json
{
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
```

### `app.json`

```json
{
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
```

### `babel.config.js`

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
```

### `index.ts`

```ts
import { AppRegistry } from 'react-native';
import App from './App';

// Required for Hermes / Expo Go (Phase H). Must register before the JS
// bundle finishes evaluating; the runtime looks up 'main' on first frame.
AppRegistry.registerComponent('main', () => App);
```

### `App.tsx`

```tsx
import { StatusBar } from 'expo-status-bar';
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
```

### `components/Hello.tsx`

```tsx
import { StyleSheet, Text, View } from 'react-native';

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
```

### `tsconfig.json`

```json
{
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
```

---

## What this exercises

The seven files above are the minimum needed to cover every code path in the
Phase R / H / Q pipelines:

- **Multi-file imports.** `App.tsx` imports `./components/Hello`, so the
  Phase R `vfs-walker` (TR2.1) and the Phase H `source-tar` (TH4.2) both
  must walk more than the entry file. A single-file fixture would have hidden
  bugs in the recursive walker.
- **Bare module imports.** `react`, `react-native`, `react-native-web`,
  `expo-status-bar`. Phase R's `bare-import-rewriter` (TR2.3) rewrites these
  to `esm.sh` URLs; Phase H's Metro inside the Container resolves them from
  the real `node_modules`.
- **TypeScript + JSX.** Both `.tsx` files exercise the SWC/Babel pipeline in
  the browser-metro worker (TR2.2) and the `babel-preset-expo` toolchain
  inside cf-esm-builder (TH1.1).
- **Typed component props.** `HelloProps` ensures the TS transform isn't
  silently dropping types (a regression we hit twice in pre-R0 verification).
- **`StyleSheet.create`.** Exercises `react-native-web`'s style normalization
  in the canvas iframe — without it, Phase R could "render" but produce
  unstyled DOM and we'd ship a false-pass.
- **`AppRegistry.registerComponent('main', ...)`.** The `index.ts` entry is
  what makes this a *runnable* Expo project, not just a buildable one.
  Phase H scenario 14 (TH6.1) requires an Expo Go phone to actually mount
  the component — without `AppRegistry.registerComponent`, Hermes evaluates
  the bundle and then idles forever.
- **Real `app.json` + `babel.config.js`.** TH1.3's container smoke test runs
  `bunx expo export:embed` against this fixture; both files are mandatory
  for the Expo CLI to recognize the directory as a project.
- **Asset references — intentionally none.** A future R/H wave will add a
  PNG to test the asset pipeline, but R0 keeps the fixture asset-free so the
  TH4.2 deterministic-tar test can pin a small fixed byte count.

---

## Cross-references

- **`TR0.6`** (`scripts/seed-expo-fixture.ts`) reads this spec and writes
  the seven files into Supabase Storage under
  `expo-projects/${PROJECT_ID}/${BRANCH_ID}/`. The seed script is idempotent —
  re-running it must leave the bucket byte-identical.
- **`TH1.3`** (`apps/cf-esm-builder/container/__tests__/fixtures/minimal-expo/`)
  copies the same seven files into the Container test fixture so the
  Dockerfile's `bunx expo export:embed` smoke test runs against the exact
  same project the editor will ship through the source-tar route.
- **`TH4.2`** (`apps/web/client/src/services/expo-builder/source-tar.ts`)
  walks `CodeFileSystem` and produces a deterministic tar. Its unit test
  uses this fixture as the expected input and pins the resulting tar SHA256.

When this spec changes, all three downstream tasks must update in lockstep —
treat any edit here as a coordinated 4-task PR (`TR0.2 + TR0.6 + TH1.3 + TH4.2`).
