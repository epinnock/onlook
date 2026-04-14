import { transform } from 'sucrase';

export interface MobilePreviewVfs {
    listAll(): Promise<Array<{ path: string; type: 'file' | 'directory' }>>;
    readFile(path: string): Promise<string | Uint8Array>;
    watchDirectory(
        path: string,
        callback: (event: { type: 'create' | 'update' | 'delete' | 'rename'; path: string }) => void,
    ): () => void;
}

export interface MobilePreviewBundleResult {
    code: string;
    entryPath: string;
    moduleCount: number;
}

const ENTRY_CANDIDATES = [
    'index.tsx',
    'index.ts',
    'index.jsx',
    'index.js',
    'App.tsx',
    'App.jsx',
    'App.js',
    'src/App.tsx',
    'src/App.jsx',
    'src/index.tsx',
    'src/index.ts',
    'app/index.tsx',
    'app/index.ts',
    'app/index.jsx',
    'app/index.js',
] as const;

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'] as const;
const SUPPORTED_BARE_IMPORTS = new Set([
    'expo-router',
    'expo-status-bar',
    'react',
    'react-native',
    'react-native-safe-area-context',
    // Editor-injected preload script used by the web canvas iframe. On the
    // native mobile-preview path it's a no-op — the __require runtime shim
    // returns an empty module for it so App.tsx's top-level import doesn't
    // throw "Module not found".
    'onlook-preload-script.js',
]);

const LOCAL_IMPORT_RE =
    /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\sfrom\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\brequire\(\s*["']([^"']+)["']\s*\)/g;
const REQUIRE_RE = /\brequire\(\s*(['"])([^'"]+)\1\s*\)/g;

export class MobilePreviewBundleError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'MobilePreviewBundleError';
    }
}

export async function buildMobilePreviewBundle(
    vfs: MobilePreviewVfs,
): Promise<MobilePreviewBundleResult> {
    const files = await readProjectFiles(vfs);
    const entryPath = resolveEntryPath(files);
    const orderedModules = collectDependencyGraph(files, entryPath);
    const moduleMap: Record<string, string> = {};

    for (const filePath of orderedModules) {
        const source = files.get(filePath);
        if (source == null) {
            throw new MobilePreviewBundleError(
                `Missing module "${filePath}" while building the mobile preview bundle.`,
            );
        }
        moduleMap[filePath] = buildModuleCode(filePath, source, files);
    }

    return {
        code: wrapEvalBundle(entryPath, orderedModules, moduleMap),
        entryPath,
        moduleCount: orderedModules.length,
    };
}

export async function pushMobilePreviewUpdate(args: {
    serverBaseUrl: string;
    code: string;
}): Promise<void> {
    const baseUrl = args.serverBaseUrl.trim().replace(/\/$/, '');
    const res = await fetch(`${baseUrl}/push`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            type: 'eval',
            code: args.code,
        }),
    });

    if (!res.ok) {
        throw new Error(`mobile-preview /push returned ${res.status}`);
    }
}

export function shouldSyncMobilePreviewPath(filePath: string): boolean {
    const normalizedPath = normalizePath(filePath);
    if (!normalizedPath) {
        return false;
    }
    if (normalizedPath.includes('node_modules')) {
        return false;
    }
    if (normalizedPath.includes('.onlook/')) {
        return false;
    }
    if (
        normalizedPath === 'package-lock.json' ||
        normalizedPath === 'bun.lock' ||
        normalizedPath === 'bun.lockb'
    ) {
        return false;
    }
    return (
        SOURCE_EXTENSIONS.some((extension) => normalizedPath.endsWith(extension)) ||
        normalizedPath === 'package.json'
    );
}

async function readProjectFiles(vfs: MobilePreviewVfs): Promise<Map<string, string>> {
    const entries = await vfs.listAll();
    const files = new Map<string, string>();

    for (const entry of entries) {
        if (entry.type !== 'file') {
            continue;
        }

        const normalizedPath = normalizePath(entry.path);
        if (!shouldSyncMobilePreviewPath(normalizedPath)) {
            continue;
        }

        const raw = await vfs.readFile(normalizedPath);
        files.set(
            normalizedPath,
            typeof raw === 'string' ? raw : new TextDecoder().decode(raw),
        );
    }

    return files;
}

function resolveEntryPath(files: Map<string, string>): string {
    const packageJson = files.get('package.json');
    if (packageJson) {
        try {
            const parsed = JSON.parse(packageJson) as { main?: string };
            const packageMain = parsed.main?.trim();
            if (packageMain) {
                const resolvedFromMain = resolveProjectSpecifier(packageMain, '', files);
                if (resolvedFromMain != null) {
                    return resolvedFromMain;
                }
            }
        } catch {
            // Ignore malformed package.json here and fall back to conventions.
        }
    }

    for (const candidate of ENTRY_CANDIDATES) {
        if (files.has(candidate)) {
            return candidate;
        }
    }

    throw new MobilePreviewBundleError(
        `No entry file found. Tried ${ENTRY_CANDIDATES.join(', ')}.`,
    );
}

function collectDependencyGraph(
    files: Map<string, string>,
    entryPath: string,
): string[] {
    const ordered = new Set<string>();
    const visiting = new Set<string>();

    const visit = (filePath: string) => {
        if (ordered.has(filePath)) {
            return;
        }
        if (visiting.has(filePath)) {
            return;
        }

        visiting.add(filePath);
        const source = files.get(filePath);
        if (source == null) {
            throw new MobilePreviewBundleError(
                `Module "${filePath}" was referenced but is missing from the project.`,
            );
        }

        for (const specifier of findImportSpecifiers(source)) {
            const resolved = resolveProjectSpecifier(specifier, filePath, files);
            if (resolved == null) {
                if (isBareSpecifier(specifier) && !SUPPORTED_BARE_IMPORTS.has(specifier)) {
                    throw new MobilePreviewBundleError(
                        `Unsupported package import "${specifier}" in ${filePath}. Mobile preview currently supports only ${Array.from(
                            SUPPORTED_BARE_IMPORTS,
                        ).join(', ')}.`,
                    );
                }
                continue;
            }
            visit(resolved);
        }

        visiting.delete(filePath);
        ordered.add(filePath);
    };

    visit(entryPath);
    return Array.from(ordered);
}

function buildModuleCode(
    filePath: string,
    source: string,
    files: Map<string, string>,
): string {
    if (filePath.endsWith('.json')) {
        return [
            `module.exports = ${source.trim() || 'null'};`,
            'module.exports.default = module.exports;',
            'module.exports.__esModule = true;',
        ].join('\n');
    }

    try {
        const transformed = transform(source, {
            transforms: ['typescript', 'jsx', 'imports'],
            filePath,
            production: true,
            jsxRuntime: 'classic',
        }).code;

        return transformed.replace(REQUIRE_RE, (_match, quote: string, specifier: string) => {
            const resolved = resolveProjectSpecifier(specifier, filePath, files);
            if (resolved != null) {
                return `require(${quote}${resolved}${quote})`;
            }
            if (isBareSpecifier(specifier) && !SUPPORTED_BARE_IMPORTS.has(specifier)) {
                throw new MobilePreviewBundleError(
                    `Unsupported package import "${specifier}" in ${filePath}.`,
                );
            }
            return `require(${quote}${specifier}${quote})`;
        });
    } catch (error) {
        throw new MobilePreviewBundleError(
            `Failed to transpile ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

function wrapEvalBundle(
    entryPath: string,
    orderedModules: string[],
    moduleMap: Record<string, string>,
): string {
    const modules = orderedModules
        .map((filePath) => `${JSON.stringify(filePath)}: function(require, module, exports) {\n${moduleMap[filePath]}\n}`)
        .join(',\n');

    return `(() => {
const React = globalThis.React;
if (!React || typeof globalThis.renderApp !== 'function') {
  throw new Error('Onlook mobile preview runtime is not ready.');
}
let __appRegistered = false;
const __modules = {
${modules}
};
const __cache = {};
// CSS color string → ARGB signed int for raw Fabric. Fabric's C++ layer
// expects numeric colors (e.g. 0xFF0b0b0f); CSS hex strings silently fail
// and render as white/default. Covers #rgb, #rrggbb, #rrggbbaa, rgb(a),
// and 'transparent'. Returns the original value if unparseable.
const __cssColorToArgb = (value) => {
  if (typeof value === 'number') return value | 0;
  if (typeof value !== 'string') return value;
  const s = value.trim().toLowerCase();
  if (s === 'transparent') return 0;
  if (s === 'black') return 0xFF000000 | 0;
  if (s === 'white') return 0xFFFFFFFF | 0;
  if (s[0] === '#') {
    const hex = s.slice(1);
    const parse = (h) => parseInt(h, 16);
    if (hex.length === 3) {
      const r = parse(hex[0] + hex[0]);
      const g = parse(hex[1] + hex[1]);
      const b = parse(hex[2] + hex[2]);
      return ((0xFF << 24) | (r << 16) | (g << 8) | b) | 0;
    }
    if (hex.length === 6) {
      const r = parse(hex.slice(0, 2));
      const g = parse(hex.slice(2, 4));
      const b = parse(hex.slice(4, 6));
      return ((0xFF << 24) | (r << 16) | (g << 8) | b) | 0;
    }
    if (hex.length === 8) {
      const r = parse(hex.slice(0, 2));
      const g = parse(hex.slice(2, 4));
      const b = parse(hex.slice(4, 6));
      const a = parse(hex.slice(6, 8));
      return ((a << 24) | (r << 16) | (g << 8) | b) | 0;
    }
  }
  const rgba = s.match(/^rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*(?:,\\s*(\\d*\\.?\\d+)\\s*)?\\)$/);
  if (rgba) {
    const r = Math.max(0, Math.min(255, parseInt(rgba[1], 10)));
    const g = Math.max(0, Math.min(255, parseInt(rgba[2], 10)));
    const b = Math.max(0, Math.min(255, parseInt(rgba[3], 10)));
    const a = rgba[4] != null ? Math.round(parseFloat(rgba[4]) * 255) : 0xFF;
    return ((a << 24) | (r << 16) | (g << 8) | b) | 0;
  }
  return value;
};
const __COLOR_PROPS = new Set([
  'color', 'backgroundColor', 'borderColor',
  'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor',
  'borderStartColor', 'borderEndColor', 'borderBlockColor', 'borderInlineColor',
  'shadowColor', 'tintColor', 'overlayColor',
  'textDecorationColor', 'textShadowColor',
  'placeholderTextColor', 'underlineColorAndroid',
]);
const __convertStyleColors = (style) => {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return style;
  let changed = false;
  const out = {};
  for (const key in style) {
    const v = style[key];
    if (__COLOR_PROPS.has(key)) {
      const converted = __cssColorToArgb(v);
      if (converted !== v) changed = true;
      out[key] = converted;
    } else {
      out[key] = v;
    }
  }
  return changed ? out : style;
};
const __flattenStyle = (style) => {
  if (Array.isArray(style)) {
    return style.reduce((acc, item) => {
      if (item && typeof item === 'object') {
        Object.assign(acc, __flattenStyle(item));
      }
      return acc;
    }, {});
  }
  return __convertStyleColors(style && typeof style === 'object' ? style : {});
};
// Fabric only natively knows a few element types ('View', 'RCTText',
// 'RCTRawText'). Higher-level RN components like ScrollView / SafeAreaView /
// TouchableOpacity need to be React components that render down to one of
// the known native types — otherwise the reconciler creates a node with
// type 'ScrollView' / 'TouchableOpacity' / etc. and Fabric silently drops
// the entire subtree, leaving a white screen.
const __PASSTHROUGH_VIEW = (props) => {
  const { children, onPress, onPressIn, onPressOut, onLongPress, activeOpacity, underlayColor, ...rest } = props || {};
  return React.createElement(globalThis.View, rest, children);
};
const __reactNative = {
  View: globalThis.View,
  Text: globalThis.TextC,
  TextInput: __PASSTHROUGH_VIEW,
  Image: __PASSTHROUGH_VIEW,
  ScrollView: __PASSTHROUGH_VIEW,
  SafeAreaView: __PASSTHROUGH_VIEW,
  Pressable: __PASSTHROUGH_VIEW,
  TouchableOpacity: __PASSTHROUGH_VIEW,
  TouchableHighlight: __PASSTHROUGH_VIEW,
  TouchableWithoutFeedback: __PASSTHROUGH_VIEW,
  StatusBar: () => null,
  RawText: globalThis.RawText,
  Fragment: React.Fragment,
  StyleSheet: {
    create(styles) {
      if (!styles || typeof styles !== 'object') return {};
      const out = {};
      for (const key in styles) {
        out[key] = __convertStyleColors(styles[key]);
      }
      return out;
    },
    compose(a, b) { return Object.assign({}, __flattenStyle(a), __flattenStyle(b)); },
    flatten(style) { return __flattenStyle(style); },
  },
  Platform: {
    OS: 'ios',
    select(options) {
      return options && (options.ios ?? options.native ?? options.default);
    },
  },
  Dimensions: {
    get() {
      return { width: 390, height: 844, scale: 3, fontScale: 1 };
    },
  },
  Alert: {
    alert() {},
  },
  AppRegistry: {
    registerComponent(appKey, componentProvider) {
      // In a normal Expo project, index.ts calls
      // AppRegistry.registerComponent('main', () => App) and the native
      // runtime dispatches runApplication to mount the component. In the
      // browser-only mobile-preview path we don't get that native dispatch
      // for eval'd code, so we trigger renderApp directly here.
      if (appKey === 'main' && !__appRegistered) {
        __appRegistered = true;
        try {
          const Comp = componentProvider();
          if (Comp) {
            globalThis.renderApp(React.createElement(Comp, null));
          }
        } catch (err) {
          throw err;
        }
      }
    },
    runApplication() {
      // No-op: registerComponent already triggered the mount above.
    },
  },
};
__reactNative.default = __reactNative;
__reactNative.__esModule = true;
const __safeAreaContext = {
  SafeAreaProvider: ({ children }) => React.createElement(React.Fragment, null, children),
  SafeAreaView: __reactNative.SafeAreaView,
  useSafeAreaInsets() {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  },
};
__safeAreaContext.default = __safeAreaContext;
__safeAreaContext.__esModule = true;
const __expoStatusBar = {
  StatusBar() { return null; },
};
__expoStatusBar.default = __expoStatusBar.StatusBar;
__expoStatusBar.__esModule = true;
const __expoRouter = {
  Link: ({ children }) => React.createElement(globalThis.TextC, null, children),
  Redirect: () => null,
  Slot: ({ children }) => React.createElement(React.Fragment, null, children ?? null),
  Stack: ({ children }) => React.createElement(React.Fragment, null, children ?? null),
  Tabs: ({ children }) => React.createElement(React.Fragment, null, children ?? null),
  useRouter() {
    return { push() {}, replace() {}, back() {} };
  },
  useLocalSearchParams() {
    return {};
  },
};
__expoRouter.default = __expoRouter;
__expoRouter.__esModule = true;
function __require(specifier) {
  if (specifier === 'react') {
    return React;
  }
  if (specifier === 'react-native') {
    return __reactNative;
  }
  if (specifier === 'react-native-safe-area-context') {
    return __safeAreaContext;
  }
  if (specifier === 'expo-status-bar') {
    return __expoStatusBar;
  }
  if (specifier === 'expo-router') {
    return __expoRouter;
  }
  // Onlook's editor injects 'onlook-preload-script.js' into App.tsx for the
  // web canvas iframe. On the native mobile-preview path it's a no-op.
  if (specifier === 'onlook-preload-script.js') {
    return {};
  }
  if (__cache[specifier]) {
    return __cache[specifier].exports;
  }
  const factory = __modules[specifier];
  if (!factory) {
    throw new Error('Module not found: ' + specifier);
  }
  const module = { exports: {} };
  __cache[specifier] = module;
  factory(__require, module, module.exports);
  return module.exports;
}
const __entryModule = __require(${JSON.stringify(entryPath)});
if (!__appRegistered) {
  // Entry didn't register via AppRegistry — fall back to the module's
  // default export (covers App.tsx-as-entry Expo projects).
  const __root = __entryModule && __entryModule.__esModule ? __entryModule.default : (__entryModule.default ?? __entryModule);
  if (!__root || typeof __root !== 'function') {
    throw new Error('Entry module "${entryPath}" did not call AppRegistry.registerComponent and did not export a component.');
  }
  globalThis.renderApp(React.createElement(__root, null));
}
})();`;
}

function findImportSpecifiers(source: string): string[] {
    const specifiers = new Set<string>();
    for (const match of source.matchAll(LOCAL_IMPORT_RE)) {
        const specifier = match[1] ?? match[2] ?? match[3];
        if (specifier) {
            specifiers.add(specifier);
        }
    }
    return Array.from(specifiers);
}

function resolveProjectSpecifier(
    specifier: string,
    importerPath: string,
    files: Map<string, string>,
): string | null {
    if (!specifier) {
        return null;
    }

    if (specifier.startsWith('@/') || specifier.startsWith('~/')) {
        return resolveFileCandidate(specifier.slice(2), files);
    }

    if (specifier.startsWith('/')) {
        return resolveFileCandidate(specifier.slice(1), files);
    }

    if (specifier.startsWith('.')) {
        const importerDir = dirname(importerPath);
        return resolveFileCandidate(joinPath(importerDir, specifier), files);
    }

    return null;
}

function resolveFileCandidate(
    rawPath: string,
    files: Map<string, string>,
): string | null {
    const normalizedPath = normalizePath(rawPath);
    if (files.has(normalizedPath)) {
        return normalizedPath;
    }

    for (const extension of SOURCE_EXTENSIONS) {
        const withExtension = `${normalizedPath}${extension}`;
        if (files.has(withExtension)) {
            return withExtension;
        }
    }

    for (const extension of SOURCE_EXTENSIONS) {
        const indexPath = joinPath(normalizedPath, `index${extension}`);
        if (files.has(indexPath)) {
            return indexPath;
        }
    }

    return null;
}

function normalizePath(inputPath: string): string {
    const parts = inputPath.replaceAll('\\', '/').split('/');
    const normalized: string[] = [];

    for (const part of parts) {
        if (!part || part === '.') {
            continue;
        }
        if (part === '..') {
            normalized.pop();
            continue;
        }
        normalized.push(part);
    }

    return normalized.join('/');
}

function dirname(filePath: string): string {
    const normalizedPath = normalizePath(filePath);
    const parts = normalizedPath.split('/');
    parts.pop();
    return parts.join('/');
}

function joinPath(...parts: string[]): string {
    return normalizePath(parts.filter(Boolean).join('/'));
}

function isBareSpecifier(specifier: string): boolean {
    return !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('@/') && !specifier.startsWith('~/');
}
