import ZenFS, { configureSingle, InMemory } from '@zenfs/core';
import { IndexedDB } from '@zenfs/dom';

let configPromise: Promise<void> | null = null;

export async function getFS(): Promise<typeof ZenFS> {
    const shouldUseIndexedDB =
        typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';

    // Use a single promise to ensure configuration only happens once.
    // `configureSingle<T>` is generic over a single backend, so a union
    // config isn't assignable — branch the call instead.
    if (!configPromise) {
        const configure = shouldUseIndexedDB
            ? configureSingle({ backend: IndexedDB, storeName: 'browser-fs' })
            : configureSingle({ backend: InMemory });
        configPromise = configure.catch((err) => {
            // Reset on error so it can be retried
            configPromise = null;
            throw err;
        });
    }

    await configPromise;
    return ZenFS;
}
