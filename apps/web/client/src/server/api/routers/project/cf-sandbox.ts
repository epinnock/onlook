import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../../trpc';
import { env } from '@/env';

function getWorkerUrl(): string {
    const url = env.CLOUDFLARE_SANDBOX_WORKER_URL;
    if (!url) throw new Error('CLOUDFLARE_SANDBOX_WORKER_URL is not configured.');
    return url;
}

async function workerFetch<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${getWorkerUrl()}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = (await res.json()) as T & { error?: string };
    if (data.error) throw new Error(data.error);
    return data;
}

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
            const sandboxId = `cf-${input.template}-${Date.now()}`;

            // 1. Create the sandbox container
            const result = await withRetry(() =>
                workerFetch<{ sandboxId: string; ready: boolean; stdout: string }>(
                    '/sandbox/create',
                    { id: sandboxId },
                ),
            );

            // 2. Scaffold a minimal project inside the container
            const scaffoldCommands = input.template === 'nextjs'
                ? [
                    'mkdir -p /workspace/app/src/app',
                    'cd /workspace/app && npm init -y',
                    'cd /workspace/app && npm install next@latest react@latest react-dom@latest',
                    `cat > /workspace/app/src/app/page.tsx << 'PAGEOF'
export default function Home() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Hello from Scry IDE on Cloudflare</h1>
      <p>This Next.js app is running in a Cloudflare Sandbox container.</p>
    </main>
  );
}
PAGEOF`,
                    `cat > /workspace/app/src/app/layout.tsx << 'LAYOUTOF'
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html><body>{children}</body></html>;
}
LAYOUTOF`,
                    `cd /workspace/app && node -e "const p=require('./package.json'); p.scripts={dev:'next dev --port 3001'}; require('fs').writeFileSync('package.json',JSON.stringify(p,null,2))"`,
                ]
                : [
                    'mkdir -p /workspace/app',
                    'cd /workspace/app && npm init -y',
                    'cd /workspace/app && npm install expo react react-native',
                ];

            // Run scaffold commands sequentially
            for (const cmd of scaffoldCommands) {
                await workerFetch('/sandbox/exec', {
                    sandboxId: result.sandboxId,
                    command: cmd,
                });
            }

            return {
                sandboxId: result.sandboxId,
                previewUrl: `${getWorkerUrl()}/preview/${result.sandboxId}`,
                template: input.template,
                ready: result.ready,
            };
        }),

    start: protectedProcedure
        .input(z.object({ sandboxId: z.string() }))
        .mutation(async ({ input }) => {
            // Ping the sandbox to verify it's running
            const result = await workerFetch<{ stdout: string; success: boolean }>(
                '/sandbox/exec',
                { sandboxId: input.sandboxId, command: 'echo ok' },
            );
            return {
                sandboxId: input.sandboxId,
                status: result.success ? ('running' as const) : ('stopped' as const),
            };
        }),

    exec: protectedProcedure
        .input(
            z.object({
                sandboxId: z.string(),
                command: z.string(),
            }),
        )
        .mutation(async ({ input }) => {
            return workerFetch<{
                stdout: string;
                stderr: string;
                exitCode: number;
                success: boolean;
            }>('/sandbox/exec', {
                sandboxId: input.sandboxId,
                command: input.command,
            });
        }),

    fileRead: protectedProcedure
        .input(z.object({ sandboxId: z.string(), path: z.string() }))
        .query(async ({ input }) => {
            return workerFetch<{ content: string }>('/sandbox/file/read', {
                sandboxId: input.sandboxId,
                path: input.path,
            });
        }),

    fileWrite: protectedProcedure
        .input(z.object({ sandboxId: z.string(), path: z.string(), content: z.string() }))
        .mutation(async ({ input }) => {
            return workerFetch<{ ok: boolean }>('/sandbox/file/write', {
                sandboxId: input.sandboxId,
                path: input.path,
                content: input.content,
            });
        }),

    fileList: protectedProcedure
        .input(z.object({ sandboxId: z.string(), path: z.string().optional() }))
        .query(async ({ input }) => {
            return workerFetch<{ entries: Array<{ name: string; type: 'file' | 'directory' }> }>(
                '/sandbox/file/list',
                { sandboxId: input.sandboxId, path: input.path || '/workspace' },
            );
        }),

    stop: protectedProcedure
        .input(z.object({ sandboxId: z.string() }))
        .mutation(async ({ input }) => {
            await workerFetch('/sandbox/exec', {
                sandboxId: input.sandboxId,
                command: 'kill -TERM 1 2>/dev/null || true',
            }).catch(() => {});
            return { sandboxId: input.sandboxId, status: 'stopped' as const };
        }),

    hibernate: protectedProcedure
        .input(z.object({ sandboxId: z.string() }))
        .mutation(async ({ input }) => {
            return { sandboxId: input.sandboxId, status: 'paused' as const };
        }),
});
