/**
 * tRPC router for editor-side mobile inspector operations.
 *
 * Scope (MC4.16): router registration only. The procedures here are
 * intentionally thin skeletons — future Wave 4 tasks (MC4.17+) will
 * wire them into the editor's selection state and Monaco cursor jump.
 *
 * The WebSocket receiver that actually fans `onlook:select` messages
 * out to local subscribers lives at
 * `apps/web/client/src/services/expo-relay/onlookSelectReceiver.ts`
 * (MC4.15). This router is the tRPC-shaped entrypoint that in-process
 * callers (e.g. the WS pump) can use to record or look up the
 * currently-connected mobile session; the receiver stays
 * transport-agnostic.
 *
 * See `plans/onlook-mobile-client-task-queue.md` — task MC4.16.
 */
import { SelectMessageSchema } from '@onlook/mobile-client-protocol';
import { createTRPCRouter, publicProcedure } from '../trpc';

export const mobileInspectorRouter = createTRPCRouter({
    /**
     * Returns the currently-connected mobile session id, or `null` when
     * no device is paired with this editor instance.
     *
     * Placeholder implementation: a server-side session registry lands
     * with a later task in Wave 4. Until then this always resolves to
     * `null` so callers can wire the hook end-to-end without waiting on
     * the registry.
     */
    getActiveSession: publicProcedure.query((): string | null => {
        return null;
    }),

    /**
     * Forwarded endpoint for `onlook:select` messages arriving from the
     * editor's WS receiver. Validates the payload against the shared
     * protocol schema (so the router and the receiver agree on the wire
     * format) and — for now — just logs it.
     *
     * Later tasks will replace the log with a dispatch into the
     * editor's selection state + Monaco cursor jump (MC4.17).
     */
    onSelect: publicProcedure
        .input(SelectMessageSchema)
        .mutation(({ input }): { ok: true } => {
            console.log('[mobileInspector] onlook:select', {
                sessionId: input.sessionId,
                reactTag: input.reactTag,
                source: input.source,
            });
            return { ok: true };
        }),
});
