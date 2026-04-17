'use client';

/**
 * QrModal (TQ3.1).
 *
 * Dumb presentational dialog that renders the current state of the
 * "Preview on device" flow. Status transitions are driven by the
 * `usePreviewOnDevice` hook (TQ3.2); this component only renders and
 * forwards user intents (close, retry, copy url).
 */

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@onlook/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@onlook/ui/tabs';

// NOTE: `QrModalBody` intentionally uses plain <button> elements rather
// than `@onlook/ui/button`. The `@onlook/ui` package pins React 18 in its
// devDependencies while the editor runs React 19 — reaching for Button
// here would cause cross-version React context conflicts in SSR tests.
// The wrapper `QrModal` still uses `@onlook/ui/dialog` which does not
// exhibit this issue because it is only rendered client-side.
const BUTTON_CLS =
    'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border bg-background px-3 h-8 text-sm font-medium shadow-xs transition-all hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 dark:bg-input/30 dark:border-input dark:hover:bg-input/50';

export type QrModalStatus =
    | { kind: 'idle' }
    | { kind: 'preparing' }
    | { kind: 'building' }
    | { kind: 'ready'; manifestUrl: string; onlookUrl: string; qrSvg: string }
    | { kind: 'error'; message: string };

export type SimulatorTabStatus =
    | { kind: 'idle' }
    | { kind: 'building' }
    | { kind: 'launching' }
    | { kind: 'ready'; sessionId: string }
    | { kind: 'error'; message: string };

export interface SimulatorTabProps {
    status: SimulatorTabStatus;
    onLaunch: () => void;
    onRetry?: () => void;
    /**
     * True when Spectra responds healthy. When false, the UI disables
     * the Launch button and shows an inline explanation.
     */
    healthy: boolean;
}

export interface QrModalProps {
    open: boolean;
    onClose: () => void;
    status: QrModalStatus;
    /** Called when the user clicks "Retry" after an error. */
    onRetry?: () => void;
    /**
     * Optional — supply to render the "In browser" tab. Omitted when the
     * Spectra feature flag is off; falsy values collapse the tab list and
     * the modal renders exactly like the pre-tabs version.
     */
    simulator?: SimulatorTabProps;
}

export interface QrModalBodyProps {
    status: QrModalStatus;
    onRetry?: () => void;
    /** Override the copy handler (tests can inject a stub in environments without navigator.clipboard). */
    onCopy?: (manifestUrl: string) => void;
}

/**
 * Portal-free body of the QR modal. Exported separately so it can be
 * unit-tested without dragging in Radix's portal/ref machinery (which
 * requires a real DOM).
 */
export function QrModalBody({ status, onRetry, onCopy }: QrModalBodyProps) {
    return (
        <div data-testid="qr-modal-body" className="flex flex-col gap-4">
            {status.kind === 'idle' && (
                <p
                    data-testid="qr-status-idle"
                    className="text-sm text-foreground-secondary"
                >
                    Click &ldquo;Preview on device&rdquo; in the toolbar to start.
                </p>
            )}
            {status.kind === 'preparing' && (
                <p
                    data-testid="qr-status-preparing"
                    className="text-sm text-foreground-secondary"
                >
                    Preparing project source&hellip;
                </p>
            )}
            {status.kind === 'building' && (
                <p
                    data-testid="qr-status-building"
                    className="text-sm text-foreground-secondary"
                >
                    Bundling for Expo Go (this can take a moment)&hellip;
                </p>
            )}
            {status.kind === 'ready' && (
                <div className="flex flex-col items-center gap-3">
                    <div
                        data-testid="qr-svg-wrapper"
                        className="rounded-md bg-white p-3"
                        dangerouslySetInnerHTML={{ __html: status.qrSvg }}
                    />
                    <p className="text-center text-sm text-foreground-secondary">
                        Scan with the Onlook Mobile app, or open one of these URLs:
                    </p>
                    <code
                        data-testid="qr-onlook-url"
                        className="w-full break-all rounded-md bg-background-secondary px-3 py-2 text-xs"
                    >
                        {status.onlookUrl}
                    </code>
                    <button
                        type="button"
                        data-testid="qr-copy-btn"
                        className={BUTTON_CLS}
                        onClick={() => {
                            if (onCopy) {
                                onCopy(status.onlookUrl);
                                return;
                            }
                            if (
                                typeof navigator !== 'undefined' &&
                                navigator.clipboard
                            ) {
                                void navigator.clipboard.writeText(
                                    status.onlookUrl,
                                );
                            }
                        }}
                    >
                        Copy Onlook URL
                    </button>
                    <details className="w-full">
                        <summary className="cursor-pointer text-xs text-foreground-secondary">
                            Expo Go fallback URL
                        </summary>
                        <code
                            data-testid="qr-manifest-url"
                            className="mt-1 block w-full break-all rounded-md bg-background-secondary px-3 py-2 text-xs"
                        >
                            {status.manifestUrl}
                        </code>
                    </details>
                </div>
            )}
            {status.kind === 'error' && (
                <div className="flex flex-col gap-3">
                    <p
                        data-testid="qr-status-error"
                        className="text-sm text-red-300"
                    >
                        Error: {status.message}
                    </p>
                    {onRetry && (
                        <button
                            type="button"
                            data-testid="qr-retry-btn"
                            className={BUTTON_CLS}
                            onClick={onRetry}
                        >
                            Retry
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

export function QrModal({ open, onClose, status, onRetry, simulator }: QrModalProps) {
    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
        >
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Preview</DialogTitle>
                    <DialogDescription>
                        {simulator
                            ? 'Scan with the Onlook Mobile app, or run it on an inline simulator.'
                            : 'Scan the QR code with the Onlook Mobile app to open this project on your phone.'}
                    </DialogDescription>
                </DialogHeader>
                {simulator ? (
                    <Tabs defaultValue="device" className="w-full">
                        <TabsList className="w-full" data-testid="qr-modal-tabs">
                            <TabsTrigger value="device" data-testid="qr-tab-device">
                                On device
                            </TabsTrigger>
                            <TabsTrigger value="browser" data-testid="qr-tab-browser">
                                In browser
                            </TabsTrigger>
                        </TabsList>
                        <TabsContent value="device">
                            <QrModalBody status={status} onRetry={onRetry} />
                        </TabsContent>
                        <TabsContent value="browser">
                            <SimulatorTabBody {...simulator} />
                        </TabsContent>
                    </Tabs>
                ) : (
                    <QrModalBody status={status} onRetry={onRetry} />
                )}
            </DialogContent>
        </Dialog>
    );
}

export function SimulatorTabBody({ status, onLaunch, onRetry, healthy }: SimulatorTabProps) {
    return (
        <div data-testid="sim-tab-body" className="flex flex-col gap-3">
            {!healthy && (
                <p
                    data-testid="sim-status-unhealthy"
                    className="text-sm text-foreground-secondary"
                >
                    Simulator unavailable. Check that Spectra is running and reachable from the Onlook server.
                </p>
            )}
            {status.kind === 'idle' && healthy && (
                <div className="flex flex-col gap-2">
                    <p className="text-sm text-foreground-secondary">
                        Runs your build on an inline iOS simulator. You can still use the QR tab to preview on a physical device.
                    </p>
                    <button
                        type="button"
                        data-testid="sim-launch-btn"
                        className={BUTTON_CLS}
                        onClick={onLaunch}
                    >
                        Launch simulator
                    </button>
                </div>
            )}
            {status.kind === 'building' && (
                <p data-testid="sim-status-building" className="text-sm text-foreground-secondary">
                    Bundling your project&hellip;
                </p>
            )}
            {status.kind === 'launching' && (
                <p data-testid="sim-status-launching" className="text-sm text-foreground-secondary">
                    Starting simulator&hellip; this can take up to a minute the first time.
                </p>
            )}
            {status.kind === 'ready' && (
                <p data-testid="sim-status-ready" className="text-sm text-foreground-secondary">
                    Simulator live on the canvas. Close the modal to keep it open, or tear it down here.
                </p>
            )}
            {status.kind === 'error' && (
                <div className="flex flex-col gap-3">
                    <p data-testid="sim-status-error" className="text-sm text-red-300">
                        Error: {status.message}
                    </p>
                    {onRetry && (
                        <button
                            type="button"
                            data-testid="sim-retry-btn"
                            className={BUTTON_CLS}
                            onClick={onRetry}
                        >
                            Retry
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
