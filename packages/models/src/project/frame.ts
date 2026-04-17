import { Orientation, Theme } from '@onlook/constants';
import type { RectDimension, RectPosition } from './rect';

/**
 * What's being rendered inside this frame.
 *   - `web` (default): an iframe at `url`, edited via Penpal RPC. DB-backed.
 *   - `simulator`: a live MJPEG stream from a Spectra-managed iOS sim,
 *      with `simulatorSessionId` identifying the provisioned device.
 *      Ephemeral — in-memory only, not persisted. See the Spectra preview
 *      ADR at `plans/adr/spectra-inline-simulator.md`.
 * Undefined is treated as `web` everywhere so existing data keeps working.
 */
export type FrameKind = 'web' | 'simulator';

export interface Frame {
    // IDs
    id: string;
    branchId: string;
    canvasId: string;

    // display data
    position: RectPosition;
    dimension: RectDimension;

    // content
    url: string;

    /** Defaults to `'web'` when absent. */
    kind?: FrameKind;
    /** Spectra device/session id when `kind === 'simulator'`. */
    simulatorSessionId?: string;
}

export interface WindowMetadata {
    orientation: Orientation;
    aspectRatioLocked: boolean;
    device: string;
    theme: Theme;
    width: number;
    height: number;
}
