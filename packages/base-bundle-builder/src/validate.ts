import { hashBaseBundleCode, type BaseBundleArtifactMetadata } from './artifact';
import type { BaseBundlePlatform } from './options';

export interface BaseBundleArtifact {
    readonly code: string;
    readonly map?: string;
    readonly metadata: BaseBundleArtifactMetadata;
}

export interface BaseBundleArtifactValidationIssue {
    readonly field: string;
    readonly message: string;
    readonly expected?: string | number | boolean;
    readonly actual?: string | number | boolean | undefined;
}

export interface BaseBundleArtifactValidationResult {
    readonly valid: boolean;
    readonly issues: readonly BaseBundleArtifactValidationIssue[];
}

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const SUPPORTED_PLATFORMS: readonly BaseBundlePlatform[] = ['ios', 'android'];

function utf8ByteLength(value: string): number {
    return new TextEncoder().encode(value).byteLength;
}

function isValidDateString(value: string): boolean {
    return !Number.isNaN(new Date(value).getTime());
}

export function validateBaseBundleArtifact(
    artifact: Partial<BaseBundleArtifact>,
): BaseBundleArtifactValidationResult {
    const issues: BaseBundleArtifactValidationIssue[] = [];

    if (typeof artifact.code !== 'string' || artifact.code.trim().length === 0) {
        issues.push({
            field: 'code',
            message: 'Base bundle artifact code must be non-empty',
            actual: artifact.code,
        });
    }

    if (artifact.metadata === undefined || artifact.metadata === null) {
        issues.push({
            field: 'metadata',
            message: 'Base bundle artifact metadata is required',
        });
    } else {
        const metadata = artifact.metadata;

        if (typeof metadata.hash !== 'string' || metadata.hash.length === 0) {
            issues.push({
                field: 'metadata.hash',
                message: 'Base bundle artifact hash is required',
                actual: metadata.hash,
            });
        } else {
            if (!SHA256_HEX_PATTERN.test(metadata.hash)) {
                issues.push({
                    field: 'metadata.hash',
                    message: 'Base bundle artifact hash must be a 64-character hex sha256 digest',
                    actual: metadata.hash,
                });
            }

            if (typeof artifact.code === 'string' && artifact.code.trim().length > 0) {
                const expectedHash = hashBaseBundleCode(artifact.code);
                if (metadata.hash !== expectedHash) {
                    issues.push({
                        field: 'metadata.hash',
                        message: 'Base bundle artifact hash must match the artifact code',
                        expected: expectedHash,
                        actual: metadata.hash,
                    });
                }
            }
        }

        if (
            !Number.isInteger(metadata.codeBytes) ||
            metadata.codeBytes < 0
        ) {
            issues.push({
                field: 'metadata.codeBytes',
                message: 'Base bundle artifact codeBytes must be a non-negative integer',
                actual: metadata.codeBytes,
            });
        } else if (typeof artifact.code === 'string' && artifact.code.trim().length > 0) {
            const expectedCodeBytes = utf8ByteLength(artifact.code);
            if (metadata.codeBytes !== expectedCodeBytes) {
                issues.push({
                    field: 'metadata.codeBytes',
                    message: 'Base bundle artifact codeBytes must match the code byte length',
                    expected: expectedCodeBytes,
                    actual: metadata.codeBytes,
                });
            }
        }

        if (typeof metadata.createdAt !== 'string' || metadata.createdAt.length === 0) {
            issues.push({
                field: 'metadata.createdAt',
                message: 'Base bundle artifact createdAt is required',
                actual: metadata.createdAt,
            });
        } else if (!isValidDateString(metadata.createdAt)) {
            issues.push({
                field: 'metadata.createdAt',
                message: 'Base bundle artifact createdAt must be a valid ISO date string',
                actual: metadata.createdAt,
            });
        }

        if (
            typeof metadata.platform !== 'string' ||
            !SUPPORTED_PLATFORMS.includes(metadata.platform)
        ) {
            issues.push({
                field: 'metadata.platform',
                message: 'Base bundle artifact platform must be ios or android',
                actual: metadata.platform,
            });
        }

        if (typeof metadata.dev !== 'boolean') {
            issues.push({
                field: 'metadata.dev',
                message: 'Base bundle artifact dev flag is required',
                actual: metadata.dev,
            });
        }

        if (typeof metadata.minify !== 'boolean') {
            issues.push({
                field: 'metadata.minify',
                message: 'Base bundle artifact minify flag is required',
                actual: metadata.minify,
            });
        }

        if (artifact.map === undefined) {
            if (metadata.mapBytes !== undefined) {
                issues.push({
                    field: 'metadata.mapBytes',
                    message: 'Base bundle artifact mapBytes must be omitted when map is absent',
                    actual: metadata.mapBytes,
                });
            }
        } else {
            if (typeof metadata.mapBytes !== 'number' || !Number.isInteger(metadata.mapBytes) || metadata.mapBytes < 0) {
                issues.push({
                    field: 'metadata.mapBytes',
                    message: 'Base bundle artifact mapBytes must be a non-negative integer when map is present',
                    actual: metadata.mapBytes,
                });
            } else {
                const expectedMapBytes = utf8ByteLength(artifact.map);
                if (metadata.mapBytes !== expectedMapBytes) {
                    issues.push({
                        field: 'metadata.mapBytes',
                        message: 'Base bundle artifact mapBytes must match the map byte length',
                        expected: expectedMapBytes,
                        actual: metadata.mapBytes,
                    });
                }
            }
        }
    }

    return {
        valid: issues.length === 0,
        issues,
    };
}

export function assertValidBaseBundleArtifact(
    artifact: Partial<BaseBundleArtifact>,
): asserts artifact is BaseBundleArtifact {
    const result = validateBaseBundleArtifact(artifact);

    if (!result.valid) {
        throw new Error(
            `Base bundle artifact validation failed: ${result.issues
                .map((issue) => `${issue.field}: ${issue.message}`)
                .join('; ')}`,
        );
    }
}
