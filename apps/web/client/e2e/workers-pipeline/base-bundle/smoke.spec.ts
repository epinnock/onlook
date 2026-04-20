import { expect, test } from '@playwright/test';

import {
    getWorkersPipelineFixture,
    listWorkersPipelineFixtureFiles,
    readWorkersPipelineFixtureFile,
} from '../helpers/fixture-projects';
import {
    createBaseBundleHarness,
    createOverlaySource,
} from '../helpers/base-bundle-harness';

test.describe('workers-pipeline Wave 0 smoke', () => {
    test('canonical fixture projects are available to E2E helpers', () => {
        const hello = getWorkersPipelineFixture('hello');
        const tabs = getWorkersPipelineFixture('tabs-template');

        expect(listWorkersPipelineFixtureFiles(hello)).toContain('App.tsx');
        expect(listWorkersPipelineFixtureFiles(tabs)).toContain('src/navigation/Tabs.tsx');
        expect(readWorkersPipelineFixtureFile(hello, 'App.tsx')).toContain('Hello, Onlook');
        expect(readWorkersPipelineFixtureFile(tabs, 'src/navigation/Tabs.tsx')).toContain(
            'Pressable',
        );
    });

    test('base-bundle harness resolves curated aliases and mounts overlay source', () => {
        const reactModule = { name: 'react-fixture' };
        const harness = createBaseBundleHarness({ react: reactModule });

        expect(harness.aliases.react).toBe(1);
        expect(harness.requireBaseModule('react')).toBe(reactModule);

        const result = harness.mountOverlay(createOverlaySource('react'));

        expect(result).toEqual({ imported: reactModule });
        expect(harness.mountedOverlays).toHaveLength(1);
    });
});

