/**
 * R2 helpers for bundle storage. Implemented in TH2.5.
 */
import type { Env } from '../types';

export async function r2GetBundle(env: Env, hash: string): Promise<R2ObjectBody | null> {
    throw new Error('TODO: TH2.5');
}

export async function r2PutBundle(env: Env, hash: string, body: ReadableStream): Promise<void> {
    throw new Error('TODO: TH2.5');
}
