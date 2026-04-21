/**
 * Pure-JS artifact fixtures — task #52.
 *
 * Minimal artifact shapes for lodash + zod that exercise the
 * PureJsPackageArtifact / PureJsArtifactCache / mergePureJsArtifactIntoOverlay
 * surfaces. Kept in __tests__/fixtures so they compile with test-time tsconfig
 * and don't leak into the package's production build.
 */
import type { PureJsPackageArtifact } from '../../src/pure-js-package';

export function lodashFixtureArtifact(): PureJsPackageArtifact {
    return {
        packageName: 'lodash',
        version: '4.17.21',
        artifactHash: 'lodash-test-hash',
        entry: 'index.js',
        modules: {
            'index.js':
                'module.exports = require("./_base");',
            '_base.js':
                'module.exports = {' +
                '  pick: function(o, keys) { var r={}; for (var i=0;i<keys.length;i++){ if(keys[i] in o) r[keys[i]] = o[keys[i]]; } return r; },' +
                '  omit: function(o, keys) { var r={}; var s=new Set(keys); for (var k in o){ if(!s.has(k)) r[k]=o[k]; } return r; },' +
                '  debounce: function(fn, ms) { var t; return function(){ var a=arguments; clearTimeout(t); t=setTimeout(function(){ fn.apply(null,a); }, ms); }; }' +
                '};',
            'fp.js':
                'var base = require("./_base"); module.exports = { pick: base.pick, omit: base.omit };',
        },
        subpaths: {
            fp: 'fp.js',
        },
    };
}

export function zodFixtureArtifact(): PureJsPackageArtifact {
    return {
        packageName: 'zod',
        version: '3.23.0',
        artifactHash: 'zod-test-hash',
        entry: 'index.js',
        modules: {
            'index.js':
                'module.exports = {' +
                '  z: {' +
                '    object: function(shape) { return { parse: function(v){ return v; }, __isObject: true, shape: shape }; },' +
                '    string: function() { return { parse: function(v){ if (typeof v !== "string") throw new Error("expected string"); return v; } }; }' +
                '  }' +
                '};',
        },
    };
}
