/**
 * Unit tests for SupabaseStorageAdapter key translation.
 *
 * Covers the regression where `toKey('.')` produced `${prefix}/.`, which
 * Supabase Storage's `list` endpoint treats as a literal directory named
 * "." and returns `[]`. See Wave R1 / Bug R1.1 in
 * plans/expo-browser-e2e-task-queue.md.
 *
 * The adapter's `toKey` is private, so we expose it via a tiny subclass.
 * A stub SupabaseClient is passed in so no network or real client is
 * needed: these tests only exercise the pure key-munging logic.
 */
import { describe, expect, it } from 'bun:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseStorageAdapter } from '../utils/storage';

const PROJECT_ID = '2bffdddd-0000-0000-0000-000000000001';
const BRANCH_ID = 'fceb0000-0000-0000-0000-0000000000aa';
const PREFIX = `${PROJECT_ID}/${BRANCH_ID}`;

// Minimal stub — toKey never touches the client, but the constructor
// needs *something* to avoid spinning up a real Supabase client.
const stubClient = {
    storage: {
        from: () => ({
            list: async () => ({ data: [], error: null }),
            upload: async () => ({ data: null, error: null }),
        }),
    },
} as unknown as SupabaseClient;

class TestableSupabaseStorageAdapter extends SupabaseStorageAdapter {
    publicToKey(logicalPath: string): string {
        // toKey is private — cast through unknown to reach it without
        // widening the production surface area.
        return (this as unknown as { toKey(p: string): string }).toKey(logicalPath);
    }
}

function makeAdapter(): TestableSupabaseStorageAdapter {
    return new TestableSupabaseStorageAdapter({
        projectId: PROJECT_ID,
        branchId: BRANCH_ID,
        supabaseUrl: 'http://127.0.0.1:54321',
        supabaseKey: 'test-key',
        client: stubClient,
    });
}

describe('SupabaseStorageAdapter.toKey', () => {
    const adapter = makeAdapter();

    it("maps '.' to the bare prefix (bug R1.1 — no trailing slash, no literal dot)", () => {
        // Regression: previously returned `${PREFIX}/.`, which Supabase Storage
        // treats as a directory literally named "." and lists as empty.
        expect(adapter.publicToKey('.')).toBe(PREFIX);
    });

    it("maps '' (empty string) to the bare prefix", () => {
        expect(adapter.publicToKey('')).toBe(PREFIX);
    });

    it("maps '/' (single leading slash only) to the bare prefix", () => {
        expect(adapter.publicToKey('/')).toBe(PREFIX);
    });

    it("maps './foo' to ${prefix}/foo", () => {
        expect(adapter.publicToKey('./foo')).toBe(`${PREFIX}/foo`);
    });

    it("maps '/foo' to ${prefix}/foo", () => {
        expect(adapter.publicToKey('/foo')).toBe(`${PREFIX}/foo`);
    });

    it("maps 'foo/bar' to ${prefix}/foo/bar (regression check on normal case)", () => {
        expect(adapter.publicToKey('foo/bar')).toBe(`${PREFIX}/foo/bar`);
    });

    it("maps './foo/bar' to ${prefix}/foo/bar", () => {
        expect(adapter.publicToKey('./foo/bar')).toBe(`${PREFIX}/foo/bar`);
    });
});
