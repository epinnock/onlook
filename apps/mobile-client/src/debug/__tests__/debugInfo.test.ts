/**
 * Tests for the debug info collector.
 *
 * Task: MC3.18
 * Validate: bun test apps/mobile-client/src/debug/__tests__/debugInfo.test.ts
 */

import { describe, expect, test } from 'bun:test';
import { ONLOOK_RUNTIME_VERSION } from '@onlook/mobile-client-protocol';
import { DebugInfoCollector } from '../debugInfo';

describe('DebugInfoCollector', () => {
    test('addLog caps buffer at 50 entries (FIFO)', () => {
        const collector = new DebugInfoCollector();
        for (let i = 0; i < 75; i++) {
            collector.addLog(`line-${i}`);
        }
        const { recentLogs } = collector.collect();
        expect(recentLogs.length).toBe(50);
        // Oldest 25 should be dropped; first remaining log is line-25.
        expect(recentLogs[0]).toBe('line-25');
        expect(recentLogs[recentLogs.length - 1]).toBe('line-74');
    });

    test('setSession stores sessionId and relayHost', () => {
        const collector = new DebugInfoCollector();
        collector.setSession('sess-abc', 'relay.local:4096');
        const info = collector.collect();
        expect(info.sessionId).toBe('sess-abc');
        expect(info.relayHost).toBe('relay.local:4096');
    });

    test('collect returns a complete snapshot of collector state', () => {
        const collector = new DebugInfoCollector();
        collector.setSession('sess-1', 'host:1234');
        collector.setManifest({ name: 'app', entry: 'index.js' });
        collector.addLog('hello');
        const info = collector.collect();
        expect(info).toEqual({
            sessionId: 'sess-1',
            relayHost: 'host:1234',
            clientVersion: ONLOOK_RUNTIME_VERSION,
            runtimeVersion: ONLOOK_RUNTIME_VERSION,
            manifest: { name: 'app', entry: 'index.js' },
            recentLogs: ['hello'],
        });
    });

    test('clear resets session, manifest, and logs to initial state', () => {
        const collector = new DebugInfoCollector();
        collector.setSession('sess-1', 'host:1234');
        collector.setManifest({ name: 'app' });
        collector.addLog('a');
        collector.addLog('b');
        collector.clear();
        const info = collector.collect();
        expect(info.sessionId).toBeNull();
        expect(info.relayHost).toBeNull();
        expect(info.manifest).toBeNull();
        expect(info.recentLogs).toEqual([]);
    });

    test('clientVersion is sourced from @onlook/mobile-client-protocol', () => {
        const collector = new DebugInfoCollector();
        const info = collector.collect();
        expect(info.clientVersion).toBe(ONLOOK_RUNTIME_VERSION);
        expect(info.runtimeVersion).toBe(ONLOOK_RUNTIME_VERSION);
    });

    test('recentLogs is a defensive copy (mutating result does not affect collector)', () => {
        const collector = new DebugInfoCollector();
        collector.addLog('one');
        collector.addLog('two');
        const first = collector.collect();
        first.recentLogs.push('tampered');
        first.recentLogs[0] = 'mutated';
        const second = collector.collect();
        expect(second.recentLogs).toEqual(['one', 'two']);
        expect(second.recentLogs).not.toBe(first.recentLogs);
    });
});
