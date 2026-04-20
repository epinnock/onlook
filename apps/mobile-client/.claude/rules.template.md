# Task scope for <TASK_ID>

> This file is dropped into each worktree at `.trees/<task-id>-<slug>/.claude/rules.md`
> by the orchestrator before the agent starts. The `<TASK_ID>`, `<SLUG>`, and
> `<FILES>` placeholders are filled in from the task entry in
> `plans/onlook-mobile-client-task-queue.md`.
>
> **Rule of thumb:** if you're about to edit a file that isn't in the Files list,
> STOP and report. That's a sign the task needs to be split or that you're about
> to violate a hotspot owned by a different task.

## Files (the ONLY files this task may modify)

<FILES>

## Hotspot boundaries (NEVER edit these unless you are the explicit owner)

- `apps/mobile-client/package.json` — owned by **MCF1**. If you need a new
  dependency, STOP and dead-letter. A follow-up MCF1 patch adds it.
- `apps/mobile-client/ios/OnlookMobile.xcodeproj/project.pbxproj` — owned by
  **MCF8**. New Swift/ObjC/C++ files must be pre-registered there. If you
  discover you need a NEW file type that MCF8 didn't anticipate, STOP and
  dead-letter.
- `apps/mobile-client/ios/Podfile` and `Podfile.lock` — owned by **MCF8**.
- `apps/mobile-client/ios/OnlookMobile/Info.plist` — owned by **MCF8**.
- `apps/mobile-client/android/app/build.gradle` — owned by **MCF8**.
- `apps/mobile-client/android/app/src/main/AndroidManifest.xml` — owned by **MCF8**.
- `packages/mobile-client-protocol/src/index.ts` — owned by **MCF2**. New type
  files go in their own module; `index.ts` already re-exports every anticipated
  module.
- `apps/cf-expo-relay/src/manifest-builder.ts` — owned by **MC6.2**.
- `packages/browser-metro/src/host/index.ts` — owned by **MC4.12**.
- `apps/web/client/src/server/api/root.ts` — owned by **MC4.16** for any
  mobile-inspector router registration.

## Code style non-negotiables

1. **No `any`.** No `as unknown as`. No `@ts-ignore`. Source plan CLAUDE.md rule.
2. **`verbatimModuleSyntax: true`** is on. Use `import type` for type-only
   imports.
3. **`noUncheckedIndexedAccess: true`** is on. Array/record access returns
   `T | undefined` — handle it.
4. **Use path aliases where they exist.** `@/*` and `~/*` for the editor. The
   mobile-client workspace uses relative imports within `src/`.
5. **Zod first.** Every wire-level type is defined with a Zod schema in
   `@onlook/mobile-client-protocol`. Import the schema + the inferred type; do
   NOT hand-author wire types.
6. **No emojis** in files unless the user asks.

## Validation gate

Every task has a `validate` command listed in its queue entry. A task passes
when `validate` exits 0. If you hit three attempts with test output fed back
as context and still fail, STOP and report — the orchestrator will dead-letter
the task for human triage.

## Out-of-scope signals (dead-letter immediately if hit)

- You need to edit a file outside the Files list
- You need to touch a hotspot owned by a different task
- You need to add a new dependency
- You need to create a new top-level directory
- You discover the task description is wrong or incomplete
- The `validate` command requires tooling not yet installed on the machine
