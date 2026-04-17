# ADR: Module allowlist enforced at the JS-import surface, not the linked-binary set

**Status:** accepted (2026-04-15)
**Context for:** MC1.8 of `plans/onlook-mobile-client-task-queue.md`
**Supersedes:** the original MC1.8 "ExpoFileSystem absent from `Pods/Pods.xcodeproj/project.pbxproj`" assertion

## Context

The Onlook Mobile Client wants a deliberate, narrow Expo module allowlist:

| Module | Why it's allowed |
|---|---|
| `expo-camera` | QR scan onboarding (Phase 3 of the source plan) |
| `expo-secure-store` | Stores the relay session token across app restarts |
| `expo-haptics` | Touch feedback during inspector interactions (Wave 5) |

Everything else — `expo-av`, `expo-location`, `expo-file-system`, `expo-asset`, `expo-constants`, `expo-font`, `expo-keep-awake`, etc. — is intended to stay out so the binary is small, the attack surface is narrow, and the runtime expectations don't drift from `packages/mobile-preview/runtime/bundle.js`.

The original MC1.8 plan asserted enforcement at the **linked-binary level** with this validate command:

```bash
cd apps/mobile-client/ios && grep -L ExpoFileSystem Pods/Pods.xcodeproj/project.pbxproj
```

That assertion is structurally broken. `ExpoFileSystem` is a **baseline peer dependency** of `expo-modules-core` (which `expo` itself requires). It appears 76 times in the current `Pods.xcodeproj/project.pbxproj`. So do `ExpoAsset`, `ExpoConstants`, `ExpoFont`, `ExpoKeepAwake`, `ExpoFetchModule`, etc. — every one a transitive dep of `expo` core. Excluding any of them via `react-native.config.js` autolinking filter would break the `expo` package's own initialization.

The intended allowlist is therefore not "the only Expo libraries linked into the binary." It is "the only Expo libraries user JS code may import." A different enforcement mechanism is needed.

## Decision

**Two-tier enforcement, both at build time:**

1. **ESLint rule (static, primary).** Custom `no-restricted-imports` rule in `apps/mobile-client/eslint.config.{js,mjs}` (or extend the existing `@onlook/eslint` config) that errors on any `import` from an Expo package not in the allowlist. List of denied packages comes from `apps/mobile-client/SUPPORTED_MODULES.md` (single source of truth — already shipped as MC1.9). Catches most violations at edit-time in the IDE and at `bun run lint`.

2. **Metro resolver block (runtime-build, defense in depth).** A `metro.config.js` resolver hook in `apps/mobile-client/` that throws during bundling if any module graph walk resolves into a banned Expo package. Catches violations that slip past ESLint (e.g. dynamic imports, indirect requires from a transitively-included library).

Linked-binary set is left alone. Baseline Expo modules stay in `Pods/` because `expo` needs them; the allowlist applies to what user code can reach, not what the binary contains.

## New MC1.8 Validate

Replaces the original `grep -L ExpoFileSystem ...` assertion:

```bash
bun --filter @onlook/mobile-client lint \
  && bash apps/mobile-client/scripts/validate-mc18.sh
```

Where `validate-mc18.sh` writes a temporary `apps/mobile-client/__lint_probe__.ts` with `import "expo-av";` (a banned module that's NOT in `apps/mobile-client/package.json`'s dependencies), runs ESLint and Metro bundle against it, asserts both fail with the expected error message, then deletes the probe. Pass iff both rejected the probe.

## Consequences

### What changes

- `apps/mobile-client/.eslintrc.{js,cjs,json}` (or the equivalent in flat `eslint.config.js`) gains a `no-restricted-imports` rule with the deny list. Allowlist itself stays in `SUPPORTED_MODULES.md`; the ESLint rule reads it (or the deny list is inverted from a hardcoded allowlist constant inside the lint config).
- `apps/mobile-client/metro.config.js` gains a custom resolver wrapper that delegates to the default resolver and rejects when the resolved path lives under `node_modules/expo-<not-allowlisted>`.
- `apps/mobile-client/scripts/validate-mc18.sh` lands as the validate driver.
- `apps/mobile-client/SUPPORTED_MODULES.md` becomes load-bearing — its "Allowed" / "Disallowed" sections are the source of truth that both lint and Metro read. Edit with care; consider exporting a constant `SUPPORTED_MODULES.ts` and having both tools read it programmatically once we feel the doc-string drift bite.
- `react-native.config.js` from the original MC1.8 spec is **not** added — it would have had to either (a) selectively null out a long list of baseline modules (would break `expo`) or (b) try to whitelist via a `dependencies` callback, which doesn't have a documented "deny everything not in this set" shape.

### What this gives up

- A truly-determined developer can still add a banned module to `package.json`, run `bun install` + `bun x expo prebuild`, and get its native code linked. The lint + Metro layers only stop *imports*. We don't have a hook that fails CI on `package.json` containing a banned dep — leave that as a code-review check or a follow-up.
- Dynamic `require(some_string_at_runtime)` won't be caught by either layer. Acceptable — the runtime would still fail because the module isn't installed; the goal is "loud, early failure during development," which the lint layer delivers for the 99% case.

### What this gains

- No fight with Expo's baseline dependency set. `expo-modules-core` and friends keep their peer chain intact.
- Lint catches violations seconds after typing the import — best feedback loop.
- Metro catches them before the user bundle is bundled — last line of defense before the app even launches.
- The validate is fast (lint runs in seconds) and doesn't depend on simulator state, so it fits in the same `validate-task.ts` model the rest of the queue uses.

## Pointers

- Allowlist source of truth: `apps/mobile-client/SUPPORTED_MODULES.md` (commit `e4e7daa9`).
- Active dependencies: `apps/mobile-client/package.json` `dependencies` field — `expo-camera`, `expo-haptics`, `expo-secure-store` are listed; nothing else should appear there, but this isn't enforced today.
- ESLint config: project uses `@onlook/eslint` (workspace `tooling/eslint`); per-app overrides go in `apps/mobile-client/eslint.config.{js,mjs}` if introduced.
- Metro config: doesn't exist in `apps/mobile-client/` yet — would be a new `metro.config.js` derived from `expo/metro-config`'s default.

## Follow-ups

- Implement and validate the two enforcement layers as MC1.8's actual code task. This ADR only sets the direction.
- Consider extracting the allowlist into a small TS module (`apps/mobile-client/src/supported-modules.ts`) so both ESLint and Metro can `import` the same source-of-truth array — eliminates the doc/code drift risk.
- Decide whether to also fail CI on `package.json` containing banned deps (cheap script or `manypkg`-style policy check).
