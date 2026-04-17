/**
 * Metro config for @onlook/mobile-client.
 *
 * Primary responsibility: force `react` + `react-native` to resolve to
 * this app's own node_modules, not the monorepo root. The root hoist
 * selects React 19.2.0 (pulled in by web-client / docs / email workspaces),
 * while this app pins React 19.1.0 to match react-native 0.81.6's peer.
 * Without this override Metro walked up to root when resolving React
 * transitively from react-native + expo internals, producing a bundle
 * with TWO React copies — module 115 (19.2.0) + module 575 (19.1.0) —
 * causing "Cannot read property 'useState' of null" because the renderer
 * set its dispatcher on one React's internals and user components
 * imported the other.
 *
 * This package.json has "type": "module" so we use ESM syntax; Expo's
 * metro-config supports both CJS and ESM configs but we need ESM here
 * for the parent package type.
 */
import { getDefaultConfig } from 'expo/metro-config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const config = getDefaultConfig(projectRoot);

const LOCAL_REACT = path.resolve(projectRoot, 'node_modules/react');
const LOCAL_REACT_NATIVE = path.resolve(projectRoot, 'node_modules/react-native');

config.resolver = config.resolver || {};
config.resolver.extraNodeModules = {
    ...(config.resolver.extraNodeModules || {}),
    react: LOCAL_REACT,
    'react-native': LOCAL_REACT_NATIVE,
};

// Intercept every `require('react')` / `import 'react'` and redirect to the
// local copy. `extraNodeModules` alone only helps when Metro falls all the
// way through its normal walk; `resolveRequest` is authoritative.
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === 'react') {
        return { type: 'sourceFile', filePath: path.join(LOCAL_REACT, 'index.js') };
    }
    if (moduleName === 'react/jsx-runtime' || moduleName === 'react/jsx-dev-runtime') {
        const sub = moduleName.slice('react/'.length);
        return {
            type: 'sourceFile',
            filePath: path.join(LOCAL_REACT, `${sub}.js`),
        };
    }
    if (originalResolveRequest) {
        return originalResolveRequest(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
};

export default config;
