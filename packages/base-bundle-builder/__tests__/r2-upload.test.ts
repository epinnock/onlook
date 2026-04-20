import { describe, expect, test } from 'bun:test';

import { createR2ClientConfig } from '../src/r2-client';
import {
    createImmutableR2UploadKey,
    uploadImmutableR2Object,
} from '../src/r2-upload';

const CONFIG = createR2ClientConfig({
    accountId: 'acct-123',
    accessKeyId: 'key-123',
    secretAccessKey: 'secret-123',
    bucket: 'base-bundles',
    endpoint: 'https://cdn.example.com/r2',
});

function createClient(options: {
    readonly headObject?: () => Promise<unknown>;
    readonly putObject?: (input: {
        Bucket: string;
        Key: string;
        Body: Uint8Array;
        CacheControl?: string;
    }) => Promise<unknown>;
}) {
    const calls = {
        headObject: [] as Array<{ Bucket: string; Key: string }>,
        putObject: [] as Array<{
            Bucket: string;
            Key: string;
            Body: Uint8Array;
            CacheControl?: string;
        }>,
    };

    return {
        client: {
            async headObject(input: { Bucket: string; Key: string }) {
                calls.headObject.push(input);
                if (options.headObject) {
                    return options.headObject();
                }
                throw missingObjectError();
            },
            async putObject(input: {
                Bucket: string;
                Key: string;
                Body: Uint8Array;
                CacheControl?: string;
            }) {
                calls.putObject.push(input);
                return options.putObject ? options.putObject(input) : undefined;
            },
        },
        calls,
    };
}

function missingObjectError(): Error & { code: string; statusCode: number } {
    const error = new Error('missing');
    return Object.assign(error, { code: 'NotFound', statusCode: 404 });
}

describe('r2 upload helper', () => {
    test('uploads immutable objects under a content-addressed key', async () => {
        const { client, calls } = createClient({});
        const key = createImmutableR2UploadKey('hello world');

        const result = await uploadImmutableR2Object(CONFIG, client, {
            body: 'hello world',
        });

        expect(result).toEqual({
            key,
            uploaded: true,
            url: `https://cdn.example.com/r2/base-bundles/${key}`,
            path: `/base-bundles/${key}`,
        });
        expect(calls.headObject).toEqual([
            {
                Bucket: 'base-bundles',
                Key: key,
            },
        ]);
        expect(calls.putObject).toHaveLength(1);
        expect(calls.putObject[0]).toEqual({
            Bucket: 'base-bundles',
            Key: key,
            Body: new TextEncoder().encode('hello world'),
            CacheControl: 'public, max-age=31536000, immutable',
        });
    });

    test('skips upload when the object already exists', async () => {
        const { client, calls } = createClient({
            headObject: async () => ({ ETag: '"existing"' }),
        });
        const key = createImmutableR2UploadKey(new Uint8Array([1, 2, 3]));

        const result = await uploadImmutableR2Object(CONFIG, client, {
            body: new Uint8Array([1, 2, 3]),
        });

        expect(result).toEqual({
            key,
            uploaded: false,
            url: `https://cdn.example.com/r2/base-bundles/${key}`,
            path: `/base-bundles/${key}`,
        });
        expect(calls.headObject).toHaveLength(1);
        expect(calls.putObject).toHaveLength(0);
    });

    test('forces upload even when the object already exists', async () => {
        const { client, calls } = createClient({
            headObject: async () => ({ ETag: '"existing"' }),
        });

        const result = await uploadImmutableR2Object(CONFIG, client, {
            body: 'force-me',
            force: true,
        });

        expect(result.uploaded).toBe(true);
        expect(calls.headObject).toHaveLength(0);
        expect(calls.putObject).toHaveLength(1);
    });

    test('generates a stable sha256 key from the body bytes', () => {
        expect(createImmutableR2UploadKey('hello world')).toBe(
            'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
        );
    });
});
