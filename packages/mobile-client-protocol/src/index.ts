/**
 * @onlook/mobile-client-protocol — shared types, Zod schemas, and version constants
 * consumed by @onlook/mobile-client, apps/cf-expo-relay, and (eventually) the editor.
 *
 * Phase F scaffold (MCF2). The per-type modules (bundle-envelope, manifest, ws-messages,
 * inspector, runtime-version) are authored by MCF3–MCF7 as separate tasks. This file is
 * the hotspot index that pre-declares every re-export so it never needs to be edited
 * again after MCF2 lands.
 *
 * See plans/onlook-mobile-client-task-queue.md "Hotspot file registry" for the pattern.
 */

// MCF3 — bundle envelope (@onlook/browser-metro IIFE shape)
export * from './bundle-envelope.ts';

// MCF4 — cf-expo-relay manifest Zod schema
export * from './manifest.ts';

// MCF5 — WebSocket message discriminated union
export * from './ws-messages.ts';

// MCF6 — OnlookInspector descriptor types
export * from './inspector.ts';

// MCF7 — runtime version constant + compatibility matrix
export * from './runtime-version.ts';

// QC-06 — overlay protocol message schema
export * from './overlay.ts';

export const PROTOCOL_PACKAGE_NAME = '@onlook/mobile-client-protocol' as const;
