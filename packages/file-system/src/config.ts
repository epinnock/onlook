import ZenFS, { configureSingle, InMemory } from '@zenfs/core';
import { IndexedDB } from '@zenfs/dom';

let configPromise: Promise<void> | null = null;

export async function getFS(): Promise<typeof ZenFS> {
    const shouldUseIndexedDB =
        typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';

    // Use a single promise to ensure configuration only happens once
    configPromise ??= configureSingle(
        shouldUseIndexedDB
            ? {
                  backend: IndexedDB,
                  storeName: 'browser-fs',
              }
            : {
                  backend: InMemory,
              },
    ).catch((err) => {
        // Reset on error so it can be retried
        configPromise = null;
        throw err;
    });

    await configPromise;
    return ZenFS;
}
