/**
 * assets-svg-component plugin — task #55 of two-tier-overlay-v2 (Phase 7).
 *
 * Emits a React component module for `import Logo from './logo.svg'` so user
 * code can render the SVG as JSX:
 *
 *   import Logo from './logo.svg';
 *   <Logo width={24} height={24} fill="currentColor" />
 *
 * The emitted module imports `SvgXml` from `react-native-svg` and forwards
 * caller props onto it. Because `react-native-svg` is a native dep, this
 * plugin only succeeds when the project has the `svg` capability — see
 * `OPTIONAL_CAPABILITY_GROUPS['svg']` in `@onlook/base-bundle-builder`.
 * If the base bundle does not include `react-native-svg`, the overlay's
 * preflight pass (`preflightAbiV1Imports`) will surface an
 * `unknown-specifier` error before push.
 *
 * Activation:
 *   - Default: SVG imports go through this plugin and emit a component.
 *   - Opt out per-import via `?url` (R2 URL) or `?raw` (string) — handled by
 *     the sibling `assets-r2` / `assets-raw-text` plugins.
 *
 * This plugin is intentionally separate from `assets-inline` / `assets-r2`
 * so callers can choose the SVG strategy at composition time.
 */

export type SvgAssetContents = string | Uint8Array | ArrayBufferView;

export type SvgAssetFileMap = Readonly<Record<string, SvgAssetContents>>;

export interface EsbuildLoadArgs {
    readonly path: string;
    readonly namespace?: string;
    readonly suffix?: string;
}

export interface EsbuildLoadResult {
    readonly contents?: string;
    readonly loader?: 'js';
    readonly resolveDir?: string;
    readonly errors?: readonly { text: string }[];
}

export interface EsbuildLoadBuild {
    onLoad(
        options: { filter: RegExp; namespace?: string },
        callback: (args: EsbuildLoadArgs) => EsbuildLoadResult | undefined | void,
    ): void;
}

export interface EsbuildLoadPlugin {
    readonly name: string;
    setup(build: EsbuildLoadBuild): void;
}

export interface CreateAssetsSvgComponentPluginOptions {
    readonly files: SvgAssetFileMap;
    readonly namespace?: string;
    /**
     * Override the import specifier resolved for the SVG renderer. Defaults
     * to `react-native-svg`. Tests can pass a stub module path.
     */
    readonly svgRendererSpecifier?: string;
    /**
     * Override the named export used from the renderer. Defaults to `SvgXml`.
     */
    readonly svgRendererExport?: string;
}

const SVG_FILTER = /\.svg(?:\?(?:url|raw))?$/i;
const textDecoder = new TextDecoder('utf-8');

export function createAssetsSvgComponentPlugin(
    options: CreateAssetsSvgComponentPluginOptions,
): EsbuildLoadPlugin {
    const renderer = options.svgRendererSpecifier ?? 'react-native-svg';
    const named = options.svgRendererExport ?? 'SvgXml';

    return {
        name: 'assets-svg-component',
        setup(build) {
            build.onLoad({ filter: SVG_FILTER, namespace: options.namespace }, (args) => {
                // ?url / ?raw is owned by sibling plugins; we don't claim it.
                if (hasBypassQuery(args.path, args.suffix)) {
                    return undefined;
                }

                const pathWithoutQuery = stripQuery(args.path);
                const contents =
                    options.files[normalizeAssetPath(pathWithoutQuery)] ??
                    options.files[pathWithoutQuery];
                if (contents === undefined) {
                    return undefined;
                }

                const xml = toText(contents);
                return {
                    contents: buildSvgComponentModule({
                        xml,
                        rendererSpecifier: renderer,
                        rendererExport: named,
                    }),
                    loader: 'js',
                };
            });
        },
    };
}

export function buildSvgComponentModule(input: {
    readonly xml: string;
    readonly rendererSpecifier: string;
    readonly rendererExport: string;
}): string {
    // Use React.createElement (not JSX) so the emitted module compiles in
    // every overlay's CJS pipeline without requiring a JSX transform pass.
    return [
        `import React from "react";`,
        `import { ${input.rendererExport} } from ${JSON.stringify(input.rendererSpecifier)};`,
        `var __ONLOOK_SVG_XML__ = ${JSON.stringify(input.xml)};`,
        `function OnlookSvg(props) {`,
        `  return React.createElement(${input.rendererExport}, Object.assign({}, props, { xml: __ONLOOK_SVG_XML__ }));`,
        `}`,
        `export default OnlookSvg;`,
    ].join('\n');
}

export function hasBypassQuery(path: string, suffix?: string): boolean {
    if (suffix === '?url' || suffix === '?raw') return true;
    const qIndex = path.indexOf('?');
    if (qIndex === -1) return false;
    return /(?:^|[?&])(?:url|raw)(?:$|&|=)/.test(path.slice(qIndex));
}

export function stripQuery(path: string): string {
    const qIndex = path.indexOf('?');
    return qIndex === -1 ? path : path.slice(0, qIndex);
}

function normalizeAssetPath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function toText(contents: SvgAssetContents): string {
    if (typeof contents === 'string') return contents;
    if (contents instanceof Uint8Array) return textDecoder.decode(contents);
    return textDecoder.decode(
        new Uint8Array(contents.buffer, contents.byteOffset, contents.byteLength),
    );
}
