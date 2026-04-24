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
import { SupabaseStorageAdapter, containsParentSegment } from '../utils/storage';

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

    publicFromKey(key: string): string {
        // fromKey is private — same trick as publicToKey.
        return (this as unknown as { fromKey(k: string): string }).fromKey(key);
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

describe('SupabaseStorageAdapter.fromKey', () => {
    const adapter = makeAdapter();

    it("maps the bare prefix to '' (symmetric inverse of toKey('.'))", () => {
        // Branch root: toKey('.') returns ${PREFIX}, so fromKey(${PREFIX})
        // must return '' to close the loop.
        expect(adapter.publicFromKey(PREFIX)).toBe('');
    });

    it("maps '${prefix}/' (trailing slash from directory listings) to ''", () => {
        expect(adapter.publicFromKey(`${PREFIX}/`)).toBe('');
    });

    it("maps '${prefix}/foo' to 'foo' (regression — normal single segment)", () => {
        expect(adapter.publicFromKey(`${PREFIX}/foo`)).toBe('foo');
    });

    it("maps '${prefix}/foo/bar' to 'foo/bar' (regression — nested path)", () => {
        expect(adapter.publicFromKey(`${PREFIX}/foo/bar`)).toBe('foo/bar');
    });

    it("maps '${prefix}//foo' to 'foo' (duplicate slash after prefix)", () => {
        expect(adapter.publicFromKey(`${PREFIX}//foo`)).toBe('foo');
    });

    it("maps '${prefix}/foo/' to 'foo' (trailing slash on nested key)", () => {
        expect(adapter.publicFromKey(`${PREFIX}/foo/`)).toBe('foo');
    });

    it("passes through keys that don't match the prefix", () => {
        expect(adapter.publicFromKey('unrelated/key')).toBe('unrelated/key');
    });

    it("round-trips fromKey(toKey('.')) to ''", () => {
        expect(adapter.publicFromKey(adapter.publicToKey('.'))).toBe('');
    });

    it("round-trips fromKey(toKey('foo/bar')) to 'foo/bar'", () => {
        expect(adapter.publicFromKey(adapter.publicToKey('foo/bar'))).toBe('foo/bar');
    });

    // Regression for path-traversal defense added in the Phase 9 #51
    // bug-hunt session. toKey used to accept `..` segments verbatim,
    // producing weird storage keys like
    // `<projectId>/<branchId>/../../etc/passwd` that would break
    // fromKey's reverse mapping and (under a misconfigured Supabase
    // Storage setup) could escape the per-user prefix. Now toKey
    // throws on any `..` segment.
    it('rejects path-traversal: plain ".." throws', () => {
        expect(() => adapter.publicToKey('..')).toThrow(/traversal/i);
    });

    it("rejects path-traversal: '../etc' throws", () => {
        expect(() => adapter.publicToKey('../etc')).toThrow(/traversal/i);
    });

    it("rejects path-traversal: 'foo/../bar' throws (mid-path)", () => {
        expect(() => adapter.publicToKey('foo/../bar')).toThrow(/traversal/i);
    });

    it("rejects path-traversal: 'foo/bar/..' throws (trailing)", () => {
        expect(() => adapter.publicToKey('foo/bar/..')).toThrow(/traversal/i);
    });

    it('does NOT reject `..foo` as a path segment (prefix-only match)', () => {
        expect(() => adapter.publicToKey('..foo/bar')).not.toThrow();
    });

    it('does NOT reject `foo..` as a path segment', () => {
        expect(() => adapter.publicToKey('foo../bar')).not.toThrow();
    });
});

describe('containsParentSegment', () => {
    it('returns true for `..`, `a/../b`, `../a`, `a/..`', () => {
        expect(containsParentSegment('..')).toBe(true);
        expect(containsParentSegment('a/../b')).toBe(true);
        expect(containsParentSegment('../a')).toBe(true);
        expect(containsParentSegment('a/..')).toBe(true);
    });

    it('returns false for segment-prefix/suffix matches (`..foo`, `foo..`)', () => {
        expect(containsParentSegment('..foo')).toBe(false);
        expect(containsParentSegment('foo..')).toBe(false);
        expect(containsParentSegment('foo..bar/baz')).toBe(false);
    });

    it('handles backslash separators (Windows paths)', () => {
        expect(containsParentSegment('a\\..\\b')).toBe(true);
    });

    it('returns false for empty / plain paths', () => {
        expect(containsParentSegment('')).toBe(false);
        expect(containsParentSegment('foo/bar.ts')).toBe(false);
        expect(containsParentSegment('.hidden')).toBe(false);
    });
});
