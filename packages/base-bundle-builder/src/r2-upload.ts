import { createHash } from 'node:crypto';

import type { R2ClientConfig } from './r2-client';

export interface R2UploadBody {
    readonly body: string | Uint8Array | ArrayBuffer | ArrayBufferView;
    readonly force?: boolean;
}

export interface R2UploadClient {
    headObject(input: { Bucket: string; Key: string }): Promise<unknown>;
    putObject(input: {
        Bucket: string;
        Key: string;
        Body: Uint8Array;
        CacheControl?: string;
    }): Promise<unknown>;
}

export interface R2UploadResult {
    readonly key: string;
    readonly uploaded: boolean;
    readonly url: string;
    readonly path: string;
}

const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

const textEncoder = new TextEncoder();

export function createImmutableR2UploadKey(body: string | Uint8Array | ArrayBuffer | ArrayBufferView): string {
    const bytes = toUint8Array(body);
    return createHash('sha256').update(bytes).digest('hex');
}

export async function uploadImmutableR2Object(
    config: R2ClientConfig,
    client: R2UploadClient,
    input: R2UploadBody,
): Promise<R2UploadResult> {
    const key = createImmutableR2UploadKey(input.body);

    if (!input.force) {
        const exists = await objectExists(client, config.bucket, key);
        if (exists) {
            return createR2UploadResult(config, key, false);
        }
    }

    await client.putObject({
        Bucket: config.bucket,
        Key: key,
        Body: toUint8Array(input.body),
        CacheControl: IMMUTABLE_CACHE_CONTROL,
    });

    return createR2UploadResult(config, key, true);
}

function createR2UploadResult(
    config: R2ClientConfig,
    key: string,
    uploaded: boolean,
): R2UploadResult {
    return {
        key,
        uploaded,
        url: createR2ObjectUrl(config, key),
        path: createR2ObjectPath(config, key),
    };
}

function createR2ObjectUrl(config: R2ClientConfig, key: string): string {
    return new URL(`${config.bucket}/${key}`, ensureTrailingSlash(config.endpoint)).toString();
}

function createR2ObjectPath(config: R2ClientConfig, key: string): string {
    return `/${config.bucket}/${key}`;
}

async function objectExists(client: R2UploadClient, bucket: string, key: string): Promise<boolean> {
    try {
        await client.headObject({ Bucket: bucket, Key: key });
        return true;
    } catch (error) {
        if (isMissingObjectError(error)) {
            return false;
        }

        throw error;
    }
}

function isMissingObjectError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }

    const code = readErrorField(error, 'code');
    if (code === 'NotFound' || code === 'NoSuchKey' || code === '404') {
        return true;
    }

    const name = readErrorField(error, 'name');
    if (name === 'NotFound' || name === 'NoSuchKey') {
        return true;
    }

    const statusCode = readNumberField(error, 'statusCode');
    if (statusCode === 404) {
        return true;
    }

    const status = readNumberField(error, 'status');
    if (status === 404) {
        return true;
    }

    const metadata = readObjectField(error, '$metadata');
    if (metadata !== undefined && readNumberField(metadata, 'httpStatusCode') === 404) {
        return true;
    }

    return false;
}

function readErrorField(error: object, field: string): string | undefined {
    const value = (error as Record<string, unknown>)[field];
    return typeof value === 'string' ? value : undefined;
}

function readNumberField(error: object, field: string): number | undefined {
    const value = (error as Record<string, unknown>)[field];
    return typeof value === 'number' ? value : undefined;
}

function readObjectField(error: object, field: string): Record<string, unknown> | undefined {
    const value = (error as Record<string, unknown>)[field];
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function ensureTrailingSlash(url: string): string {
    return url.endsWith('/') ? url : `${url}/`;
}

function toUint8Array(body: string | Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array {
    if (typeof body === 'string') {
        return textEncoder.encode(body);
    }

    if (body instanceof Uint8Array) {
        return body;
    }

    if (body instanceof ArrayBuffer) {
        return new Uint8Array(body);
    }

    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
}
