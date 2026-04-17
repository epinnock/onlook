/**
 * @onlook/mobile-client — purpose-built iOS/Android client for the Onlook preview pipeline.
 *
 * This workspace is scaffolded by MCF1 of plans/onlook-mobile-client-task-queue.md.
 * Subsequent Phase F tasks add the shared protocol package (MCF2–MCF7), the native
 * projects via expo prebuild (MCF8), and the Maestro e2e harness (MCF9).
 *
 * The OnlookRuntime JSI binding, relay client, inspector, and debug surface all land
 * as parallel waves (MC1–MC6) after Phase F completes. See plans/onlook-mobile-client-plan.md
 * for the architectural rationale.
 */

export const WORKSPACE_NAME = '@onlook/mobile-client' as const;
