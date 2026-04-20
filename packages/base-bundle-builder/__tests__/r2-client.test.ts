import { describe, expect, test } from 'bun:test';

import { createR2ClientConfig } from '../src/r2-client';

describe('createR2ClientConfig', () => {
    test('derives the default Cloudflare R2 endpoint when one is omitted', () => {
        expect(
            createR2ClientConfig({
                accountId: 'acct-123',
                accessKeyId: 'key-123',
                secretAccessKey: 'secret-123',
                bucket: 'artifacts',
            }),
        ).toEqual({
            accountId: 'acct-123',
            accessKeyId: 'key-123',
            secretAccessKey: 'secret-123',
            bucket: 'artifacts',
            endpoint: 'https://acct-123.r2.cloudflarestorage.com',
        });
    });

    test('keeps an explicit endpoint after trimming whitespace', () => {
        expect(
            createR2ClientConfig({
                accountId: 'acct-123',
                accessKeyId: 'key-123',
                secretAccessKey: 'secret-123',
                bucket: 'artifacts',
                endpoint: '  https://custom.example.com/r2  ',
            }),
        ).toEqual({
            accountId: 'acct-123',
            accessKeyId: 'key-123',
            secretAccessKey: 'secret-123',
            bucket: 'artifacts',
            endpoint: 'https://custom.example.com/r2',
        });
    });

    test('rejects missing required fields with a clear error', () => {
        expect(() =>
            createR2ClientConfig({
                accountId: '',
                accessKeyId: 'key-123',
                secretAccessKey: 'secret-123',
                bucket: 'artifacts',
            }),
        ).toThrow('R2 client accountId is required.');

        expect(() =>
            createR2ClientConfig({
                accountId: 'acct-123',
                accessKeyId: 'key-123',
                secretAccessKey: 'secret-123',
                bucket: 'artifacts',
                endpoint: 'not-a-url',
            }),
        ).toThrow('R2 client endpoint must be a valid absolute URL.');
    });
});
