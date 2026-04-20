import { describe, expect, test } from 'bun:test';

import { findVirtualProjectRoot } from '../src/project-root';

describe('project root detector', () => {
    test('detects the root package.json at the project root', () => {
        const root = findVirtualProjectRoot('src/App.tsx', {
            'package.json': '{}',
            'src/App.tsx': 'export default null;',
        });

        expect(root).toBe('');
    });

    test('prefers the nearest package.json for nested entries', () => {
        const root = findVirtualProjectRoot('apps/mobile/src/screens/Home.tsx', {
            'package.json': '{}',
            'apps/mobile/package.json': '{}',
            'apps/mobile/src/screens/Home.tsx': 'export default null;',
        });

        expect(root).toBe('apps/mobile');
    });

    test('falls back to app.json when package.json is missing', () => {
        const root = findVirtualProjectRoot('src/App.tsx', {
            'app.json': '{"name":"demo"}',
            'src/App.tsx': 'export default null;',
        });

        expect(root).toBe('');
    });

    test('throws when no project manifest exists', () => {
        expect(() =>
            findVirtualProjectRoot('src/App.tsx', {
                'src/App.tsx': 'export default null;',
            }),
        ).toThrow('Unable to determine project root for "src/App.tsx"');
    });
});
