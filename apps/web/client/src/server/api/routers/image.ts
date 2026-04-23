import { compressImageServer, type CompressionOptions, type CompressionResult } from '@onlook/image-server';
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../trpc';

type TRPCCompressionResult = Omit<CompressionResult, 'buffer'> & {
    bufferData?: string; // base64 encoded buffer data
};

export const imageRouter = createTRPCRouter({
    compress: protectedProcedure
        .input(
            z.object({
                imageData: z.string(), // base64 encoded image data
                options: z.object({
                    // All numeric knobs tightened — the underlying sharp
                    // library rejects absurd values but the tRPC boundary
                    // should surface a clean zod error instead of a
                    // library-side stack trace for obviously bad inputs.
                    // Ranges mirror sharp's documented accepted domains.
                    quality: z.number().int().min(1).max(100).optional(),
                    width: z.number().int().positive().max(16_384).optional(),
                    height: z.number().int().positive().max(16_384).optional(),
                    format: z.enum(['jpeg', 'png', 'webp', 'avif', 'auto']).optional(),
                    progressive: z.boolean().optional(),
                    mozjpeg: z.boolean().optional(),
                    // sharp's `effort` is 0..10 for AVIF, 0..6 for WebP — use
                    // the wider domain + non-negative guard for both.
                    effort: z.number().int().min(0).max(10).optional(),
                    // PNG zlib compression level is 0..9.
                    compressionLevel: z.number().int().min(0).max(9).optional(),
                    keepAspectRatio: z.boolean().optional(),
                    withoutEnlargement: z.boolean().optional(),
                }).optional(),
            }),
        )
        .mutation(async ({ input }): Promise<TRPCCompressionResult> => {
            try {
                const buffer = Buffer.from(input.imageData, 'base64');

                const result = await compressImageServer(
                    buffer,
                    undefined, // No output path - return buffer
                    input.options as CompressionOptions || {}
                );

                // Convert buffer to base64 for client transmission
                if (result.success && result.buffer) {
                    const { buffer: resultBuffer, ...restResult } = result;
                    return {
                        ...restResult,
                        bufferData: resultBuffer.toString('base64'),
                    };
                }

                const { buffer: resultBuffer, ...restResult } = result;
                return restResult;
            } catch (error) {
                console.error('Error compressing image:', error);
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown compression error',
                };
            }
        }),
}); 