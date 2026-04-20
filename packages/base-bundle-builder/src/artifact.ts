import { createHash } from 'node:crypto';

import type { BuildBaseBundleResult } from './build';
import type { BaseBundleBuildOptions } from './options';

export interface BaseBundleArtifactMetadata {
    readonly hash: string;
    readonly codeBytes: number;
    readonly mapBytes?: number;
    readonly createdAt: string;
    readonly platform: BaseBundleBuildOptions['platform'];
    readonly dev: boolean;
    readonly minify: boolean;
}

export interface CreateBaseBundleArtifactMetadataInput
    extends Pick<BuildBaseBundleResult, 'code' | 'map' | 'options'> {
    readonly createdAt?: string | Date;
}

function utf8ByteLength(value: string): number {
    return new TextEncoder().encode(value).byteLength;
}

function normalizeCreatedAt(value: string | Date | undefined): string {
    const createdAt = value ?? new Date();
    const normalized = new Date(createdAt);

    if (Number.isNaN(normalized.getTime())) {
        throw new Error('Base bundle artifact createdAt must be a valid date');
    }

    return normalized.toISOString();
}

export function hashBaseBundleCode(code: string): string {
    return createHash('sha256').update(code, 'utf8').digest('hex');
}

export function createBaseBundleArtifactMetadata(
    input: CreateBaseBundleArtifactMetadataInput,
): BaseBundleArtifactMetadata {
    return {
        hash: hashBaseBundleCode(input.code),
        codeBytes: utf8ByteLength(input.code),
        createdAt: normalizeCreatedAt(input.createdAt),
        platform: input.options.platform,
        dev: input.options.dev,
        minify: input.options.minify,
        ...(input.map !== undefined ? { mapBytes: utf8ByteLength(input.map) } : {}),
    };
}
