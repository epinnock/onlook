export const DEFAULT_OVERLAY_MOUNT_GLOBAL = '__onlookMountOverlay';

export interface WrapOverlayOptions {
    readonly mountGlobal?: string;
    readonly sourceMap?: string;
}

export interface WrappedOverlay {
    readonly code: string;
    readonly sourceMap?: string;
}

export function wrapOverlayCode(
    cjsCode: string,
    options: WrapOverlayOptions = {},
): WrappedOverlay {
    if (cjsCode.trim().length === 0) {
        throw new Error('Overlay code must be a non-empty string');
    }

    const mountGlobal = options.mountGlobal ?? DEFAULT_OVERLAY_MOUNT_GLOBAL;
    assertSafeGlobalName(mountGlobal);

    return {
        code: [
            '(function(){',
            `  const mount = globalThis[${JSON.stringify(mountGlobal)}];`,
            "  if (typeof mount !== 'function') {",
            `    throw new Error(${JSON.stringify(`Missing globalThis.${mountGlobal}`)});`,
            '  }',
            `  mount(${JSON.stringify(cjsCode)});`,
            '})();',
            '',
        ].join('\n'),
        sourceMap: options.sourceMap,
    };
}

function assertSafeGlobalName(name: string): void {
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
        throw new Error(`Invalid overlay mount global "${name}"`);
    }
}
