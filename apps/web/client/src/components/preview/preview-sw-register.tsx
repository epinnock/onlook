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
const SW_ACTIVATION_TIMEOUT_MS = 10_000;

let previewServiceWorkerReadyPromise: Promise<ServiceWorkerRegistration | null> | null =
    null;

function waitForPreviewServiceWorkerActivation(
    registration: ServiceWorkerRegistration,
): Promise<ServiceWorkerRegistration> {
    if (registration.active) {
        return Promise.resolve(registration);
    }

    const worker = registration.installing ?? registration.waiting;
    if (!worker) {
        return Promise.resolve(registration);
    }

    return new Promise((resolve) => {
        const timeoutId = window.setTimeout(() => {
            cleanup();
            resolve(registration);
        }, SW_ACTIVATION_TIMEOUT_MS);

        const handleStateChange = () => {
            if (registration.active) {
                cleanup();
                resolve(registration);
            }
        };

        const handleUpdateFound = () => {
            registration.installing?.addEventListener('statechange', handleStateChange);
            handleStateChange();
        };

        const cleanup = () => {
            window.clearTimeout(timeoutId);
            worker.removeEventListener('statechange', handleStateChange);
            registration.removeEventListener('updatefound', handleUpdateFound);
        };

        worker.addEventListener('statechange', handleStateChange);
        registration.addEventListener('updatefound', handleUpdateFound);
        handleStateChange();
    });
}

export async function ensurePreviewServiceWorkerReady(): Promise<ServiceWorkerRegistration | null> {
    if (typeof window === 'undefined') {
        return null;
    }

    if (!('serviceWorker' in navigator)) {
        console.warn('[preview-sw-register] serviceWorker API unavailable');
        return null;
    }

    if (!previewServiceWorkerReadyPromise) {
        previewServiceWorkerReadyPromise = navigator.serviceWorker
            .getRegistration(SW_SCOPE)
            .then((registration) => {
                if (registration) {
                    return registration;
                }

                return navigator.serviceWorker.register(SW_PATH, { scope: SW_SCOPE });
            })
            .then(async (registration) => {
                const activeRegistration =
                    await waitForPreviewServiceWorkerActivation(registration);

                console.info(
                    '[preview-sw-register] registered',
                    activeRegistration.scope,
                );

                return activeRegistration;
            })
            .catch((err: unknown) => {
                console.error('[preview-sw-register] registration failed', err);
                previewServiceWorkerReadyPromise = null;
                return null;
            });
    }

    return previewServiceWorkerReadyPromise;
}

export function PreviewServiceWorkerRegister(): null {
    useEffect(() => {
        let cancelled = false;
        void ensurePreviewServiceWorkerReady().then(() => {
            if (cancelled) return;
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
