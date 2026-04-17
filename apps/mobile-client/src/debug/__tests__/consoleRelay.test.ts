/**
 * Tests for the console relay.
 *
 * Task: MC5.1
 * Validate: bun test apps/mobile-client/src/debug/__tests__/consoleRelay.test.ts
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ConsoleRelay } from '../consoleRelay';
import type { ConsoleEntry } from '../consoleRelay';

describe('ConsoleRelay', () => {
    let relay: ConsoleRelay;

    // Save genuine originals before each test so we can verify restoration.
    let originalLog: typeof console.log;
    let originalWarn: typeof console.warn;
    let originalError: typeof console.error;
    let originalInfo: typeof console.info;
    let originalDebug: typeof console.debug;

    beforeEach(() => {
        relay = new ConsoleRelay();
        originalLog = console.log;
        originalWarn = console.warn;
        originalError = console.error;
        originalInfo = console.info;
        originalDebug = console.debug;
    });

    afterEach(() => {
        // Always uninstall to avoid leaking patches between tests.
        relay.uninstall();
        // Restore genuine originals in case uninstall was not called or failed.
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;
        console.info = originalInfo;
        console.debug = originalDebug;
    });

    test('install patches console.log', () => {
        const before = console.log;
        relay.install();
        expect(console.log).not.toBe(before);
    });

    test('original console method is still called after install', () => {
        const spy = mock(() => {});
        console.log = spy;
        relay.install();
        console.log('hello');
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith('hello');
    });

    test('entry is captured with correct level', () => {
        relay.install();
        console.log('log-message');
        console.warn('warn-message');
        console.error('error-message');
        console.info('info-message');
        console.debug('debug-message');

        const buffer = relay.getBuffer();
        expect(buffer).toHaveLength(5);
        expect(buffer[0]!.level).toBe('log');
        expect(buffer[0]!.message).toBe('log-message');
        expect(buffer[1]!.level).toBe('warn');
        expect(buffer[1]!.message).toBe('warn-message');
        expect(buffer[2]!.level).toBe('error');
        expect(buffer[2]!.message).toBe('error-message');
        expect(buffer[3]!.level).toBe('info');
        expect(buffer[3]!.message).toBe('info-message');
        expect(buffer[4]!.level).toBe('debug');
        expect(buffer[4]!.message).toBe('debug-message');
    });

    test('uninstall restores original console methods', () => {
        const origLog = console.log;
        const origWarn = console.warn;
        const origError = console.error;
        const origInfo = console.info;
        const origDebug = console.debug;

        relay.install();

        // Should be patched now.
        expect(console.log).not.toBe(origLog);

        relay.uninstall();

        // Should be restored.
        expect(console.log).toBe(origLog);
        expect(console.warn).toBe(origWarn);
        expect(console.error).toBe(origError);
        expect(console.info).toBe(origInfo);
        expect(console.debug).toBe(origDebug);
    });

    test('buffer caps at 200 entries', () => {
        relay.install();
        for (let i = 0; i < 250; i++) {
            console.log(`entry-${i}`);
        }

        const buffer = relay.getBuffer();
        expect(buffer).toHaveLength(200);
        // Oldest 50 should have been evicted.
        expect(buffer[0]!.message).toBe('entry-50');
        expect(buffer[199]!.message).toBe('entry-249');
    });

    test('clearBuffer empties the buffer', () => {
        relay.install();
        console.log('a');
        console.log('b');
        expect(relay.getBuffer()).toHaveLength(2);

        relay.clearBuffer();
        expect(relay.getBuffer()).toHaveLength(0);
    });

    test('listener receives entries', () => {
        const received: ConsoleEntry[] = [];
        relay.onEntry((entry) => received.push(entry));
        relay.install();

        console.log('test-msg');

        expect(received).toHaveLength(1);
        expect(received[0]!.level).toBe('log');
        expect(received[0]!.message).toBe('test-msg');
        expect(received[0]!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test('unsubscribe stops delivery to that listener', () => {
        const received: ConsoleEntry[] = [];
        const unsub = relay.onEntry((entry) => received.push(entry));
        relay.install();

        console.log('before-unsub');
        expect(received).toHaveLength(1);

        unsub();

        console.log('after-unsub');
        // Should still be 1 — the second message should not arrive.
        expect(received).toHaveLength(1);
    });

    test('serialization handles objects, arrays, and circular refs', () => {
        relay.install();

        console.log({ key: 'value' });
        console.log([1, 2, 3]);

        // Create circular reference.
        const circular: Record<string, unknown> = { a: 1 };
        circular['self'] = circular;
        console.log(circular);

        const buffer = relay.getBuffer();
        expect(buffer[0]!.message).toBe('{"key":"value"}');
        expect(buffer[1]!.message).toBe('[1,2,3]');
        // Circular should fall back gracefully (not throw).
        expect(buffer[2]!.message).toBe('[object Object]');
    });

    test('serialization handles Error objects', () => {
        relay.install();
        const err = new Error('test error');
        console.error(err);

        const buffer = relay.getBuffer();
        expect(buffer[0]!.message).toContain('test error');
    });

    test('serialization handles multiple arguments', () => {
        relay.install();
        console.log('count:', 42, true, null);

        const buffer = relay.getBuffer();
        expect(buffer[0]!.message).toBe('count: 42 true null');
    });

    test('install is idempotent (second call is a no-op)', () => {
        const origLog = console.log;
        relay.install();
        const patchedLog = console.log;
        relay.install(); // Second call — should not double-patch.
        expect(console.log).toBe(patchedLog);

        relay.uninstall();
        expect(console.log).toBe(origLog);
    });

    test('getBuffer returns entries in chronological order after wrap', () => {
        relay.install();
        for (let i = 0; i < 210; i++) {
            console.log(`msg-${i}`);
        }

        const buffer = relay.getBuffer();
        // Should be 200 entries, oldest is msg-10, newest is msg-209.
        for (let i = 0; i < 200; i++) {
            expect(buffer[i]!.message).toBe(`msg-${i + 10}`);
        }
    });
});
