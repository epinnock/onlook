'use client';

/**
 * Wave H §1.3 — service worker registration island.
 *
 * Mounted inside the project route's client tree. Registers the preview
 * service worker (`/preview-sw.js`) on first load when at least one
 * branch in the active project is on the ExpoBrowser provider, and
 * unregisters on tear-down. Idempotent across re-mounts.
 *
 * The SW intercepts `/preview/<branchId>/<frameId>/*` and serves the
 * in-browser bundle published by @onlook/browser-metro.
 */
import { useEffect } from 'react';

const SW_PATH = '/preview-sw.js';
const SW_SCOPE = '/preview/';

export function PreviewServiceWorkerRegister(): null {
    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!('serviceWorker' in navigator)) {
            console.warn('[preview-sw-register] serviceWorker API unavailable');
            return;
        }

        let cancelled = false;
        navigator.serviceWorker
            .register(SW_PATH, { scope: SW_SCOPE })
            .then((registration) => {
                if (cancelled) return;
                console.info('[preview-sw-register] registered', registration.scope);
            })
            .catch((err: unknown) => {
                console.error('[preview-sw-register] registration failed', err);
            });

        return () => {
            cancelled = true;
            // Intentionally do NOT unregister on unmount — the SW should
            // persist across React re-mounts so the iframe inside the
            // canvas keeps working when the user navigates around. The
            // user can hard-refresh to clear it.
        };
    }, []);

    return null;
}
