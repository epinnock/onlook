/**
 * Overlay protocol message schema — the editor-facing wire shape for relaying
 * overlay code and optional source map data to consumers.
 *
 * Built for QC-06.
 */
import { z } from 'zod';

export const OverlaySourceMapSchema = z.union([z.string(), z.record(z.string(), z.unknown())]);
export type OverlaySourceMap = z.infer<typeof OverlaySourceMapSchema>;

export const OverlayMessageSchema = z.object({
    type: z.literal('overlay'),
    code: z.string().min(1),
    sourceMap: OverlaySourceMapSchema.optional(),
});
export type OverlayMessage = z.infer<typeof OverlayMessageSchema>;

export function isOverlayMessage(value: unknown): value is OverlayMessage {
    return OverlayMessageSchema.safeParse(value).success;
}
