/**
 * Structural types for the slice of `EditorEngine` and `SandboxManager` that
 * the tool classes consume.
 *
 * Why this exists: tool classes used to `import type { EditorEngine } from
 * '@onlook/web-client/src/components/store/editor/engine'`. That deep import
 * dragged the whole editor source tree into the type-resolution graph of
 * every package that transitively imports `@onlook/ai` (via `@onlook/models`
 * → `ChatTools`). Since the editor uses web-client-only path aliases
 * (`@/trpc/client`, `@/env`, …) that aren't visible to per-package
 * `tsc` invocations, ~14 leaf packages failed typecheck even though their
 * own source was fine. See `plans/typecheck-cliff-2026-04-26.md`.
 *
 * The interfaces below mirror only the shapes the tool classes actually
 * touch. The concrete `EditorEngine` / `SandboxManager` classes in
 * `apps/web/client/src/components/store/editor/` structurally satisfy these
 * without any explicit `implements` declaration.
 */

import type { CodeFileSystem, FileEntry } from '@onlook/file-system';
import type { Branch, ChatMessage, ColorUpdate, WebSearchResult } from '@onlook/models';
import type { ParsedError } from '@onlook/utility';

export interface ApiManagerLike {
    webSearch(input: {
        query: string;
        allowed_domains: string[] | undefined;
        blocked_domains: string[] | undefined;
    }): Promise<WebSearchResult>;
    applyDiff(input: {
        originalCode: string;
        updateSnippet: string;
        instruction: string;
        metadata: {
            projectId: string;
            conversationId: string | undefined;
        };
    }): Promise<{ result: string | null; error: string | null }>;
    scrapeUrl(input: {
        url: string;
        formats?: ('json' | 'markdown' | 'html' | 'branding')[] | undefined;
        onlyMainContent?: boolean | undefined;
        includeTags?: string[] | undefined;
        excludeTags?: string[] | undefined;
        waitFor?: number | undefined;
    }): Promise<{ result: string | null; error: string | null }>;
    getConversationMessages(conversationId: string): Promise<ChatMessage[]>;
}

export interface ProviderCapabilitiesLike {
    supportsShell: boolean;
}

export interface ProviderLike {
    getCapabilities?: () => ProviderCapabilitiesLike;
}

export interface SessionManagerLike {
    provider: ProviderLike | null;
    runCommand(
        command: string,
        streamCallback?: (output: string) => void,
        ignoreError?: boolean,
    ): Promise<{ output: string; success: boolean; error: string | null }>;
    readDevServerLogs(): Promise<string>;
    restartDevServer(): Promise<boolean>;
}

export interface SandboxManagerLike {
    session: SessionManagerLike;
    readDir(dir: string): Promise<FileEntry[]>;
    readFile(path: string): Promise<string | Uint8Array>;
    writeFile(path: string, content: string | Uint8Array): Promise<void>;
}

export interface BranchDataLike {
    branch: Branch;
    sandbox: SandboxManagerLike;
    codeEditor: CodeFileSystem;
}

export interface BranchManagerLike {
    activeBranch: Branch;
    allBranches: Branch[];
    getAllErrors(): ParsedError[];
    getBranchDataById(branchId: string): BranchDataLike | null;
    getSandboxById(branchId: string): SandboxManagerLike | null;
}

export interface ConversationManagerLike {
    current: { id: string } | null;
}

export interface ChatManagerLike {
    conversation: ConversationManagerLike;
    getCurrentConversationId(): string | undefined;
}

export interface ThemeManagerLike {
    initializeTailwindColorContent(): Promise<ColorUpdate | null>;
}

export interface EditorEngineLike {
    api: ApiManagerLike;
    branches: BranchManagerLike;
    chat: ChatManagerLike;
    projectId: string;
    theme: ThemeManagerLike;
}
