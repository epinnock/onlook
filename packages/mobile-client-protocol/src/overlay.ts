/**
 * Overlay protocol message schema — the editor-facing wire shape for relaying
 * overlay code and optional source map data to consumers.
 *
 * Built for QC-06.
 *
 * @deprecated for new work. ABI v1 (see `./abi-v1.ts`) defines
 * `OverlayUpdateMessage` as the preferred wire shape. This module is retained
 * so legacy callers still compile during the migration wave (two-tier-overlay-v2
 * task #89). New code should `import { OverlayUpdateMessage } from './abi-v1'`.
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

// ─── ABI v1 migration bridge (task #47) ──────────────────────────────────────
// Re-export the v1 types so editor code that still imports from this legacy
// module compiles during migration without a big rename sweep. The canonical
// home for v1 is `./abi-v1.ts`; this bridge will be removed with task #89.
export type { OverlayUpdateMessage } from './abi-v1';
export { OverlayUpdateMessageSchema } from './abi-v1';
