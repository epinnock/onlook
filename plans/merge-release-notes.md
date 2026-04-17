# Release notes — `feat/mobile-preview-merge` (PR #12)

User-facing summary of the consolidated mobile-preview + mobile-client merge.

## What's new

- **Live preview on a real phone actually works.** Edit `App.tsx` in the Onlook editor, hit Save, and the iOS Simulator (Expo Go SDK 54) repaints in ~15 ms end-to-end. Three consecutive edits produce three distinct frames — the old "stuck on first commit" bug is gone.
- **React hooks are unblocked in AI-generated screens.** `useState`, `useEffect`, and `useRef` now run correctly through the eval-pushed preview pipeline. No more "Cannot read properties of null (reading 'useState')" — you can ask Onlook to build a stateful screen (login forms, expandable sections, counters) and it will mount on the phone first try. Class-component workarounds are no longer needed.
- **Custom Onlook Mobile Client scaffolded.** `apps/mobile-client/` ships as the iOS custom host (Swift + C++ JSI installers) that registers `globalThis.OnlookRuntime` and `globalThis.OnlookInspector`. The runtime skips Expo-Go bootstrap when it detects OnlookRuntime, so the same runtime bundle drives both targets.
- **Sub-50 ms push latency.** `POST /push` → first commit on the sim is ~15-25 ms; sustained throughput is ~50 pushes/sec over 100 rapid edits with no OOM or drops.
- **Stronger contracts across code-provider.** Cloudflare and CodeSandbox providers now conform to the canonical `types.ts` shape (`writeFile`, `readFile`, `listFiles`, `statFile`, `DeleteFilesInput`, `CopyFilesInput`, `CreateTerminalInput`, `SandboxPrivacy`). 0 typecheck errors; no `any` introduced.
- **Build-time guardrails.** The runtime build now fails if it detects multiple React copies in the output (catches the workspace-hoisting version-split bug at build time instead of as a runtime hook failure) and if ESM syntax leaks into a bundle that should be pure CJS.

## Under the hood

Two architectural fixes on top of the raw merge worth calling out for downstream branches:

1. **Fabric reactTag dedupe workaround.** Every `renderApp` call wraps its input in a keyed Fragment so the root host instance remount forces a fresh `reactTag`; otherwise Expo Go SDK 54's early-Fabric UIManager treats the second `completeRoot` as redundant and drops the update. ADR: `plans/adr/B13-fabric-reactTag-dedupe-keyed-render.md`.
2. **React dispatcher linkage via workspace dedupe.** Aligning `packages/mobile-preview`'s react pin to 19.2.0 (matching the root workspace) produces a single React instance in the bundle. Post-mortem with the full trace: `plans/post-mortems/2026-04-17-two-react-copies-hooks-null.md`.
