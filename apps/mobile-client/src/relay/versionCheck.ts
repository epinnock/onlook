/**
 * Version compatibility check utility for the Onlook mobile client.
 *
 * Compares the client's compiled runtime version (`ONLOOK_RUNTIME_VERSION`)
 * against the version reported in the relay manifest. Uses the protocol
 * package's `isCompatible` function which requires MAJOR and MINOR to match
 * exactly (PATCH may differ).
 *
 * Task: MC3.16
 * Deps: MCF7
 */

import { useMemo } from 'react';
import {
    ONLOOK_RUNTIME_VERSION,
    isCompatible,
} from '@onlook/mobile-client-protocol';

/** Result of a version compatibility check. */
export type VersionCheckResult =
    | { compatible: true }
    | {
          compatible: false;
          clientVersion: string;
          serverVersion: string;
          message: string;
      };

/**
 * Check whether the client's runtime version is compatible with the version
 * reported in the relay manifest.
 *
 * @param manifestVersion - The `onlookRuntimeVersion` string from the relay
 *   manifest's `extra.expoClient` block.
 * @returns A `VersionCheckResult` indicating compatibility or mismatch details.
 */
export function checkVersionCompatibility(
    manifestVersion: string,
): VersionCheckResult {
    if (isCompatible(ONLOOK_RUNTIME_VERSION, manifestVersion)) {
        return { compatible: true };
    }
    return {
        compatible: false,
        clientVersion: ONLOOK_RUNTIME_VERSION,
        serverVersion: manifestVersion,
        message:
            `Client version ${ONLOOK_RUNTIME_VERSION} is incompatible with ` +
            `server version ${manifestVersion}. Please update to a matching version.`,
    };
}

/**
 * React hook that returns the version compatibility result.
 *
 * Returns `null` while `manifestVersion` is `undefined` (i.e. the manifest is
 * still loading), then the check result once a version string is available.
 *
 * @param manifestVersion - The manifest's `onlookRuntimeVersion`, or
 *   `undefined` if not yet loaded.
 */
export function useVersionCheck(
    manifestVersion: string | undefined,
): VersionCheckResult | null {
    return useMemo(() => {
        if (manifestVersion === undefined) {
            return null;
        }
        return checkVersionCompatibility(manifestVersion);
    }, [manifestVersion]);
}
