#!/usr/bin/env bun
/**
 * Asset upload + check round-trip smoke for cf-expo-relay.
 *
 * Validates the canonical PUT/HEAD /base-bundle/assets/<hash> endpoints
 * end-to-end against a live wrangler. Closes the workerd-runtime
 * coverage gap for the editor uploaders retargeted this session
 * (commits 53bd29ff + 321219b8) — they unit-test against synthetic
 * fakes; this smoke proves they actually work against the real relay.
 *
 * What it tests:
 *   1. HEAD an unknown hash → 404 (asset not present yet).
 *   2. PUT the bytes for that hash → 201 (created), no body.
 *   3. HEAD the now-known hash → 200 (asset present after upload).
 *   4. PUT the same hash a second time → 200 (overwrite, not 201).
 *   5. GET the asset → 200 with content-type round-trip + body match.
 *
 * Wire matches the real editor uploader: the URI returned by the
 * editor is `<relayBaseUrl>/base-bundle/assets/<hash>` (derived from
 * the request URL since the relay's PUT returns no body).
 *
 * Exit codes:
 *   0 — every assertion passed
 *   1 — at least one assertion failed
 *   2 — connection / fetch setup failed
 *
 * Used by smoke-e2e.sh as step #7. Standalone:
 *   bun apps/cf-expo-relay/scripts/smoke-asset-upload.ts http://localhost:18788
 */

import { createHash, randomBytes } from 'node:crypto';

const RELAY_BASE = process.argv[2] ?? 'http://localhost:18788';
const HTTP_BASE = RELAY_BASE.replace(/\/$/, '');

let failures = 0;
function ok(name: string): void {
    console.info(`[smoke-asset-upload] OK   ${name}`);
}
function fail(name: string, detail = ''): void {
    failures += 1;
    console.error(
        `[smoke-asset-upload] FAIL ${name}${detail ? `: ${detail}` : ''}`,
    );
}

async function main(): Promise<void> {
    // Build a unique payload + sha256 hex hash so we don't collide with
    // anything left over in R2 from a prior run.
    const payload = randomBytes(64);
    const hash = createHash('sha256').update(payload).digest('hex');
    const url = `${HTTP_BASE}/base-bundle/assets/${hash}`;
    console.info(`[smoke-asset-upload] target=${url}`);
    console.info(`[smoke-asset-upload] hash=${hash}`);
    console.info(`[smoke-asset-upload] bytes=${payload.byteLength}`);

    // Step 1: HEAD on an unknown hash → 404.
    let resp: Response;
    try {
        resp = await fetch(url, { method: 'HEAD' });
    } catch (err) {
        console.error(`[smoke-asset-upload] HEAD setup failed:`, err);
        process.exit(2);
    }
    if (resp.status === 404) {
        ok('HEAD unknown hash → 404 (correct cache miss)');
    } else {
        fail(
            'HEAD unknown hash status',
            `expected 404, got ${resp.status} (R2 stale entry?)`,
        );
    }

    // Step 2: PUT bytes → 201 created.
    try {
        resp = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: payload as unknown as BodyInit,
        });
    } catch (err) {
        console.error(`[smoke-asset-upload] PUT failed:`, err);
        process.exit(2);
    }
    if (resp.status === 201) {
        ok('PUT first-write → 201 created');
    } else {
        fail(
            'PUT first-write status',
            `expected 201, got ${resp.status}`,
        );
    }

    // Step 3: HEAD the now-known hash → 200.
    resp = await fetch(url, { method: 'HEAD' });
    if (resp.status === 200) {
        ok('HEAD known hash → 200 (asset durably stored)');
    } else {
        fail('HEAD known hash status', `expected 200, got ${resp.status}`);
    }

    // Step 4: PUT same hash again → 200 overwrite (not 201).
    resp = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: payload as unknown as BodyInit,
    });
    if (resp.status === 200) {
        ok('PUT overwrite → 200 (idempotent put)');
    } else {
        fail(
            'PUT overwrite status',
            `expected 200, got ${resp.status} (relay didn\'t detect existing object)`,
        );
    }

    // Step 5: GET the asset → bytes round-trip + content-type preserved.
    resp = await fetch(url, { method: 'GET' });
    if (resp.status !== 200) {
        fail('GET asset status', `expected 200, got ${resp.status}`);
    } else {
        const ct = resp.headers.get('content-type') ?? '';
        if (ct.includes('octet-stream')) {
            ok('GET content-type preserved (octet-stream)');
        } else {
            fail('GET content-type', `expected octet-stream, got "${ct}"`);
        }
        const got = new Uint8Array(await resp.arrayBuffer());
        if (got.byteLength === payload.byteLength) {
            ok('GET body byteLength matches PUT payload');
        } else {
            fail(
                'GET body byteLength',
                `expected ${payload.byteLength}, got ${got.byteLength}`,
            );
        }
        // Sample-byte check (full byte-for-byte would balloon log).
        let bytewiseMatch = true;
        for (let i = 0; i < got.byteLength; i++) {
            if (got[i] !== payload[i]) {
                bytewiseMatch = false;
                break;
            }
        }
        if (bytewiseMatch) {
            ok('GET body byte-for-byte equals PUT payload');
        } else {
            fail('GET body byte mismatch — R2 corruption?');
        }
    }

    if (failures > 0) {
        console.error(`[smoke-asset-upload] ${failures} assertion(s) failed`);
        process.exit(1);
    }
    console.info('[smoke-asset-upload] all green');
}

main().catch((err) => {
    console.error('[smoke-asset-upload] unexpected error:', err);
    process.exit(2);
});
