import { z } from 'zod';

const BaseActionLocationSchema = z.object({
    type: z.enum(['prepend', 'append']),
    targetDomId: z.string(),
    targetOid: z.string().nullable(),
});

export const IndexActionLocationSchema = BaseActionLocationSchema.extend({
    type: z.literal('index'),
    // Array indices — must be non-negative integers. `.int()` rejects
    // NaN, ±Infinity, and any fractional value that would mean "halfway
    // between children" (which has no meaning for DOM mutation).
    index: z.number().int().nonnegative(),
    originalIndex: z.number().int().nonnegative(),
});

export const ActionLocationSchema = z.discriminatedUnion('type', [
    IndexActionLocationSchema,
    BaseActionLocationSchema,
]);

export type ActionLocation = z.infer<typeof ActionLocationSchema>;
export type IndexActionLocation = z.infer<typeof IndexActionLocationSchema>;
