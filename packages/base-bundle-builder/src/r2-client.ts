export interface R2ClientEnvLike {
    readonly accountId?: string | null;
    readonly accessKeyId?: string | null;
    readonly secretAccessKey?: string | null;
    readonly bucket?: string | null;
    readonly endpoint?: string | null;
}

export interface R2ClientConfig {
    readonly accountId: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
    readonly bucket: string;
    readonly endpoint: string;
}

function readRequiredField(value: string | null | undefined, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`R2 client ${field} is required.`);
    }

    return value.trim();
}

function normalizeEndpoint(endpoint: string | null | undefined, accountId: string): string {
    if (typeof endpoint !== 'string' || endpoint.trim().length === 0) {
        return `https://${accountId}.r2.cloudflarestorage.com`;
    }

    const normalizedEndpoint = endpoint.trim();

    try {
        new URL(normalizedEndpoint);
    } catch {
        throw new Error('R2 client endpoint must be a valid absolute URL.');
    }

    return normalizedEndpoint;
}

export function createR2ClientConfig(input: R2ClientEnvLike): R2ClientConfig {
    const accountId = readRequiredField(input.accountId, 'accountId');
    const accessKeyId = readRequiredField(input.accessKeyId, 'accessKeyId');
    const secretAccessKey = readRequiredField(
        input.secretAccessKey,
        'secretAccessKey',
    );
    const bucket = readRequiredField(input.bucket, 'bucket');

    return {
        accountId,
        accessKeyId,
        secretAccessKey,
        bucket,
        endpoint: normalizeEndpoint(input.endpoint, accountId),
    };
}
