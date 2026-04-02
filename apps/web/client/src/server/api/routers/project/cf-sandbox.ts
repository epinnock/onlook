import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../../trpc';
import { env } from '@/env';

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt === maxAttempts) throw error;
            await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
        }
    }
    throw new Error('Unreachable');
}

export const cfSandboxRouter = createTRPCRouter({
    create: protectedProcedure
        .input(
            z.object({
                template: z.enum(['expo', 'nextjs']),
                name: z.string().optional(),
            }),
        )
        .mutation(async ({ input }) => {
            const apiToken = env.CLOUDFLARE_SANDBOX_API_TOKEN;
            const accountId = env.CLOUDFLARE_ACCOUNT_ID;
            if (!apiToken || !accountId) {
                throw new Error('Cloudflare credentials not configured.');
            }
            // Placeholder — will use @cloudflare/sandbox SDK
            return {
                sandboxId: `cf-${Date.now()}`,
                previewUrl: `https://placeholder.containers.dev`,
                template: input.template,
            };
        }),

    start: protectedProcedure
        .input(
            z.object({
                sandboxId: z.string(),
            }),
        )
        .mutation(async ({ input }) => {
            return { sandboxId: input.sandboxId, status: 'running' as const };
        }),

    stop: protectedProcedure
        .input(
            z.object({
                sandboxId: z.string(),
            }),
        )
        .mutation(async ({ input }) => {
            return { sandboxId: input.sandboxId, status: 'stopped' as const };
        }),

    hibernate: protectedProcedure
        .input(
            z.object({
                sandboxId: z.string(),
            }),
        )
        .mutation(async ({ input }) => {
            return { sandboxId: input.sandboxId, status: 'paused' as const };
        }),
});
