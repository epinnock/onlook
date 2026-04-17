/**
 * Metro config for @onlook/mobile-client.
 *
 * Forces every `react` import to resolve to this app's own
 * node_modules/react (19.1.0), preventing dual-React from hoisted
 * root react (19.2.0, pulled in by web-client / docs / email).
 * Without this override Metro walked up to root when resolving React
 * transitively from react-native, producing a bundle with TWO React
 * copies — module 115 (19.2.0) + module 575 (19.1.0) — causing
 * "Cannot read property 'useState' of null".
 */
import { getDefaultConfig } from 'expo/metro-config.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const config = getDefaultConfig(projectRoot);

const LOCAL_REACT = path.resolve(projectRoot, 'node_modules/react');

// Intercept every `require('react')` / `import 'react'` and redirect to
// the local copy. Leave other resolutions to Metro's default.
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === 'react') {
        return {
            type: 'sourceFile',
            filePath: path.join(LOCAL_REACT, 'index.js'),
        };
    }
    if (moduleName === 'react/jsx-runtime') {
        return {
            type: 'sourceFile',
            filePath: path.join(LOCAL_REACT, 'jsx-runtime.js'),
        };
    }
    if (moduleName === 'react/jsx-dev-runtime') {
        return {
            type: 'sourceFile',
            filePath: path.join(LOCAL_REACT, 'jsx-dev-runtime.js'),
        };
    }
    if (originalResolveRequest) {
        return originalResolveRequest(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
};

export default config;
