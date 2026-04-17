/**
 * Metro config for @onlook/mobile-client.
 *
 * Primary responsibility: force `react` and related packages to resolve to
 * this app's own node_modules, not the monorepo root. The root hoist
 * selects React 19.2.0 (pulled in by web-client / docs / email workspaces),
 * while this app pins React 19.1.0 to match react-native 0.81.6's peer.
 * Without this override Metro walked up to root when resolving React
 * transitively from react-native + expo internals, producing a bundle
 * with TWO React copies — module 115 (19.2.0) + module 575 (19.1.0) —
 * causing "Cannot read property 'useState' of null" because the renderer
 * set its dispatcher on one React's internals and user components
 * imported the other.
 */
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

const LOCAL_REACT = path.resolve(projectRoot, 'node_modules/react');
const LOCAL_REACT_NATIVE = path.resolve(projectRoot, 'node_modules/react-native');

config.resolver = config.resolver || {};
config.resolver.extraNodeModules = {
    ...(config.resolver.extraNodeModules || {}),
    react: LOCAL_REACT,
    'react-native': LOCAL_REACT_NATIVE,
};

// Only resolve react/react-native from this app's node_modules, not the
// root hoist. Metro walks upward by default — nodeModulesPaths restricts it.
config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(projectRoot, '../../node_modules'),
];

module.exports = config;
