import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
    CodeProvider,
    createCodeProviderClient,
    getStaticCodeProvider,
} from '@onlook/code-provider';
import { getSandboxPreviewUrl, SandboxTemplates, Templates } from '@onlook/constants';
import { shortenUuid } from '@onlook/utility/src/id';
import { v4 as uuidv4 } from 'uuid';

import { createTRPCRouter, protectedProcedure } from '../../trpc';

function getProvider({
    sandboxId,
    userId,
    provider = CodeProvider.CodeSandbox,
}: {
    sandboxId: string;
    provider?: CodeProvider;
    userId?: undefined | string;
}) {
    if (provider === CodeProvider.CodeSandbox) {
        return createCodeProviderClient(CodeProvider.CodeSandbox, {
            providerOptions: {
                codesandbox: {
                    sandboxId,
                    userId,
                },
            },
        });
    } else {
        return createCodeProviderClient(CodeProvider.NodeFs, {
            providerOptions: {
                nodefs: {},
            },
        });
    }
}

export const sandboxRouter = createTRPCRouter({
    createLocal: protectedProcedure
        .input(
            z.object({
                template: z.enum(['expo', 'nextjs']),
                name: z.string().optional(),
            }),
        )
        .mutation(async ({ input }) => {
            const os = await import('node:os');
            const fs = await import('node:fs/promises');
            const path = await import('node:path');
            const { execSync } = await import('node:child_process');

            const rawName = input.name || input.template;
            const safeName = rawName.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || input.template;
            const projectId = `${safeName}-${Date.now()}`;
            const projectsDir = path.join(os.homedir(), '.scry', 'projects');
            const projectDir = path.join(projectsDir, projectId);
            const quote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

            await fs.mkdir(projectDir, { recursive: true });

            const port = input.template === 'expo' ? 8081 : 3000;

            try {
                if (input.template === 'expo') {
                    execSync(
                        `npx create-expo-app@latest ${quote(projectDir)} --template blank --no-install`,
                        { encoding: 'utf-8', timeout: 60000, stdio: 'pipe' },
                    );
                    // Install dependencies
                    execSync('npm install', {
                        cwd: projectDir,
                        encoding: 'utf-8',
                        timeout: 120000,
                        stdio: 'pipe',
                    });
                } else {
                    execSync(
                        `npx create-next-app@latest ${quote(projectDir)} --ts --tailwind --eslint --app --src-dir --no-import-alias --no-turbopack --use-npm`,
                        { encoding: 'utf-8', timeout: 120000, stdio: 'pipe' },
                    );
                }
            } catch (error) {
                // Clean up on failure
                await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to scaffold project: ${error instanceof Error ? error.message : String(error)}`,
                });
            }

            return {
                sandboxId: projectDir,
                previewUrl: `http://localhost:${port}`,
            };
        }),

    /**
     * Allocate a placeholder sandbox identifier for an ExpoBrowser-backed
     * project. No actual resource is created — files live in Supabase Storage
     * at `expo-projects/{projectId}/{branchId}/...` and the seeding happens
     * inside `project.create` once the branchId is known. This mutation just
     * hands the UI a stable sandboxId + previewUrl to pass through.
     */
    createExpoBrowser: protectedProcedure
        .input(
            z.object({
                name: z.string().optional(),
            }),
        )
        .mutation(async ({ input }) => {
            const sandboxId = `expo-browser-${uuidv4()}`;
            // The ExpoBrowser preview URL is served by the Next.js app itself at
            // `/preview/{branchId}` — we don't know the branchId yet, so return
            // a placeholder. The canvas will be updated with the real URL once
            // project.create runs and the branch frame is wired.
            const previewUrl = `/preview/${sandboxId}`;
            return {
                sandboxId,
                previewUrl,
                name: input.name ?? 'New Project',
            };
        }),
    create: protectedProcedure
        .input(
            z.object({
                title: z.string().optional(),
            }),
        )
        .mutation(async ({ input, ctx }) => {
            // Create a new sandbox using the static provider
            const CodesandboxProvider = await getStaticCodeProvider(CodeProvider.CodeSandbox);

            // Use the Expo Web template
            const template = SandboxTemplates[Templates.EXPO_WEB];

            const newSandbox = await CodesandboxProvider.createProject({
                source: 'template',
                id: template.id,
                title: input.title || 'Onlook Test Sandbox',
                description: 'Test sandbox for Onlook sync engine',
                tags: ['onlook-test'],
            });

            return {
                sandboxId: newSandbox.id,
                previewUrl: getSandboxPreviewUrl('code_sandbox', newSandbox.id, template.port),
            };
        }),

    start: protectedProcedure
        .input(
            z.object({
                sandboxId: z.string(),
            }),
        )
        .mutation(async ({ input, ctx }) => {
            const userId = ctx.user.id;
            const provider = await getProvider({
                sandboxId: input.sandboxId,
                userId,
            });
            const session = await provider.createSession({
                args: {
                    id: shortenUuid(userId, 20),
                },
            });
            await provider.destroy();
            return session;
        }),
    hibernate: protectedProcedure
        .input(
            z.object({
                sandboxId: z.string(),
            }),
        )
        .mutation(async ({ input }) => {
            const provider = await getProvider({ sandboxId: input.sandboxId });
            // Capability gate (Wave G / §0.9): providers without hibernate
            // (ExpoBrowser, NodeFs, Cloudflare) short-circuit cleanly. CSB
            // continues to hibernate as before.
            const caps = provider.getCapabilities?.();
            if (caps && !caps.supportsHibernate) {
                await provider.destroy().catch(() => {});
                return { ok: true, hibernated: false };
            }
            try {
                await provider.pauseProject({});
                return { ok: true, hibernated: true };
            } finally {
                await provider.destroy().catch(() => {});
            }
        }),
    list: protectedProcedure.input(z.object({ sandboxId: z.string() })).query(async ({ input }) => {
        const provider = await getProvider({ sandboxId: input.sandboxId });
        const res = await provider.listProjects({});
        // TODO future iteration of code provider abstraction will need this code to be refactored
        if ('projects' in res) {
            return res.projects;
        }
        return [];
    }),
    fork: protectedProcedure
        .input(
            z.object({
                sandbox: z.object({
                    id: z.string(),
                    port: z.number(),
                }),
                config: z
                    .object({
                        title: z.string().optional(),
                        tags: z.array(z.string()).optional(),
                    })
                    .optional(),
            }),
        )
        .mutation(async ({ input }) => {
            const MAX_RETRY_ATTEMPTS = 3;
            let lastError: Error | null = null;

            for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
                try {
                    const CodesandboxProvider = await getStaticCodeProvider(
                        CodeProvider.CodeSandbox,
                    );
                    const sandbox = await CodesandboxProvider.createProject({
                        source: 'template',
                        id: input.sandbox.id,

                        // Metadata
                        title: input.config?.title,
                        tags: input.config?.tags,
                    });

                    const previewUrl = getSandboxPreviewUrl('code_sandbox', sandbox.id, input.sandbox.port);

                    return {
                        sandboxId: sandbox.id,
                        previewUrl,
                    };
                } catch (error) {
                    lastError = error instanceof Error ? error : new Error(String(error));

                    if (attempt < MAX_RETRY_ATTEMPTS) {
                        await new Promise((resolve) =>
                            setTimeout(resolve, Math.pow(2, attempt) * 1000),
                        );
                    }
                }
            }

            throw new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: `Failed to create sandbox after ${MAX_RETRY_ATTEMPTS} attempts: ${lastError?.message}`,
                cause: lastError,
            });
        }),
    delete: protectedProcedure
        .input(
            z.object({
                sandboxId: z.string(),
            }),
        )
        .mutation(async ({ input }) => {
            const provider = await getProvider({ sandboxId: input.sandboxId });
            try {
                await provider.stopProject({});
            } finally {
                await provider.destroy().catch(() => {});
            }
        }),
    createFromGitHub: protectedProcedure
        .input(
            z.object({
                repoUrl: z.string(),
                branch: z.string(),
                port: z.number().optional(),
            }),
        )
        .mutation(async ({ input }) => {
            const MAX_RETRY_ATTEMPTS = 3;
            const DEFAULT_PORT = input.port ?? 3000;
            let lastError: Error | null = null;

            for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
                try {
                    const CodesandboxProvider = await getStaticCodeProvider(
                        CodeProvider.CodeSandbox,
                    );
                    const sandbox = await CodesandboxProvider.createProjectFromGit({
                        repoUrl: input.repoUrl,
                        branch: input.branch,
                    });

                    const previewUrl = getSandboxPreviewUrl('code_sandbox', sandbox.id, DEFAULT_PORT);

                    return {
                        sandboxId: sandbox.id,
                        previewUrl,
                    };
                } catch (error) {
                    lastError = error instanceof Error ? error : new Error(String(error));

                    if (attempt < MAX_RETRY_ATTEMPTS) {
                        await new Promise((resolve) =>
                            setTimeout(resolve, Math.pow(2, attempt) * 1000),
                        );
                    }
                }
            }

            throw new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: `Failed to create GitHub sandbox after ${MAX_RETRY_ATTEMPTS} attempts: ${lastError?.message}`,
                cause: lastError,
            });
        }),
});
