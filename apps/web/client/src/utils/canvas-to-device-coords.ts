/**
 * Translate a pointer event on a rendered MJPEG `<img>` element into the
 * normalized `[0..1]` device-coordinate space Spectra expects for taps +
 * swipes.
 *
 * The `<img>` uses `object-contain` so the displayed image is letterboxed
 * when the container's aspect ratio differs from the stream's native aspect
 * ratio. We back that out here — `offsetX/offsetY` from the pointer event is
 * relative to the container, so we have to subtract the letterbox padding
 * and divide by the *actually-rendered* image area, not the container's
 * `clientWidth/Height`.
 *
 * This is pure and test-only — the DOM parts live in the `SimulatorView`
 * component.
 */
export interface ContainerRect {
    width: number;
    height: number;
}

export interface IntrinsicSize {
    width: number;
    height: number;
}

export interface PointerInContainer {
    /** Pointer offset from the container's top-left, in CSS pixels. */
    offsetX: number;
    offsetY: number;
}

export interface NormalizedPoint {
    /** `[0..1]`, clamped. */
    x: number;
    y: number;
    /** `true` when the pointer landed in letterbox space rather than on the image. */
    outside: boolean;
}

/**
 * Converts a pointer offset on a container rendering a `object-contain`
 * image to normalized device coordinates in `[0..1]`. Returns `outside: true`
 * when the point is in the letterbox — callers should ignore those taps.
 */
export function pointerToDeviceCoords(
    pointer: PointerInContainer,
    container: ContainerRect,
    intrinsic: IntrinsicSize,
): NormalizedPoint {
    if (
        container.width <= 0 ||
        container.height <= 0 ||
        intrinsic.width <= 0 ||
        intrinsic.height <= 0
    ) {
        return { x: 0, y: 0, outside: true };
    }

    const scale = Math.min(
        container.width / intrinsic.width,
        container.height / intrinsic.height,
    );
    const renderedWidth = intrinsic.width * scale;
    const renderedHeight = intrinsic.height * scale;
    const paddingX = (container.width - renderedWidth) / 2;
    const paddingY = (container.height - renderedHeight) / 2;

    const relX = pointer.offsetX - paddingX;
    const relY = pointer.offsetY - paddingY;

    const outside =
        relX < 0 || relY < 0 || relX > renderedWidth || relY > renderedHeight;

    const x = clamp01(relX / renderedWidth);
    const y = clamp01(relY / renderedHeight);
    return { x, y, outside };
}

function clamp01(n: number): number {
    if (!Number.isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
}
