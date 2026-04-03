# Expo Snack Provider Implementation Plan

> Replace CodeSandbox with Expo Snack SDK for React Native/Expo projects.

## Executive Overview

CodeSandbox has proven unstable for Expo projects: WebSocket disconnections, long setup times (npm install takes 1-2 minutes), container exec failures, and 502 errors on preview URLs. Expo Snack is purpose-built for React Native and eliminates these issues entirely — no containers, no npm install wait, instant preview on real devices via Expo Go.

**Investment:** ~3-4 weeks across 4 phases
**Risk:** Snack has no terminal/CLI — need to design around this limitation
**Upside:** Instant project boot, real device preview, zero container overhead

## Why Snack Over CodeSandbox

| Issue | CodeSandbox | Snack |
|-------|------------|-------|
| Boot time | 1-2 min (npm install) | Instant (bundled in browser) |
| WebSocket stability | Frequent disconnects | Purpose-built real-time sync |
| Preview | 502 errors, privacy issues | Direct Expo Go + web player |
| Expo support | Secondary, template-based | Native, first-class |
| Terminal | Full shell (overkill for RN) | No shell (not needed for visual editing) |
| Mobile preview | None | Real device via Expo Go QR code |
| Cost | Per-seat ($12/mo) | Free (Expo platform) |

## How Snack SDK Works

```
Scry IDE (Browser)
    |
    |--- Snack SDK Instance (in-browser)
    |       |
    |       |--- updateFiles() → code changes
    |       |--- updateDependencies() → package management
    |       |--- setOnline(true) → enable device connections
    |       |
    |       |--- State Listeners
    |       |       |--- onStateChange → file sync
    |       |       |--- onLog → console output
    |       |       |--- onError → error handling
    |       |       |--- onPresence → device connections
    |       |
    |       |--- Preview
    |               |--- Web: iframe with Snack web player
    |               |--- Mobile: Expo Go via QR code / deep link
    |               |--- Emulator: Appetize.io
    |
    |--- No server needed (Snack runs client-side)
```

Key insight: **Snack runs entirely in the browser**. No server, no container, no Worker. The Snack SDK bundles and compiles code client-side, then streams it to connected devices.

## Snack SDK Core API

```typescript
import { Snack } from 'snack-sdk';

const snack = new Snack({
    name: 'My Project',
    description: 'Created with Scry IDE',
    sdkVersion: '52.0.0',
    files: {
        'App.tsx': { type: 'CODE', contents: 'export default () => <Text>Hello</Text>' },
    },
    dependencies: {
        'expo': { version: '~52.0.0' },
        'react-native-paper': { version: '4.9.2' },
    },
});

// Go online — enables device connections and preview URLs
snack.setOnline(true);

// Get shareable URL / QR code
const url = await snack.getUrlAsync(); // exp://exp.host/@snack/...

// File operations
snack.updateFiles({
    'App.tsx': { type: 'CODE', contents: 'updated code...' },
    'components/Button.tsx': { type: 'CODE', contents: '...' },
});

// Dependency management
snack.updateDependencies({
    'react-native-paper': { version: '5.0.0' },
});

// Listen for state changes
snack.addStateListener((state) => {
    // state.files, state.dependencies, state.connectedClients, etc.
});

// Listen for console output from device
snack.addLogListener((log) => {
    console.log(log.message); // Real device console.log output
});

// Listen for errors
snack.addErrorListener((error) => {
    console.error(error.message);
});

// Save to Expo servers (permanent URL)
const { id } = await snack.saveAsync();

// Get download URL (ZIP)
const downloadUrl = await snack.getDownloadURLAsync();
```

## Provider Interface Mapping

| Provider Method | Snack SDK Equivalent | Notes |
|----------------|---------------------|-------|
| `readFile` | `getState().files[path]` | Read from in-memory state |
| `writeFile` | `updateFiles({ [path]: { type: 'CODE', contents } })` | Update state, auto-syncs |
| `listFiles` | `Object.keys(getState().files)` | Flat file list from state |
| `deleteFiles` | `updateFiles({ [path]: null })` | Set to null to delete |
| `renameFile` | Read + delete old + write new | No native rename |
| `createDirectory` | No-op (flat file structure) | Snack uses virtual paths |
| `watchFiles` | `addStateListener()` | State change events |
| `createTerminal` | **Not supported** | No shell access |
| `runCommand` | **Not supported** | No CLI execution |
| `getTask` | **Partial** — `addLogListener()` | Console output only |
| `ping` | Check `getState().online` | Online status check |
| `destroy` | `stopAsync()` | Cleanup |
| `createProject` | `new Snack({ files, deps })` | Instantiate with initial state |
| `createProjectFromGit` | Fetch repo → `new Snack({ files })` | Manual GitHub fetch required |

## Architecture

### Provider Class

```typescript
// packages/code-provider/src/providers/snack/index.ts

export class SnackProvider extends Provider {
    private snack: Snack | null = null;
    private fileCache: Map<string, string> = new Map();

    constructor(options: SnackProviderOptions) {
        super();
    }

    async initialize() {
        this.snack = new Snack({
            name: this.options.name || 'Scry Project',
            sdkVersion: this.options.sdkVersion || '52.0.0',
            files: this.options.initialFiles || {},
            dependencies: this.options.dependencies || {},
        });

        this.snack.setOnline(true);

        // Sync file cache from state changes
        this.snack.addStateListener((state) => {
            for (const [path, file] of Object.entries(state.files)) {
                if (file && file.type === 'CODE') {
                    this.fileCache.set(path, file.contents);
                }
            }
        });
    }

    async readFile(input) {
        const state = this.snack!.getState();
        const file = state.files[input.args.path];
        return { content: file?.contents || '' };
    }

    async writeFile(input) {
        this.snack!.updateFiles({
            [input.args.path]: { type: 'CODE', contents: input.args.content },
        });
        return {};
    }

    // Terminal — use console log listener as a pseudo-terminal
    async createTerminal() {
        return { terminal: new SnackLogTerminal(this.snack!) };
    }

    // No real command execution — return a meaningful message
    async runCommand(input) {
        return { output: '[Snack] Command execution not available. Use the Expo Go app for testing.' };
    }
}
```

### GitHub Repo Integration

Since Snack doesn't support git cloning, we need a fetch layer:

```typescript
async function fetchGitHubRepoAsSnackFiles(
    repoUrl: string,
    branch: string = 'main',
): Promise<Record<string, SnackFile>> {
    const [owner, repo] = repoUrl.replace('https://github.com/', '').split('/');

    // Fetch repo tree via GitHub API
    const tree = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`
    ).then(r => r.json());

    const files: Record<string, SnackFile> = {};

    // Fetch each file's content
    for (const item of tree.tree) {
        if (item.type === 'blob' && isCodeFile(item.path)) {
            const content = await fetch(
                `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${item.path}`
            ).then(r => r.text());

            files[item.path] = { type: 'CODE', contents: content };
        }
    }

    return files;
}
```

### Preview Integration

Snack preview works via iframe (web) or Expo Go (mobile):

```typescript
// Web preview — embed Snack web player in iframe
const webPreviewUrl = `https://snack.expo.dev/embedded?sdkVersion=${sdkVersion}`;

// Mobile preview — generate QR code URL
const expoUrl = await snack.getUrlAsync();
// Returns: exp://exp.host/@snack/sdk.52.0.0-abcdef
```

For Scry IDE's canvas, the web preview iframe would replace the CodeSandbox preview iframe.

## Phases

### Phase 0: Contracts & Types (3 days)

- Add `ExpoSnack = 'expo_snack'` to `CodeProvider` enum
- Create `SnackProviderOptions` interface
- Create `packages/code-provider/src/providers/snack/types.ts`
- Install `snack-sdk` package
- Define the file sync strategy interface

### Phase 1: Core Provider (1 week)

- Implement `SnackProvider extends Provider`
- File operations: readFile, writeFile, listFiles, deleteFiles (all in-memory via Snack state)
- Snack lifecycle: initialize, setup, ping, destroy
- State listener integration for file watching
- Console log listener as pseudo-terminal output

### Phase 2: GitHub Integration + Preview (1 week)

- GitHub repo → Snack files fetcher
- `createProjectFromGit` implementation
- Web preview iframe integration (replace CSB preview URL)
- QR code generation for Expo Go preview
- Dependency detection from package.json

### Phase 3: Session Manager + UI (1 week)

- Add Snack routing to SessionManager (detect `snack-` prefix)
- tRPC route: `snackSandbox.create` (client-side, no server needed)
- Update Create dropdown with "Expo (Snack)" option
- Preview URL handling for Snack web player
- Error/log streaming to terminal panel

### Phase 4: Polish & Testing (3 days)

- Unit tests for SnackProvider
- E2E tests for create → edit → preview flow
- Handle edge cases: large files, binary assets, offline mode
- Performance optimization for file sync

## Key Design Decisions

### 1. No Terminal — Use Log Panel Instead

Snack has no shell. Instead of faking a terminal:
- Route `console.log` output from Snack's log listener to the terminal panel
- Show Expo bundler output (errors, warnings) in the terminal
- Disable the "terminal" tab for Snack projects, show only "server" tab with logs

### 2. Client-Side Provider

Unlike CodeSandbox (which needs server-side SDK + tRPC), Snack runs entirely client-side:
- No tRPC route needed for Snack operations
- Provider instantiated directly in the browser
- No Worker, no Docker, no server proxy
- Reduces complexity significantly

### 3. Preview via Snack Web Player

Snack's web player renders in an iframe:
```
https://snack.expo.dev/embedded/@snack/{id}?preview=true&platform=web
```
This replaces the `{sandboxId}-{port}.csb.app` pattern. No 502 errors, no privacy issues.

### 4. File Sync Strategy

Snack's file model is flat (no real directories). Strategy:
- Maintain a virtual directory tree client-side
- Map paths like `components/Button.tsx` directly to Snack file keys
- `listFiles('/components')` → filter `Object.keys(state.files)` by prefix
- `createDirectory()` → no-op (directories are implicit in Snack)

## Risks

| Risk | Mitigation |
|------|-----------|
| No terminal/CLI | Use log listener for output; disable terminal tab |
| Snack SDK version lag | Pin to stable SDK version, test with each Expo release |
| Large project performance | Snack designed for small-medium projects; may need file splitting |
| GitHub rate limiting | Cache fetched files, use authenticated requests |
| Web preview limitations | Web player doesn't support all RN features; mobile preview as fallback |
| Dependency resolution | Snack's bundler may reject some npm packages |

## Cost

**Free.** Snack is part of the Expo platform with no per-seat or usage-based pricing. The SDK is open-source (MIT license).

## Comparison: CSB vs Snack vs Cloudflare

| | CodeSandbox | Snack | Cloudflare |
|--|-----------|-------|-----------|
| Boot time | 1-2 min | Instant | 10-30s |
| Terminal | Full shell | No | Full shell |
| Expo support | Template | Native | Container |
| Mobile preview | No | Expo Go | No |
| Stability | Unstable (WS drops) | Stable | Beta |
| Cost | $12/seat | Free | $5/mo + usage |
| Architecture | Server + container | Client-side only | Worker + container |
| Best for | General dev | RN/Expo visual editing | Full-stack |

## Recommendation

For Scry IDE's Expo/React Native use case, **Snack is the best fit**:
- Instant boot (no npm install wait)
- Real device preview via Expo Go
- No server infrastructure needed
- Free
- Purpose-built for the exact use case

The only tradeoff is no terminal, which is acceptable for a visual editor — users don't need `npm install` or `expo start` because Snack handles all of that internally.
