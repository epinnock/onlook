import { api } from '@/trpc/client';
import { CodeProvider, createCodeProviderClient, type Provider } from '@onlook/code-provider';
import type { Branch } from '@onlook/models';
import { makeAutoObservable } from 'mobx';
import type { ErrorManager } from '../error';
import { CLISessionImpl, CLISessionType, type CLISession, type TerminalSession } from './terminal';

export class SessionManager {
    provider: Provider | null = null;
    isConnecting = false;
    terminalSessions = new Map<string, CLISession>();
    activeTerminalSessionId = 'cli';

    constructor(
        private readonly branch: Branch,
        private readonly errorManager: ErrorManager
    ) {
        makeAutoObservable(this);
    }

    async start(sandboxId: string, userId?: string, providerType?: CodeProvider): Promise<void> {
        const MAX_RETRIES = 3;
        const RETRY_DELAY_MS = 2000;

        if (this.isConnecting || this.provider) {
            return;
        }

        this.isConnecting = true;

        // Provider selection priority:
        //   1. Explicit `providerType` arg from the caller (passed by the
        //      branch boot path after Wave G — reads branch.providerType
        //      from the DB).
        //   2. Branch model on `this.branch.sandbox.providerType` (set by
        //      the per-branch settings UI).
        //   3. Legacy sandboxId-prefix sniffing (cf- → Cloudflare,
        //      slash → NodeFs, else CSB).
        const branchProviderType = (this.branch as { sandbox?: { providerType?: string } } | undefined)?.sandbox?.providerType;
        const resolvedProvider: CodeProvider = providerType
            ?? (branchProviderType as CodeProvider | undefined)
            ?? (sandboxId.startsWith('cf-') ? CodeProvider.Cloudflare
            : sandboxId.startsWith('/') || sandboxId.includes('/') ? CodeProvider.NodeFs
            : CodeProvider.CodeSandbox);

        const attemptConnection = async () => {
            let provider;

            if (resolvedProvider === CodeProvider.Cloudflare) {
                provider = await createCodeProviderClient(CodeProvider.Cloudflare, {
                    providerOptions: {
                        cloudflare: {
                            sandboxId,
                            workerUrl: process.env.NEXT_PUBLIC_CF_SANDBOX_WORKER_URL || 'http://localhost:8787',
                        },
                    },
                });
            } else if (resolvedProvider === CodeProvider.NodeFs) {
                provider = await createCodeProviderClient(CodeProvider.NodeFs, {
                    providerOptions: {
                        nodefs: { rootDir: sandboxId },
                    },
                });
            } else if (resolvedProvider === CodeProvider.ExpoBrowser) {
                // Wave D §1.7: ExpoBrowser branches read from Supabase
                // Storage. The projectId comes from the branch reference;
                // the supabase URL/anon key from env. The branch retains
                // its CSB sandboxId (Position B) — that ID is used as the
                // storage prefix discriminator.
                const projectId = (this.branch as { projectId?: string } | undefined)?.projectId ?? '';
                const branchId = (this.branch as { id?: string } | undefined)?.id ?? sandboxId;
                provider = await createCodeProviderClient(CodeProvider.ExpoBrowser, {
                    providerOptions: {
                        expoBrowser: {
                            projectId,
                            branchId,
                            supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
                            supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
                        },
                    },
                });
            } else {
                provider = await createCodeProviderClient(CodeProvider.CodeSandbox, {
                    providerOptions: {
                        codesandbox: {
                            sandboxId,
                            userId,
                            initClient: true,
                            getSession: async (sandboxId, userId) => {
                                return api.sandbox.start.mutate({ sandboxId });
                            },
                        },
                    },
                });
            }

            this.provider = provider;
            await this.createTerminalSessions(provider);
        };

        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                await attemptConnection();
                this.isConnecting = false;
                return;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                console.error(`Failed to start sandbox session (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`, error);

                this.provider = null;

                if (attempt < MAX_RETRIES) {
                    console.log(`Retrying sandbox connection in ${RETRY_DELAY_MS}ms...`);
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                }
            }
        }

        this.isConnecting = false;
        throw lastError;
    }

    async restartDevServer(): Promise<boolean> {
        if (!this.provider) {
            console.error('No provider found in restartDevServer');
            return false;
        }
        for (const taskId of ['dev', 'start']) {
            try {
                const { task } = await this.provider.getTask({ args: { id: taskId } });
                if (task) {
                    await task.restart();
                    return true;
                }
            } catch {
                // Try next task name
            }
        }
        return false;
    }

    async readDevServerLogs(): Promise<string> {
        for (const taskId of ['dev', 'start']) {
            try {
                const result = await this.provider?.getTask({ args: { id: taskId } });
                if (result) {
                    return await result.task.open();
                }
            } catch {
                // Try next task name
            }
        }
        return 'Dev server not found';
    }



    getTerminalSession(id: string) {
        return this.terminalSessions.get(id) as TerminalSession | undefined;
    }

    onExpoUrlDetected?: (url: string) => void;

    async createTerminalSessions(provider: Provider) {
        // Always create the task session — every provider has a virtual
        // 'dev' task (CSB runs Metro/Next; ExpoBrowser's BrowserTask drives
        // the in-browser bundler).
        const task = new CLISessionImpl(
            'server',
            CLISessionType.TASK,
            provider,
            this.errorManager,
            { onExpoUrlDetected: (url) => this.onExpoUrlDetected?.(url) },
        );
        this.terminalSessions.set(task.id, task);
        this.activeTerminalSessionId = task.id;

        // Wave D §1.7.2 — capability-gated terminal session.
        // Providers without a real shell (ExpoBrowser, NodeFs) skip the
        // interactive xterm session entirely. The bottom-panel terminal
        // tab should hide for these branches (UI-side filter not yet
        // wired — happens when the bottom panel reads
        // session.terminalSessions and looks for type === TERMINAL).
        const caps = provider.getCapabilities?.();
        const supportsTerminal = caps?.supportsTerminal ?? true;

        if (supportsTerminal) {
            const terminal = new CLISessionImpl(
                'terminal',
                CLISessionType.TERMINAL,
                provider,
                this.errorManager,
            );
            this.terminalSessions.set(terminal.id, terminal);

            // Initialize both sessions after creation
            try {
                await Promise.all([
                    task.initTask(),
                    terminal.initTerminal()
                ]);
            } catch (error) {
                console.error('Failed to initialize terminal sessions:', error);
            }
        } else {
            // Initialize only the task session
            try {
                await task.initTask();
            } catch (error) {
                console.error('Failed to initialize task session:', error);
            }
        }
    }

    async disposeTerminal(id: string) {
        const terminal = this.terminalSessions.get(id) as TerminalSession | undefined;
        if (terminal) {
            if (terminal.type === CLISessionType.TERMINAL) {
                await terminal.terminal?.kill();
                if (terminal.xterm) {
                    terminal.xterm.dispose();
                }
            }
            this.terminalSessions.delete(id);
        }
    }

    async hibernate(sandboxId: string) {
        await api.sandbox.hibernate.mutate({ sandboxId });
    }

    async reconnect(sandboxId: string, userId?: string) {
        try {
            if (!this.provider) {
                console.error('No provider found in reconnect');
                return;
            }

            // Check if the session is still connected
            const isConnected = await this.ping();
            if (isConnected) {
                return;
            }

            // Attempt soft reconnect
            await this.provider?.reconnect();

            const isConnected2 = await this.ping();
            if (isConnected2) {
                return;
            }
            await this.restartProvider(sandboxId, userId);
        } catch (error) {
            console.error('Failed to reconnect to sandbox', error);
            this.isConnecting = false;
        }
    }

    async restartProvider(sandboxId: string, userId?: string) {
        if (!this.provider) {
            return;
        }
        await this.provider.destroy();
        this.provider = null;
        await this.start(sandboxId, userId);
    }

    async ping() {
        if (!this.provider) return false;
        try {
            // Wave D §1.7.1: route through provider.ping() instead of
            // runCommand("echo ping"). The interceptor on no-shell
            // providers (ExpoBrowser) wouldn't allow `echo` and would
            // surface PROVIDER_NO_SHELL — making the session look dead.
            // provider.ping() is the abstract-class contract for "are you
            // alive" and every provider implements it.
            return await this.provider.ping();
        } catch (error) {
            console.error('Failed to connect to sandbox', error);
            return false;
        }
    }

    async runCommand(
        command: string,
        streamCallback?: (output: string) => void,
        ignoreError: boolean = false,
    ): Promise<{
        output: string;
        success: boolean;
        error: string | null;
    }> {
        try {
            if (!this.provider) {
                throw new Error('No provider found in runCommand');
            }

            // Append error suppression if ignoreError is true
            const finalCommand = ignoreError ? `${command} 2>/dev/null || true` : command;

            streamCallback?.(finalCommand + '\n');
            const { output } = await this.provider.runCommand({ args: { command: finalCommand } });
            streamCallback?.(output);
            return {
                output,
                success: true,
                error: null,
            };
        } catch (error) {
            console.error('Error running command:', error);
            return {
                output: '',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred',
            };
        }
    }

    async clear() {
        // probably need to be moved in `Provider.destroy()`
        this.terminalSessions.forEach((terminal) => {
            if (terminal.type === CLISessionType.TERMINAL) {
                terminal.terminal?.kill();
                if (terminal.xterm) {
                    terminal.xterm.dispose();
                }
            }
        });
        if (this.provider) {
            await this.provider.destroy();
        }
        this.provider = null;
        this.isConnecting = false;
        this.terminalSessions.clear();
    }
}
