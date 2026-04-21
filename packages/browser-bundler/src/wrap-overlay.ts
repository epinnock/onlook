/**
 * Backwards-compat alias. The pre-2026-04-20 design used a separate
 * `globalThis.__onlookMountOverlay` JS-side shim; the current path mounts
 * directly through the existing `OnlookRuntime.reloadBundle` native JSI
 * method (source plan Phase 2 / MC2.8). Keeping this constant exported
 * only so older test fixtures that reference it don't need a parallel
 * rename.
 */
export const DEFAULT_OVERLAY_MOUNT_GLOBAL = '__onlookMountOverlay';

export interface WrapOverlayOptions {
    readonly sourceMap?: string;
    /**
     * When `true` (default), emit a bundle compatible with
     * `OnlookRuntime.reloadBundle` — installs `globalThis.onlookMount`
     * which, when invoked, evaluates the CJS + mounts the default export.
     * When `false`, falls back to the legacy IIFE-around-a-shim shape.
     * The legacy path only exists for migration tooling that can't yet
     * issue an `OnlookRuntime.reloadBundle` call; production consumers
     * should never set this.
     */
    readonly emitSelfMounting?: boolean;
}

export interface WrappedOverlay {
    readonly code: string;
    readonly sourceMap?: string;
}

/**
 * Wraps the editor-produced CJS overlay in a self-mounting shell that
 * `OnlookRuntime.reloadBundle(bundleSource)` can evaluate directly. The
 * emitted bundle:
 *
 *   1. Installs a `globalThis.onlookMount(props)` function that evaluates
 *      the CJS in a sandboxed module/exports scope, extracts the default
 *      export, and hands it to the runtime shell's `renderApp` primitive.
 *   2. Leaves `globalThis.onlookUnmount` alone — `reloadBundle` always
 *      calls `onlookUnmount()` before eval'ing the new bundle, so the
 *      fresh mount replaces whatever the previous bundle registered.
 *
 * This mirrors how first-mount `runApplication` bundles work (source plan
 * Phase 2): the bundle owns registering `onlookMount`; the native runtime
 * owns calling it. No JS-side shim in `shell.js` is required.
 */
export function wrapOverlayCode(
    cjsCode: string,
    options: WrapOverlayOptions = {},
): WrappedOverlay {
    if (cjsCode.trim().length === 0) {
        throw new Error('Overlay code must be a non-empty string');
    }

    if (options.emitSelfMounting === false) {
        return wrapLegacyIife(cjsCode, options);
    }

    const cjsLiteral = JSON.stringify(cjsCode);
    // The code emitted here is evaluated inside Hermes by
    // OnlookRuntime.reloadBundle. `var` keeps compatibility with the
    // source plan's "no top-level ES import/export" constraint from
    // Spike B. globalThis.__require is provided by the base runtime; if
    // it's absent we fall back to a best-effort lookup so overlay
    // authors get a clear error instead of a silent hang.
    const code = [
        '(function(globalThis){',
        '  var cjsCode = ' + cjsLiteral + ';',
        '  var previousMount = globalThis.onlookMount;',
        '  globalThis.onlookMount = function onlookMount(props) {',
        '    var module = { exports: {} };',
        '    var exportsRef = module.exports;',
        '    var requireFn = typeof globalThis.__require === "function"',
        '      ? globalThis.__require',
        '      : function(specifier){',
        '          var hit = globalThis[specifier];',
        '          if (hit) return hit;',
        '          throw new Error("overlay require: missing \\"" + specifier + "\\"");',
        '        };',
        '    var factory = new Function("module", "exports", "require", cjsCode);',
        '    factory(module, exportsRef, requireFn);',
        '    var exported = module.exports && module.exports.default',
        '      ? module.exports.default',
        '      : module.exports;',
        '    var React = globalThis.React;',
        '    if (!React) { throw new Error("overlay: globalThis.React missing"); }',
        '    if (typeof globalThis.renderApp !== "function") {',
        '      throw new Error("overlay: globalThis.renderApp missing (base runtime not booted)");',
        '    }',
        '    var element = typeof exported === "function"',
        '      ? React.createElement(exported, props || {})',
        '      : (React.isValidElement && React.isValidElement(exported) ? exported : null);',
        '    if (!element) { throw new Error("overlay: default export is not a component or element"); }',
        '    globalThis.renderApp(element);',
        '  };',
        '  globalThis.onlookMount.__isOverlayMount = true;',
        '  globalThis.onlookMount.__previousMount = previousMount;',
        '})(typeof globalThis !== "undefined" ? globalThis : this);',
        '',
    ].join('\n');

    return {
        code,
        sourceMap: options.sourceMap,
    };
}

/** Legacy IIFE-around-a-shim output. Kept for migration-tooling callers only. */
function wrapLegacyIife(cjsCode: string, options: WrapOverlayOptions): WrappedOverlay {
    return {
        code: [
            '(function(){',
            `  const mount = globalThis[${JSON.stringify(DEFAULT_OVERLAY_MOUNT_GLOBAL)}];`,
            "  if (typeof mount !== 'function') {",
            `    throw new Error(${JSON.stringify(`Missing globalThis.${DEFAULT_OVERLAY_MOUNT_GLOBAL}`)});`,
            '  }',
            `  mount(${JSON.stringify(cjsCode)});`,
            '})();',
            '',
        ].join('\n'),
        sourceMap: options.sourceMap,
    };
}
