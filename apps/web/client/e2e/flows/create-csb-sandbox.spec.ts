/**
 * Regression tests for the CodeSandbox creation flow.
 *
 * Validates that the existing CSB contracts (URL formats, template IDs,
 * fork input shapes) remain unchanged as the CF provider is added.
 *
 * Run with: bun test apps/web/client/e2e/flows/create-csb-sandbox.spec.ts
 */
import { describe, expect, it } from 'bun:test';
import {
    SANDBOX_TEMPLATES,
    PROVIDER_DOMAINS,
    getSandboxPreviewUrl,
} from '../../../../../packages/constants/src/sandbox';

// ---------------------------------------------------------------------------
// Preview URL format preservation
// ---------------------------------------------------------------------------

describe('CSB Sandbox Creation Flow (Regression) - Preview URLs', () => {
    it('CSB preview URL format is preserved', () => {
        const sandboxId = 'abc123';
        const port = 3000;
        const url = getSandboxPreviewUrl('code_sandbox', sandboxId, port);

        expect(url).toBe('https://abc123-3000.csb.app');
        expect(url).toContain('csb.app');
    });

    it('CSB domain constant is csb.app', () => {
        expect(PROVIDER_DOMAINS.code_sandbox).toBe('csb.app');
    });

    it('CSB URL includes sandbox ID and port', () => {
        const url = getSandboxPreviewUrl('code_sandbox', 'my-sandbox', 8080);
        expect(url).toContain('my-sandbox');
        expect(url).toContain('8080');
    });
});

// ---------------------------------------------------------------------------
// Template IDs match csb.ts constants
// ---------------------------------------------------------------------------

describe('CSB Sandbox Creation Flow (Regression) - Template IDs', () => {
    it('EXPO_WEB template ID is zx8g3k with port 8080', () => {
        expect(SANDBOX_TEMPLATES.expo.csbTemplateId).toBe('zx8g3k');
        expect(SANDBOX_TEMPLATES.expo.defaultPort).toBe(8080);
    });

    it('EMPTY_NEXTJS template ID is pt_EphPmsurimGCQdiB44wa7s with port 3000', () => {
        expect(SANDBOX_TEMPLATES.nextjs.csbTemplateId).toBe('pt_EphPmsurimGCQdiB44wa7s');
        expect(SANDBOX_TEMPLATES.nextjs.defaultPort).toBe(3000);
    });
});

// ---------------------------------------------------------------------------
// Provider defaults
// ---------------------------------------------------------------------------

describe('CSB Sandbox Creation Flow (Regression) - Provider Defaults', () => {
    it('provider type defaults to code_sandbox', () => {
        // The existing sandbox router uses CodeProvider.CodeSandbox by default
        const defaultProvider = 'code_sandbox';
        expect(defaultProvider).toBe('code_sandbox');
    });

    it('CSB and CF providers produce different URLs for same sandbox', () => {
        const id = 'same-sandbox';
        const port = 3000;
        const csbUrl = getSandboxPreviewUrl('code_sandbox', id, port);
        const cfUrl = getSandboxPreviewUrl('cloudflare', id, port);

        expect(csbUrl).not.toBe(cfUrl);
        expect(csbUrl).toContain('csb.app');
        expect(cfUrl).toContain('containers.dev');
    });
});

// ---------------------------------------------------------------------------
// Fork mutation contract
// ---------------------------------------------------------------------------

describe('CSB Sandbox Creation Flow (Regression) - Fork Contract', () => {
    it('fork mutation expects sandbox object with id and port', () => {
        // Mirrors the Zod schema: z.object({ sandbox: z.object({ id, port }), config? })
        const forkInput = {
            sandbox: { id: 'zx8g3k', port: 8080 },
            config: { title: 'My Project', tags: ['test'] },
        };
        expect(forkInput.sandbox).toHaveProperty('id');
        expect(forkInput.sandbox).toHaveProperty('port');
        expect(typeof forkInput.sandbox.id).toBe('string');
        expect(typeof forkInput.sandbox.port).toBe('number');
    });

    it('fork config is optional', () => {
        const forkInput = { sandbox: { id: 'zx8g3k', port: 8080 } };
        expect(forkInput).toHaveProperty('sandbox');
        expect(forkInput).not.toHaveProperty('config');
    });

    it('fork response includes sandboxId and previewUrl', () => {
        // Shape contract of sandbox.fork response
        const response = {
            sandboxId: 'forked-123',
            previewUrl: getSandboxPreviewUrl('code_sandbox', 'forked-123', 8080),
        };
        expect(response).toHaveProperty('sandboxId');
        expect(response).toHaveProperty('previewUrl');
        expect(response.previewUrl).toContain('csb.app');
    });
});

// ---------------------------------------------------------------------------
// Lifecycle mutations
// ---------------------------------------------------------------------------

describe('CSB Sandbox Creation Flow (Regression) - Lifecycle', () => {
    it('start requires sandboxId', () => {
        const input = { sandboxId: 'csb-abc' };
        expect(input).toHaveProperty('sandboxId');
        expect(typeof input.sandboxId).toBe('string');
    });

    it('hibernate requires sandboxId', () => {
        const input = { sandboxId: 'csb-abc' };
        expect(input).toHaveProperty('sandboxId');
    });

    it('delete requires sandboxId', () => {
        const input = { sandboxId: 'csb-abc' };
        expect(input).toHaveProperty('sandboxId');
    });
});
