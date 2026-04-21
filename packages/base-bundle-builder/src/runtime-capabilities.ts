/**
 * Runtime capability classification — Overlay ABI v1 (ADR-0001) task #3.
 *
 * Classifies every bare specifier an overlay might import into one of three tiers that the
 * base-bundle builder and editor preflight both consult:
 *
 *   - `required`   — must be present in every base bundle; absence is a build failure.
 *   - `optional`   — present when the curated dep list includes the package; absence is a
 *                    soft fail (editor preflight rejects overlays that import it).
 *   - `disallowed` — known to require a native binary that we have no plan to ship in the
 *                    base bundle; editor preflight rejects on sight.
 *
 * This module is purely the classification. Which `optional` packages are actually included in
 * a specific base bundle is a function of the curated deps in `deps.ts` + `expo-deps.ts`. The
 * resulting concrete capabilities are surfaced as the `RuntimeCapabilities` wire type from
 * `@onlook/mobile-client-protocol`, produced by {@link buildRuntimeCapabilities}.
 *
 * Adding to `required` or `optional` usually implies adding to `deps.ts`/`expo-deps.ts` and
 * re-building the base bundle; adding to `disallowed` is a policy change only.
 */
import type { RuntimeCapabilities } from '@onlook/mobile-client-protocol';
import {
    listCuratedBaseBundleDependencySpecifiers,
    type CuratedBaseBundleDependencySpecifier,
} from './deps';
import {
    listCuratedExpoBundleDependencySpecifiers,
    mergeCuratedDependencySpecifiers,
    type CuratedExpoBundleDependencySpecifier,
} from './expo-deps';

// ─── Tier: required ──────────────────────────────────────────────────────────

/**
 * The minimum alias set every base bundle must provide. Editor preflight assumes these are
 * always resolvable via `OnlookRuntime.require` and does not check `runtime.aliases` for them.
 */
export const REQUIRED_ALIASES = [
    'react',
    'react/jsx-runtime',
    'react-native',
    'react-native-safe-area-context',
] as const;
export type RequiredAlias = (typeof REQUIRED_ALIASES)[number];

// ─── Tier: optional ──────────────────────────────────────────────────────────

/**
 * The specifier → capability-group index. A base bundle claims capability `X` iff every
 * member of `OPTIONAL_CAPABILITY_GROUPS[X]` is present in its curated alias list. The editor
 * surfaces capabilities by group so contributors can reason about "does this project need
 * image loading / font loading / media playback" at a level higher than package names.
 */
export const OPTIONAL_CAPABILITY_GROUPS = {
    'expo-core': ['expo', 'expo-constants', 'expo-modules-core', 'expo-status-bar'],
    'expo-router': ['expo-router'],
    'svg': ['react-native-svg'],
    'fonts': ['expo-font'],
    'assets': ['expo-asset'],
    'media': ['expo-av', 'expo-video'],
    'files': ['expo-file-system', 'expo-asset'],
    'blur-gesture-anim': ['expo-blur', 'react-native-gesture-handler'],
} as const;
export type OptionalCapabilityGroup = keyof typeof OPTIONAL_CAPABILITY_GROUPS;
export type OptionalCapabilitySpecifier =
    (typeof OPTIONAL_CAPABILITY_GROUPS)[OptionalCapabilityGroup][number];

// ─── Tier: disallowed ────────────────────────────────────────────────────────

/**
 * Packages that ship JSI workers, native view managers, or deep Hermes integration that the
 * base bundle does not plan to include. Editor preflight rejects overlays that import these
 * with `kind: 'unsupported-native'` (see ADR §"Unsupported native modules"). Moving a package
 * out of this set requires a base-bundle rebuild AND an ADR update.
 */
export const DISALLOWED_NATIVE_ALIASES = [
    'react-native-reanimated',
    'react-native-reanimated/plugin',
    '@shopify/flash-list',
    '@shopify/react-native-skia',
    'react-native-skia',
    'react-native-mmkv',
    'react-native-worklets-core',
    'react-native-vision-camera',
] as const;
export type DisallowedNativeAlias = (typeof DISALLOWED_NATIVE_ALIASES)[number];

const DISALLOWED_NATIVE_SET: ReadonlySet<string> = new Set(DISALLOWED_NATIVE_ALIASES);

// ─── Derivation: concrete capabilities of a given curated dep set ────────────

export function listConcreteCapabilitySpecifiers(): readonly (
    | CuratedBaseBundleDependencySpecifier
    | CuratedExpoBundleDependencySpecifier
)[] {
    return mergeCuratedDependencySpecifiers(
        listCuratedBaseBundleDependencySpecifiers(),
        listCuratedExpoBundleDependencySpecifiers(),
    );
}

export function listSatisfiedOptionalCapabilityGroups(
    concreteAliases: readonly string[] = listConcreteCapabilitySpecifiers(),
): readonly OptionalCapabilityGroup[] {
    const present = new Set<string>(concreteAliases);
    const satisfied: OptionalCapabilityGroup[] = [];
    for (const [group, members] of Object.entries(OPTIONAL_CAPABILITY_GROUPS) as ReadonlyArray<
        [OptionalCapabilityGroup, ReadonlyArray<OptionalCapabilitySpecifier>]
    >) {
        if (members.every((m) => present.has(m))) {
            satisfied.push(group);
        }
    }
    return satisfied;
}

// ─── Policy gate: is this bare specifier allowed in an overlay? ──────────────

export type ImportPolicyVerdict =
    | { readonly allowed: true; readonly tier: 'required' | 'optional' }
    | { readonly allowed: false; readonly tier: 'disallowed'; readonly reason: 'native-only' }
    | { readonly allowed: false; readonly tier: 'unknown'; readonly reason: 'not-in-base' };

export function classifyImport(
    specifier: string,
    concreteAliases: readonly string[] = listConcreteCapabilitySpecifiers(),
): ImportPolicyVerdict {
    if (DISALLOWED_NATIVE_SET.has(specifier)) {
        return { allowed: false, tier: 'disallowed', reason: 'native-only' };
    }
    if ((REQUIRED_ALIASES as readonly string[]).includes(specifier)) {
        return { allowed: true, tier: 'required' };
    }
    if (concreteAliases.includes(specifier)) {
        return { allowed: true, tier: 'optional' };
    }
    return { allowed: false, tier: 'unknown', reason: 'not-in-base' };
}

// ─── Wire-facing factory: produce a RuntimeCapabilities from the base env ────

export interface BuildRuntimeCapabilitiesInput {
    readonly baseHash: string;
    readonly rnVersion: string;
    readonly expoSdk: string;
    readonly platform: 'ios' | 'android';
    readonly concreteAliases?: readonly string[];
}

export function buildRuntimeCapabilities(
    input: BuildRuntimeCapabilitiesInput,
): RuntimeCapabilities {
    const concrete = input.concreteAliases ?? listConcreteCapabilitySpecifiers();
    return {
        abi: 'v1',
        baseHash: input.baseHash,
        rnVersion: input.rnVersion,
        expoSdk: input.expoSdk,
        platform: input.platform,
        aliases: concrete,
    };
}
