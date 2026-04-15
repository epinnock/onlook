export const ENTRY_CANDIDATES = [
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

export const SOURCE_EXTENSIONS = [
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.json',
] as const;

export const IMAGE_ASSET_EXTENSIONS = [
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.bmp',
    '.svg',
    '.avif',
] as const;

export const RESOLVABLE_EXTENSIONS = [
    ...SOURCE_EXTENSIONS,
    ...IMAGE_ASSET_EXTENSIONS,
] as const;

export const SUPPORTED_BARE_IMPORTS = new Set([
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

export const LOCAL_IMPORT_RE =
    /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\sfrom\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\brequire\(\s*["']([^"']+)["']\s*\)/g;

export const REQUIRE_RE = /\brequire\(\s*(['"])([^'"]+)\1\s*\)/g;
