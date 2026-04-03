/**
 * Integration tests for provider switching / abstraction.
 *
 * Validates that getSandboxPreviewUrl produces correct, distinct URLs
 * for each provider type and handles edge cases appropriately.
 *
 * Run with: bun test apps/web/client/e2e/flows/provider-switching.spec.ts
 */
import { describe, expect, it } from 'bun:test';
import {
    SANDBOX_TEMPLATES,
    PROVIDER_DOMAINS,
    getSandboxPreviewUrl,
    type SandboxProvider,
} from '../../../../../packages/constants/src/sandbox';

// ---------------------------------------------------------------------------
// Cross-provider URL generation
// ---------------------------------------------------------------------------

describe('Provider Switching - URL Generation', () => {
    it('same sandbox ID produces different URLs per provider', () => {
        const id = 'sandbox-001';
        const port = 3000;
        const cfUrl = getSandboxPreviewUrl('cloudflare', id, port);
        const csbUrl = getSandboxPreviewUrl('code_sandbox', id, port);
        const localUrl = getSandboxPreviewUrl('node_fs', id, port);

        expect(cfUrl).toContain('containers.dev');
        expect(csbUrl).toContain('csb.app');
        expect(localUrl).toContain('localhost');

        // All three must be different
        expect(cfUrl).not.toBe(csbUrl);
        expect(cfUrl).not.toBe(localUrl);
        expect(csbUrl).not.toBe(localUrl);
    });

    it('cloudflare URL uses HTTPS', () => {
        const url = getSandboxPreviewUrl('cloudflare', 'test', 3000);
        expect(url).toMatch(/^https:\/\//);
    });

    it('code_sandbox URL uses HTTPS', () => {
        const url = getSandboxPreviewUrl('code_sandbox', 'test', 3000);
        expect(url).toMatch(/^https:\/\//);
    });

    it('node_fs URL uses HTTP (localhost)', () => {
        const url = getSandboxPreviewUrl('node_fs', 'test', 3000);
        expect(url).toMatch(/^http:\/\//);
        expect(url).toBe('http://localhost:3000');
    });

    it('node_fs ignores sandbox ID entirely', () => {
        const url1 = getSandboxPreviewUrl('node_fs', 'sandbox-a', 4000);
        const url2 = getSandboxPreviewUrl('node_fs', 'sandbox-b', 4000);
        expect(url1).toBe(url2);
        expect(url1).toBe('http://localhost:4000');
    });

    it('unknown provider throws', () => {
        expect(() => getSandboxPreviewUrl('unknown' as any, 'id', 3000)).toThrow(
            'Unknown provider: unknown',
        );
    });
});

// ---------------------------------------------------------------------------
// Provider domain constants
// ---------------------------------------------------------------------------

describe('Provider Switching - Domain Constants', () => {
    it('cloudflare domain is containers.dev', () => {
        expect(PROVIDER_DOMAINS.cloudflare).toBe('containers.dev');
    });

    it('code_sandbox domain is csb.app', () => {
        expect(PROVIDER_DOMAINS.code_sandbox).toBe('csb.app');
    });

    it('domains are distinct', () => {
        expect(PROVIDER_DOMAINS.cloudflare).not.toBe(PROVIDER_DOMAINS.code_sandbox);
    });
});

// ---------------------------------------------------------------------------
// Template portability across providers
// ---------------------------------------------------------------------------

describe('Provider Switching - Template Portability', () => {
    it('expo template works with both CF and CSB providers', () => {
        const template = SANDBOX_TEMPLATES.expo;
        const port = template.defaultPort;

        const cfUrl = getSandboxPreviewUrl('cloudflare', 'expo-cf', port);
        const csbUrl = getSandboxPreviewUrl('code_sandbox', 'expo-csb', port);

        expect(cfUrl).toContain(String(port));
        expect(csbUrl).toContain(String(port));
        expect(cfUrl).toContain('containers.dev');
        expect(csbUrl).toContain('csb.app');
    });

    it('nextjs template works with both CF and CSB providers', () => {
        const template = SANDBOX_TEMPLATES.nextjs;
        const port = template.defaultPort;

        const cfUrl = getSandboxPreviewUrl('cloudflare', 'nextjs-cf', port);
        const csbUrl = getSandboxPreviewUrl('code_sandbox', 'nextjs-csb', port);

        expect(cfUrl).toContain(String(port));
        expect(csbUrl).toContain(String(port));
        expect(cfUrl).toContain('containers.dev');
        expect(csbUrl).toContain('csb.app');
    });

    it('each template has both CF image and CSB template ID', () => {
        for (const [key, template] of Object.entries(SANDBOX_TEMPLATES)) {
            expect(template.cfImage).toBeTruthy();
            expect(template.csbTemplateId).toBeTruthy();
            expect(typeof template.cfImage).toBe('string');
            expect(typeof template.csbTemplateId).toBe('string');
        }
    });
});

// ---------------------------------------------------------------------------
// Port handling across providers
// ---------------------------------------------------------------------------

describe('Provider Switching - Port Handling', () => {
    const providers: SandboxProvider[] = ['cloudflare', 'code_sandbox', 'node_fs'];

    it('different ports yield different URLs for cloud providers', () => {
        for (const provider of ['cloudflare', 'code_sandbox'] as const) {
            const url3000 = getSandboxPreviewUrl(provider, 'test', 3000);
            const url8080 = getSandboxPreviewUrl(provider, 'test', 8080);
            expect(url3000).not.toBe(url8080);
        }
    });

    it('different ports yield different URLs for node_fs', () => {
        const url3000 = getSandboxPreviewUrl('node_fs', 'x', 3000);
        const url8080 = getSandboxPreviewUrl('node_fs', 'x', 8080);
        expect(url3000).not.toBe(url8080);
    });

    it('all providers include port in URL', () => {
        const port = 5173;
        for (const provider of providers) {
            const url = getSandboxPreviewUrl(provider, 'sandbox', port);
            expect(url).toContain(String(port));
        }
    });
});
