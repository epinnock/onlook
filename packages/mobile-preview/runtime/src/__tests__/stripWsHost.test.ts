import { describe, expect, test } from 'bun:test';

import { stripWsHost } from '../stripWsHost';

describe('stripWsHost', () => {
    test('passes bare hostnames through unchanged', () => {
        expect(stripWsHost('localhost')).toBe('localhost');
        expect(stripWsHost('192.168.0.17')).toBe('192.168.0.17');
        expect(stripWsHost('relay.example.com')).toBe('relay.example.com');
    });

    test('strips http scheme + port', () => {
        expect(stripWsHost('http://localhost:8787')).toBe('localhost');
        expect(stripWsHost('http://192.168.0.17:18999')).toBe('192.168.0.17');
    });

    test('strips https scheme + port', () => {
        expect(stripWsHost('https://relay.example.com:443')).toBe('relay.example.com');
    });

    test('strips ws / wss schemes', () => {
        expect(stripWsHost('ws://relay.example.com:8888')).toBe('relay.example.com');
        expect(stripWsHost('wss://relay.example.com:8888')).toBe('relay.example.com');
    });

    test('strips scheme + path (manifest endpoint pattern)', () => {
        expect(stripWsHost('http://192.168.0.17:18999/manifest/abc')).toBe('192.168.0.17');
        expect(stripWsHost('https://relay.example.com/manifest/abc?x=1')).toBe(
            'relay.example.com',
        );
    });

    test('strips scheme when no port is supplied', () => {
        expect(stripWsHost('http://relay.example.com/path')).toBe('relay.example.com');
    });

    test('returns input as-is for non-string input', () => {
        expect(stripWsHost(undefined as unknown as string)).toBeUndefined();
        expect(stripWsHost(null as unknown as string)).toBeNull();
        expect(stripWsHost(42 as unknown as string)).toBe(42 as unknown as string);
    });

    test('returns empty string unchanged', () => {
        expect(stripWsHost('')).toBe('');
    });

    test('hostnames with trailing slash keep only the host', () => {
        expect(stripWsHost('http://localhost/')).toBe('localhost');
    });

    test('IPv4 with embedded port', () => {
        expect(stripWsHost('http://127.0.0.1:8787')).toBe('127.0.0.1');
    });
});
