/**
 * Inspector descriptor types — the shape of `OnlookInspector.captureTap()`,
 * `OnlookInspector.walkTree()`, and the tap-to-source pipeline payload.
 *
 * `ReactNodeDescriptor` is recursive (Fabric tree walk), so the Zod schema uses
 * `z.lazy` with a forward-declared TS interface.
 *
 * Built by MCF6 of plans/onlook-mobile-client-task-queue.md.
 */
import { z } from 'zod';

// `.finite()` rejects NaN + ±Infinity from a misbehaving phone. Overlay
// rect math on the editor side (e.g. `OverlayHost` hit-testing against
// the selection) assumes finite values — an `Infinity` width would
// explode any bounding-box computation it feeds into.
export const RectSchema = z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative(),
});
export type Rect = z.infer<typeof RectSchema>;

export const TapResultSchema = z.object({
    reactTag: z.number().int(),
    viewName: z.string().min(1),
    frame: RectSchema,
});
export type TapResult = z.infer<typeof TapResultSchema>;

/**
 * Forward-declared interface for the recursive Fabric tree node. Zod's `z.lazy`
 * doesn't synthesise recursive TS types, so we declare the interface manually
 * and annotate the schema with `z.ZodType<ReactNodeDescriptor>`.
 */
export interface ReactNodeDescriptor {
    tag: number;
    viewName: string;
    props: Record<string, unknown>;
    children: ReactNodeDescriptor[];
}

export const ReactNodeDescriptorSchema: z.ZodType<ReactNodeDescriptor> = z.lazy(() =>
    z.object({
        tag: z.number().int(),
        viewName: z.string().min(1),
        props: z.record(z.string(), z.unknown()),
        children: z.array(ReactNodeDescriptorSchema),
    }),
);
