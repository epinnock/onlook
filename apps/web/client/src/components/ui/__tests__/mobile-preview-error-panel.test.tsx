import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { MobilePreviewErrorPanelModel } from '@/services/mobile-preview/error-store';
import { MobilePreviewErrorPanel } from '../mobile-preview-error-panel';

function render(panel: MobilePreviewErrorPanelModel): string {
    return renderToStaticMarkup(<MobilePreviewErrorPanel panel={panel} />);
}

describe('MobilePreviewErrorPanel', () => {
    test('returns empty markup when the panel is hidden', () => {
        expect(render({ isVisible: false, items: [] })).toBe('');
    });

    test('renders error items and repeated occurrence counts', () => {
        const html = render({
            isVisible: true,
            items: [
                {
                    id: 'push',
                    kind: 'push',
                    title: 'Sync error',
                    message: 'mobile-preview /push returned 503',
                    occurredAt: 10,
                    occurrences: 3,
                },
            ],
        });

        expect(html).toContain('data-testid="mobile-preview-error-panel"');
        expect(html).toContain('Preview errors');
        expect(html).toContain('Sync error');
        expect(html).toContain('mobile-preview /push returned 503');
        expect(html).toContain(
            'data-testid="mobile-preview-error-occurrences-push"',
        );
        expect(html).toContain('3x');
    });

    test('turns file references in the message into IDE links', () => {
        const html = render({
            isVisible: true,
            items: [
                {
                    id: 'runtime',
                    kind: 'runtime',
                    title: 'Runtime error',
                    message:
                        'Unexpected token in src/app/home.tsx:42:7 while evaluating App.',
                    occurredAt: 20,
                    occurrences: 1,
                },
            ],
        });

        expect(html).toContain(
            'data-testid="mobile-preview-error-link-runtime-1"',
        );
        expect(html).toContain('>src/app/home.tsx:42:7</a>');
        expect(html).toContain('href="onlook://file/src/app/home.tsx:42"');
        expect(html).toContain('Unexpected token in ');
        expect(html).toContain(' while evaluating App.');
    });
});
