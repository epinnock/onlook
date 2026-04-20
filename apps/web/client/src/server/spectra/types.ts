import { z } from 'zod';

/**
 * Narrow Zod mirrors of the subset of Spectra API responses Onlook consumes.
 * Intentionally *not* importing from `@spectra/shared` — Spectra is an
 * external service with its own release cadence and we don't want its types
 * leaking into Onlook's dependency graph.
 *
 * If Spectra changes these shapes, the mirrors here will error at runtime
 * (via `.parse()`) before anything downstream breaks, which is the safer
 * failure mode.
 */

export const spectraDeviceSchema = z.object({
    id: z.string(),
    name: z.string(),
    platform: z.enum(['ios', 'android']),
    status: z.enum(['online', 'offline', 'busy']),
    provisioned: z.literal(true).optional(),
    simUdid: z.string().optional(),
    physicalUdid: z.string().optional(),
    ports: z
        .object({
            adb: z.number().optional(),
            vnc: z.number().optional(),
            wda: z.number().optional(),
        })
        .optional(),
    screenSize: z
        .object({
            width: z.number(),
            height: z.number(),
        })
        .optional(),
});
export type SpectraDevice = z.infer<typeof spectraDeviceSchema>;

export const spectraOkSchema = z.object({ ok: z.literal(true) });
export type SpectraOk = z.infer<typeof spectraOkSchema>;

export const spectraErrorSchema = z.object({ error: z.string() });
export type SpectraError = z.infer<typeof spectraErrorSchema>;
