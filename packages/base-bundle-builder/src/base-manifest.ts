/**
 * Base manifest emitter — Overlay ABI v1 (ADR-0001) Phase 1 task #10.
 *
 * Produces a `BaseManifest` describing the currently-deployed base bundle. The editor
 * consumes this document to:
 *
 *   - know which bare specifiers the base bundle serves via `OnlookRuntime.require`
 *     (everything else is resolved/externalized by the overlay bundler);
 *   - negotiate ABI compatibility with the connected phone before shipping overlays
 *     (see `checkAbiCompatibility` + `assertOverlayAbiCompatible` in abi-v1.ts);
 *   - invalidate alias/overlay caches when either `bundleHash` or `aliasHash` flips.
 *
 * The emitter is pure — all version strings and URLs are passed in. Callers (CI, the
 * `base-bundle:build` CLI, tests) read `react-native/package.json`, `expo/package.json`,
 * and `react/package.json` at their own layer.
 */
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import {
    ABI_VERSION,
    type BaseManifest,
} from '@onlook/mobile-client-protocol';

import { listConcreteCapabilitySpecifiers } from './runtime-capabilities';

export interface EmitBaseManifestInput {
    /** Bytes of the Metro-built base bundle. Hashed as-is with sha256. */
    readonly bundleBytes: Uint8Array;
    /** The alias-emitter sidecar JSON produced by `createAliasEmitterOutput(...).sidecarJson`. */
    readonly aliasSidecarJson: string;
    /** Value of `react-native/package.json#version` at build time. */
    readonly rnVersion: string;
    /** Value of `expo/package.json#version` at build time. */
    readonly expoSdk: string;
    /** Value of `react/package.json#version` at build time. */
    readonly reactVersion: string;
    /** Target platform of the base bundle. */
    readonly platform: 'ios' | 'android';
    /** R2 (or equivalent) URL where the base bundle bytes were uploaded. Must be a valid URL. */
    readonly bundleUrl: string;
    /** R2 URL for the alias-map sidecar, if uploaded. Must be a valid URL when provided. */
    readonly aliasMapUrl?: string;
    /** R2 URL for the base bundle's source map, if uploaded. Must be a valid URL when provided. */
    readonly sourceMapUrl?: string;
    /**
     * Exhaustive list of bare specifiers served by the base bundle. Defaults to
     * {@link listConcreteCapabilitySpecifiers} — the current curated deps + expo-deps merge.
     */
    readonly concreteAliases?: readonly string[];
}

export function emitBaseManifest(input: EmitBaseManifestInput): BaseManifest {
    const aliases = input.concreteAliases ?? listConcreteCapabilitySpecifiers();

    const manifest: BaseManifest = {
        abi: ABI_VERSION,
        bundleHash: sha256HexOfBytes(input.bundleBytes),
        aliasHash: sha256HexOfUtf8(input.aliasSidecarJson),
        rnVersion: input.rnVersion,
        expoSdk: input.expoSdk,
        reactVersion: input.reactVersion,
        platform: input.platform,
        bundleUrl: input.bundleUrl,
        aliases,
        ...(input.aliasMapUrl !== undefined ? { aliasMapUrl: input.aliasMapUrl } : {}),
        ...(input.sourceMapUrl !== undefined ? { sourceMapUrl: input.sourceMapUrl } : {}),
    };

    return manifest;
}

/**
 * Serialize a {@link BaseManifest} to disk next to the base bundle.
 * Pretty-printed JSON with a trailing newline — stable across OSes and diffable.
 */
export async function writeBaseManifest(
    manifest: BaseManifest,
    outPath: string,
): Promise<void> {
    const json = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(outPath, json, 'utf8');
}

// ─── Hashing ─────────────────────────────────────────────────────────────────

function sha256HexOfBytes(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

function sha256HexOfUtf8(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}
