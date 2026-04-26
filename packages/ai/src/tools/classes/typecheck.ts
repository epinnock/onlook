import { Icons } from '@onlook/ui/icons';
import type { EditorEngineLike as EditorEngine } from '../types/editor-engine';
import { z } from 'zod';
import { ClientTool } from '../models/client';
import { BRANCH_ID_SCHEMA } from '../shared/type';

export class TypecheckTool extends ClientTool {
    static readonly toolName = 'typecheck';
    static readonly description = 'Run TypeScript type checking. use to check after code edits, when type changes are suspected.';
    static readonly parameters = z.object({
        branchId: BRANCH_ID_SCHEMA,
    });
    static readonly icon = Icons.MagnifyingGlass;

    async handle(
        args: z.infer<typeof TypecheckTool.parameters>,
        editorEngine: EditorEngine,
    ): Promise<{
        success: boolean;
        error?: string;
    }> {
        try {
            const sandbox = editorEngine.branches.getSandboxById(args.branchId);
            if (!sandbox) {
                return {
                    success: false,
                    error: `Sandbox not found for branch ID: ${args.branchId}`
                };
            }

            // Per-branch capability gate (Wave B / §1.7.6).
            // ExpoBrowser branches have no shell — typecheck via @typescript/vfs
            // in a Web Worker is the long-term plan (§1.7.6 measurement gate),
            // but it's deferred until Sprint 4. For v1, return a clean
            // "unavailable" so the agent moves on instead of erroring.
            const caps = sandbox.session.provider?.getCapabilities?.();
            if (caps && !caps.supportsShell) {
                return {
                    success: true,
                    error: 'Typecheck is not yet available in browser-preview mode. Trust the editor squiggles + write_file changes are validated by the bundler at preview time.',
                };
            }

            // Run Next.js typecheck command
            const result = await sandbox.session.runCommand('bunx tsc --noEmit');

            if (result.success) {
                return {
                    success: true
                };
            } else {
                return {
                    success: false,
                    error: result.error || result.output || 'Typecheck failed with unknown error'
                };
            }
        } catch (error: any) {
            return {
                success: false,
                error: error.message || error.toString()
            };
        }
    }
    static getLabel(input?: z.infer<typeof TypecheckTool.parameters>): string {
        return 'Checking types';
    }
}