/**
 * Single source of truth for the mobile-client binary version.
 *
 * Task: MC6.1
 * Deps: MCF7
 *
 * The binary version reported by the mobile client — on iOS via
 * `CFBundleShortVersionString` in `Info.plist`, on Android via
 * `versionName` in `build.gradle`, and in JS via the Settings screen
 * and debug info collector — must stay in lockstep with the runtime
 * wire-protocol version. A single constant avoids silent drift between
 * the App Store / Play Store user-facing version label and the runtime
 * compatibility handshake that fails closed on mismatch (see
 * `src/relay/versionCheck.ts`, `isCompatible()`).
 *
 * This module re-exports `ONLOOK_RUNTIME_VERSION` from
 * `@onlook/mobile-client-protocol` as the canonical value, plus an
 * `APP_VERSION` alias for contexts (Settings UI, about dialogs, debug
 * reports) where "app version" reads more naturally than
 * "runtime version".
 *
 * Consumers:
 *   - `app.config.ts` — Expo's `version` field (ExpoConfig). Regenerates
 *     `ios/.../Info.plist` + `android/.../build.gradle` on prebuild.
 *   - `apps/mobile-client/cpp/OnlookRuntime_version.generated.h` (MC2.12)
 *     — generated from the same TS constant by
 *     `scripts/generate-version-header.ts`, so the C++ side shares the
 *     SSOT without needing its own import path.
 *   - `src/screens/SettingsScreen.tsx` — read-only version display.
 *   - `src/debug/debugInfo.ts` — populates `clientVersion` /
 *     `runtimeVersion` on crash / bug reports.
 *
 * Bump protocol: update `ONLOOK_RUNTIME_VERSION` in
 * `packages/mobile-client-protocol/src/runtime-version.ts`. Every
 * downstream (this file, the generated C++ header, Expo prebuild
 * artefacts) picks up the change on the next typecheck / rebuild.
 */

import { ONLOOK_RUNTIME_VERSION } from '@onlook/mobile-client-protocol';

/**
 * Binary version string shown to users (Settings → Version, crash
 * overlay, debug reports). Identical to the runtime protocol version
 * by design — a drift here would mean the app label lies about which
 * runtime the binary actually embeds.
 */
export const APP_VERSION: string = ONLOOK_RUNTIME_VERSION;

// Re-export the canonical name so consumers that prefer the protocol
// vocabulary (version-check, manifest builder) can keep using it via
// this SSOT module instead of reaching across package boundaries.
export { ONLOOK_RUNTIME_VERSION } from '@onlook/mobile-client-protocol';
