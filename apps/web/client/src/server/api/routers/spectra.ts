import 'server-only';

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { env } from '@/env';
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc';
import { SpectraApiError, SpectraClient, SpectraConfigError } from '~/server/spectra/client';
import {
    assertOwnership,
    dropSession,
    registerSession,
    touchSession,
} from '~/server/spectra/registry';

/**
 * Spectra inline-simulator preview tRPC surface. All procedures are
 * authenticated; feature-flag + config preconditions are checked by the
 * shared `ensureConfigured()` helper so a misconfigured server never
 * silently ghosts a client.
 *
 * The client never talks to Spectra directly — this router + the MJPEG
 * proxy Route Handler are the only bridges.
 */

function ensureConfigured(): void {
    if (!env.NEXT_PUBLIC_FEATURE_SPECTRA_PREVIEW) {
        throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Spectra preview feature flag is not enabled.',
        });
    }
    if (!env.SPECTRA_API_URL) {
        throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'SPECTRA_API_URL is not configured on the server.',
        });
    }
}

function clientOrThrow(): SpectraClient {
    try {
        return new SpectraClient();
    } catch (err) {
        if (err instanceof SpectraConfigError) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: err.message });
        }
        throw err;
    }
}

function toTRPCError(err: unknown, fallback: string): TRPCError {
    if (err instanceof TRPCError) return err;
    if (err instanceof SpectraApiError) {
        return new TRPCError({ code: 'BAD_GATEWAY', message: err.message });
    }
    const message = err instanceof Error ? err.message : fallback;
    return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
}

export const spectraRouter = createTRPCRouter({
    health: protectedProcedure.query(async () => {
        ensureConfigured();
        const client = clientOrThrow();
        return { healthy: await client.health() };
    }),

    createSession: protectedProcedure
        .input(
            z.object({
                deepLinkUrl: z.string().min(1).max(2048).optional(),
                deviceName: z.string().min(1).max(100).default('Onlook Preview'),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            ensureConfigured();
            if (!env.SPECTRA_ONLOOK_MOBILE_CLIENT_APP_ID) {
                throw new TRPCError({
                    code: 'PRECONDITION_FAILED',
                    message:
                        'SPECTRA_ONLOOK_MOBILE_CLIENT_APP_ID is not set. Upload the Onlook Mobile Client to Spectra (see plans/spectra-inline-simulator-runbook.md) and set the env var on the server.',
                });
            }
            const client = clientOrThrow();

            try {
                const device = await client.createSimulator({
                    name: input.deviceName,
                    installAppId: env.SPECTRA_ONLOOK_MOBILE_CLIENT_APP_ID,
                });
                registerSession(ctx.user.id, device.id);

                if (input.deepLinkUrl) {
                    try {
                        await client.openUrl(device.id, input.deepLinkUrl);
                    } catch (err) {
                        // The sim is provisioned but the deep-link push
                        // failed — tear down to avoid leaving a zombie the
                        // user can't reach.
                        await client.deleteDevice(device.id).catch(() => undefined);
                        dropSession(device.id);
                        throw toTRPCError(err, 'Failed to open deep link on the new simulator');
                    }
                }

                return {
                    sessionId: device.id,
                    deviceId: device.id,
                    mjpegPath: `/api/spectra/mjpeg/${encodeURIComponent(device.id)}`,
                    screenSize: device.screenSize ?? null,
                };
            } catch (err) {
                throw toTRPCError(err, 'Failed to create Spectra simulator session');
            }
        }),

    openDeepLink: protectedProcedure
        .input(
            z.object({
                sessionId: z.string().min(1),
                url: z.string().min(1).max(2048),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            ensureConfigured();
            assertOwnership(ctx.user.id, input.sessionId);
            touchSession(input.sessionId);
            const client = clientOrThrow();
            try {
                await client.openUrl(input.sessionId, input.url);
                return { ok: true as const };
            } catch (err) {
                throw toTRPCError(err, 'Failed to open URL on the simulator');
            }
        }),

    tap: protectedProcedure
        .input(
            z.object({
                sessionId: z.string().min(1),
                x: z.number().min(0).max(1),
                y: z.number().min(0).max(1),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            ensureConfigured();
            assertOwnership(ctx.user.id, input.sessionId);
            touchSession(input.sessionId);
            const client = clientOrThrow();
            try {
                await client.tap(input.sessionId, input.x, input.y);
                return { ok: true as const };
            } catch (err) {
                throw toTRPCError(err, 'Tap failed');
            }
        }),

    swipe: protectedProcedure
        .input(
            z.object({
                sessionId: z.string().min(1),
                x1: z.number().min(0).max(1),
                y1: z.number().min(0).max(1),
                x2: z.number().min(0).max(1),
                y2: z.number().min(0).max(1),
                durationMs: z.number().int().min(50).max(5000).optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            ensureConfigured();
            assertOwnership(ctx.user.id, input.sessionId);
            touchSession(input.sessionId);
            const client = clientOrThrow();
            try {
                await client.swipe(input.sessionId, {
                    x1: input.x1,
                    y1: input.y1,
                    x2: input.x2,
                    y2: input.y2,
                    durationMs: input.durationMs,
                });
                return { ok: true as const };
            } catch (err) {
                throw toTRPCError(err, 'Swipe failed');
            }
        }),

    endSession: protectedProcedure
        .input(z.object({ sessionId: z.string().min(1) }))
        .mutation(async ({ ctx, input }) => {
            ensureConfigured();
            // Drop local ownership even on error so a forever-leaked entry
            // doesn't block the next createSession.
            try {
                assertOwnership(ctx.user.id, input.sessionId);
            } catch {
                // Session was never ours or already dropped — no-op.
                return { ok: true as const };
            }
            const client = clientOrThrow();
            try {
                await client.deleteDevice(input.sessionId);
                return { ok: true as const };
            } catch (err) {
                throw toTRPCError(err, 'Failed to tear down simulator');
            } finally {
                dropSession(input.sessionId);
            }
        }),
});
