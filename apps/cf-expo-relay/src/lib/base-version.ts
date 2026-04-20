export const CURRENT_BASE_BUNDLE_VERSION_KEY = 'base-bundle:current';

export interface BaseBundleVersionRecord {
    readonly hash: string;
    readonly createdAt: string;
}

export interface BaseVersionKV {
    get(key: string): Promise<string | null>;
}

export interface BaseVersionEnv {
    readonly BUNDLES: BaseVersionKV;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

export async function readCurrentBaseBundleVersion(
    env: BaseVersionEnv,
): Promise<BaseBundleVersionRecord | null> {
    const raw = await env.BUNDLES.get(CURRENT_BASE_BUNDLE_VERSION_KEY);
    if (raw === null) {
        return null;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error('Invalid base-bundle version pointer JSON');
    }

    return parseBaseBundleVersionRecord(parsed);
}

export function parseBaseBundleVersionRecord(
    value: unknown,
): BaseBundleVersionRecord {
    if (typeof value !== 'object' || value === null) {
        throw new Error('Base-bundle version pointer must be an object');
    }

    const record = value as Record<string, unknown>;
    if (typeof record.hash !== 'string' || !SHA256_HEX.test(record.hash)) {
        throw new Error('Base-bundle version pointer has an invalid hash');
    }

    if (typeof record.createdAt !== 'string' || Number.isNaN(Date.parse(record.createdAt))) {
        throw new Error('Base-bundle version pointer has an invalid createdAt');
    }

    return {
        hash: record.hash,
        createdAt: record.createdAt,
    };
}
