/**
 * Bundle envelope — the shape of an IIFE bundle produced by @onlook/browser-metro
 * and served by apps/cf-expo-relay to the Onlook Mobile Client.
 *
 * The wire format for v1 is the literal `'onlook-iife-v1'`. The IIFE source itself
 * is plain JavaScript text (not JSON-encoded) with `bare-import-rewriter.ts` having
 * already rewritten bare imports to esm.sh URLs. The envelope wraps the source with
 * the metadata the native client needs to decide whether to mount it.
 *
 * Built by MCF3 of plans/onlook-mobile-client-task-queue.md.
 */
import { z } from 'zod';

export const BUNDLE_FORMAT_V1 = 'onlook-iife-v1' as const;

/**
 * `target` controls whether the bundle includes the 241KB runtime prelude inline
 * (for stock Expo Go consumption) or assumes the runtime is already baked into
 * the binary (for the Onlook Mobile Client). The flag is set by browser-metro
 * at bundle time and validated by the client at mount time.
 */
export const BundleTargetSchema = z.enum(['expo-go', 'onlook-client']);
export type BundleTarget = z.infer<typeof BundleTargetSchema>;

export const BundleEnvelopeSchema = z.object({
    bundleFormat: z.literal(BUNDLE_FORMAT_V1),
    onlookRuntimeVersion: z
        .string()
        .regex(/^\d+\.\d+\.\d+$/, 'onlookRuntimeVersion must be semver'),
    target: BundleTargetSchema,
    /** The IIFE JavaScript source text. Not JSON-encoded. */
    source: z.string().min(1),
    /** esm.sh URLs the runtime must fetch before the IIFE body can execute. */
    urlImports: z.array(z.string().url()),
    /** The user's entry module path relative to the project root, e.g. `App.tsx`. */
    entryPoint: z.string().min(1),
    /** Optional source map as a data URL or inline JSON string. */
    sourceMap: z.string().optional(),
});

export type BundleEnvelope = z.infer<typeof BundleEnvelopeSchema>;
