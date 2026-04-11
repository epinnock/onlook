/**
 * Runtime version constant + compatibility matrix.
 *
 * The mobile client binary reports `ONLOOK_RUNTIME_VERSION` at launch. The relay
 * embeds the matching version in the manifest's `extra.expoClient.onlookRuntimeVersion`
 * field. A bundle built against runtime version X mounts on a client running
 * runtime version Y only if `isCompatible(Y, X)` returns true.
 *
 * Current rule: client and bundle must agree on MAJOR and MINOR. PATCH may
 * differ (patch releases are wire-compatible by contract). This is stricter than
 * semver's default so we fail fast on silent drift during v1.
 *
 * Built by MCF7 of plans/onlook-mobile-client-task-queue.md.
 */

/** Bumped by MCF8/MC6.1 when the binary ships a new runtime. */
export const ONLOOK_RUNTIME_VERSION = '0.1.0' as const;

export interface SemVer {
    major: number;
    minor: number;
    patch: number;
}

export function parseVersion(version: string): SemVer {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (!match) {
        throw new Error(`Invalid semver: ${version}`);
    }
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = Number(match[3]);
    if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) {
        throw new Error(`Invalid semver components: ${version}`);
    }
    return { major, minor, patch };
}

/**
 * Returns true iff a client running `clientVersion` should accept a bundle built
 * against `bundleVersion`. MAJOR and MINOR must match exactly; PATCH is ignored.
 */
export function isCompatible(clientVersion: string, bundleVersion: string): boolean {
    const client = parseVersion(clientVersion);
    const bundle = parseVersion(bundleVersion);
    return client.major === bundle.major && client.minor === bundle.minor;
}
