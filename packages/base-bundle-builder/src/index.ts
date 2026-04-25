export {
    createBaseBundleBuildOptions,
    isBaseBundlePlatform,
    type BaseBundleBuildOptions,
    type BaseBundlePlatform,
    type CreateBaseBundleBuildOptionsInput,
} from './options';

// ADR-0001 / two-tier-overlay-v2 task #3 — runtime capability classification.
export {
    REQUIRED_ALIASES,
    OPTIONAL_CAPABILITY_GROUPS,
    DISALLOWED_NATIVE_ALIASES,
    buildRuntimeCapabilities,
    classifyImport,
    listConcreteCapabilitySpecifiers,
    listSatisfiedOptionalCapabilityGroups,
    type BuildRuntimeCapabilitiesInput,
    type DisallowedNativeAlias,
    type ImportPolicyVerdict,
    type OptionalCapabilityGroup,
    type OptionalCapabilitySpecifier,
    type RequiredAlias,
} from './runtime-capabilities';

// ADR-0001 / two-tier-overlay-v2 task #10 — base manifest emitter.
export {
    emitBaseManifest,
    writeBaseManifest,
    type EmitBaseManifestInput,
} from './base-manifest';
