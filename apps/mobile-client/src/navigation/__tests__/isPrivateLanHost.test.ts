import { describe, expect, test } from 'bun:test';

import { isPrivateLanHost } from '../private-lan';

describe('isPrivateLanHost', () => {
    describe('private RFC-1918 IPv4 + loopback (returns true)', () => {
        const cases: ReadonlyArray<[label: string, host: string]> = [
            ['10.0.0.0', '10.0.0.0'],
            ['10.0.0.1', '10.0.0.1'],
            ['10.255.255.255', '10.255.255.255'],
            ['172.16.0.1', '172.16.0.1'],
            ['172.31.255.255', '172.31.255.255'],
            ['192.168.0.1', '192.168.0.1'],
            ['192.168.0.14 (this Mac in the e2e session)', '192.168.0.14'],
            ['192.168.0.17 (the Mac mini)', '192.168.0.17'],
            ['192.168.255.255', '192.168.255.255'],
            ['127.0.0.1', '127.0.0.1'],
            ['127.255.255.255', '127.255.255.255'],
            ['localhost (string literal)', 'localhost'],
            ['192.168.0.14:8787 (with port)', '192.168.0.14:8787'],
            ['10.0.0.1:1234 (with port)', '10.0.0.1:1234'],
        ];
        for (const [label, host] of cases) {
            test(label, () => {
                expect(isPrivateLanHost(host)).toBe(true);
            });
        }
    });

    describe('public + edge-of-RFC-1918 hosts (returns false)', () => {
        const cases: ReadonlyArray<[label: string, host: string]> = [
            ['172.15.0.1 (just below the 172.16-31 range)', '172.15.0.1'],
            ['172.32.0.1 (just above)', '172.32.0.1'],
            ['11.0.0.1 (just outside 10/8)', '11.0.0.1'],
            ['9.0.0.1 (just outside 10/8 low)', '9.0.0.1'],
            ['192.167.0.1 (just below 192.168/16)', '192.167.0.1'],
            ['192.169.0.1 (just above)', '192.169.0.1'],
            ['8.8.8.8 (public DNS)', '8.8.8.8'],
            ['1.1.1.1 (the preflight target)', '1.1.1.1'],
            ['esm.sh', 'esm.sh'],
            ['expo.dev', 'expo.dev'],
            ['onlook.com', 'onlook.com'],
            ['expo.dev:443 (with port)', 'expo.dev:443'],
            ['127a.0.0.1 (malformed — not all-numeric)', '127a.0.0.1'],
            ['empty string', ''],
            ['random text', 'just-a-name'],
        ];
        for (const [label, host] of cases) {
            test(label, () => {
                expect(isPrivateLanHost(host)).toBe(false);
            });
        }
    });

    describe('IPv6 (returns false — current scope is IPv4 only)', () => {
        const cases: ReadonlyArray<[label: string, host: string]> = [
            // ::1 is the IPv6 loopback. The function intentionally only
            // recognises IPv4 forms today; if we extend to IPv6 later, this
            // test should flip to expect(true).
            ['::1', '::1'],
            ['fe80::1', 'fe80::1'],
        ];
        for (const [label, host] of cases) {
            test(label, () => {
                expect(isPrivateLanHost(host)).toBe(false);
            });
        }
    });
});
