import { describe, expect, it } from 'bun:test';
import {
    PROVIDER_DOMAINS,
    SANDBOX_TEMPLATES,
    getSandboxPreviewUrl,
} from '../sandbox';

describe('SANDBOX_TEMPLATES', () => {
    it('expo template has all required fields', () => {
        const expo = SANDBOX_TEMPLATES.expo;
        expect(expo.name).toBe('Expo / React Native');
        expect(expo.cfImage).toBe('scry-expo:latest');
        expect(expo.csbTemplateId).toBe('zx8g3k');
        expect(expo.defaultPort).toBe(8080);
    });

    it('nextjs template has all required fields', () => {
        const nextjs = SANDBOX_TEMPLATES.nextjs;
        expect(nextjs.name).toBe('Next.js');
        expect(nextjs.cfImage).toBe('scry-nextjs:latest');
        expect(nextjs.csbTemplateId).toBe('pt_EphPmsurimGCQdiB44wa7s');
        expect(nextjs.defaultPort).toBe(3000);
    });
});

describe('getSandboxPreviewUrl', () => {
    it('returns correct URL for cloudflare provider', () => {
        const url = getSandboxPreviewUrl('cloudflare', 'abc123', 8080);
        expect(url).toBe(`https://abc123-8080.${PROVIDER_DOMAINS.cloudflare}`);
    });

    it('returns correct URL for code_sandbox provider', () => {
        const url = getSandboxPreviewUrl('code_sandbox', 'xyz789', 3000);
        expect(url).toBe(`https://xyz789-3000.${PROVIDER_DOMAINS.code_sandbox}`);
    });

    it('returns correct URL for node_fs provider', () => {
        const url = getSandboxPreviewUrl('node_fs', 'ignored', 4000);
        expect(url).toBe('http://localhost:4000');
    });

    it('throws for unknown provider', () => {
        expect(() =>
            getSandboxPreviewUrl('unknown' as any, 'id', 3000),
        ).toThrow('Unknown provider: unknown');
    });
});
