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

export const RectSchema = z.object({
    x: z.number(),
    y: z.number(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
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
