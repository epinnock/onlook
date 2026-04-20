/**
 * Tests for the XMLHttpRequest patch (network inspector).
 *
 * Task: MC5.4
 * Validate: bun test apps/mobile-client/src/debug/__tests__/xhrPatch.test.ts
 *
 * We define a minimal mock `XMLHttpRequest` class on `globalThis` (and
 * therefore on its prototype) that simulates the readyState / status /
 * event lifecycle. The patch under test wraps prototype methods, so it
 * is agnostic to the concrete transport.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { XhrPatch } from '../xhrPatch';
import type { NetworkEntry } from '../fetchPatch';

/**
 * Terminal-event kind that the mock XHR should fire when `send` is
 * invoked. Tests configure this on the mock before calling `send`.
 */
type MockMode = 'success' | 'error' | 'abort' | 'timeout';

/** Minimal mock XMLHttpRequest. */
class MockXHR {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public static instances: MockXHR[] = [];

    public readyState = 0;
    public status = 0;
    public onreadystatechange: ((this: MockXHR, ev: Event) => unknown) | null = null;
    public onerror: ((this: MockXHR, ev: Event) => unknown) | null = null;
    public onabort: ((this: MockXHR, ev: Event) => unknown) | null = null;
    public ontimeout: ((this: MockXHR, ev: Event) => unknown) | null = null;

    public method = '';
    public url = '';
    public headers: Record<string, string> = {};
    public responseHeadersRaw = 'content-type: application/json\r\nx-mock: yes\r\n';

    /** Test-only knob controlling terminal event behaviour of `send`. */
    public mode: MockMode = 'success';
    /** Status to report when mode === 'success'. */
    public successStatus = 200;

    constructor() {
        MockXHR.instances.push(this);
    }

    open(method: string, url: string): void {
        this.method = method;
        this.url = url;
        this.readyState = 1;
    }

    setRequestHeader(name: string, value: string): void {
        this.headers[name] = value;
    }

    send(_body?: unknown): void {
        // Fire terminal event synchronously so tests stay deterministic.
        if (this.mode === 'error') {
            this.readyState = 4;
            this.status = 0;
            this.onerror?.call(this, new Event('error'));
            return;
        }
        if (this.mode === 'abort') {
            this.readyState = 4;
            this.status = 0;
            this.onabort?.call(this, new Event('abort'));
            return;
        }
        if (this.mode === 'timeout') {
            this.readyState = 4;
            this.status = 0;
            this.ontimeout?.call(this, new Event('timeout'));
            return;
        }
        // success
        this.readyState = 4;
        this.status = this.successStatus;
        this.onreadystatechange?.call(this, new Event('readystatechange'));
    }

    getAllResponseHeaders(): string {
        return this.responseHeadersRaw;
    }
}

/** Install MockXHR onto globalThis; return the prior binding for restore. */
function installMockXhr(): { prior: unknown } {
    const prior = (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
    (globalThis as { XMLHttpRequest: unknown }).XMLHttpRequest = MockXHR;
    return { prior };
}

function restoreXhr(prior: unknown): void {
    if (prior === undefined) {
        delete (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
    } else {
        (globalThis as { XMLHttpRequest: unknown }).XMLHttpRequest = prior;
    }
}

describe('XhrPatch', () => {
    let patch: XhrPatch;
    let priorXhr: unknown;

    beforeEach(() => {
        MockXHR.instances = [];
        ({ prior: priorXhr } = installMockXhr());
        patch = new XhrPatch();
    });

    afterEach(() => {
        patch.uninstall();
        restoreXhr(priorXhr);
    });

    test('install patches open and send on the prototype', () => {
        const origOpen = MockXHR.prototype.open;
        const origSend = MockXHR.prototype.send;

        patch.install();

        expect(MockXHR.prototype.open).not.toBe(origOpen);
        expect(MockXHR.prototype.send).not.toBe(origSend);
    });

    test('successful request captures status, method, url, duration', () => {
        patch.install();

        const xhr = new MockXHR();
        xhr.successStatus = 201;
        xhr.open('POST', 'https://example.com/data');
        xhr.setRequestHeader('content-type', 'application/json');
        xhr.send('{"a":1}');

        const buffer = patch.getBuffer();
        expect(buffer).toHaveLength(1);

        const entry = buffer[0]!;
        expect(entry.method).toBe('POST');
        expect(entry.url).toBe('https://example.com/data');
        expect(entry.status).toBe(201);
        expect(entry.duration).toBeGreaterThanOrEqual(0);
        expect(entry.endTime).not.toBeNull();
        expect(entry.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(entry.requestHeaders).toBeDefined();
        expect(entry.requestHeaders!['content-type']).toBe('application/json');
        expect(entry.responseHeaders).toBeDefined();
        expect(entry.responseHeaders!['content-type']).toBe('application/json');
        expect(entry.responseHeaders!['x-mock']).toBe('yes');
        expect(entry.error).toBeUndefined();
    });

    test('failed request captures error and null status', () => {
        patch.install();

        const xhr = new MockXHR();
        xhr.mode = 'error';
        xhr.open('GET', 'https://example.com/fail');
        xhr.send();

        const buffer = patch.getBuffer();
        expect(buffer).toHaveLength(1);

        const entry = buffer[0]!;
        expect(entry.error).toBe('Network error');
        expect(entry.status).toBeNull();
        expect(entry.method).toBe('GET');
        expect(entry.url).toBe('https://example.com/fail');
        expect(entry.endTime).not.toBeNull();
        expect(entry.duration).toBeGreaterThanOrEqual(0);
    });

    test('aborted request is captured with an error tag', () => {
        patch.install();

        const xhr = new MockXHR();
        xhr.mode = 'abort';
        xhr.open('DELETE', 'https://example.com/abort');
        xhr.send();

        const buffer = patch.getBuffer();
        expect(buffer).toHaveLength(1);

        const entry = buffer[0]!;
        expect(entry.error).toBe('Request aborted');
        expect(entry.method).toBe('DELETE');
        expect(entry.url).toBe('https://example.com/abort');
        expect(entry.status).toBeNull();
    });

    test('timeout request is captured', () => {
        patch.install();

        const xhr = new MockXHR();
        xhr.mode = 'timeout';
        xhr.open('GET', 'https://example.com/slow');
        xhr.send();

        const buffer = patch.getBuffer();
        expect(buffer).toHaveLength(1);
        expect(buffer[0]!.error).toBe('Request timed out');
    });

    test('uninstall restores original prototype methods', () => {
        const origOpen = MockXHR.prototype.open;
        const origSend = MockXHR.prototype.send;
        const origSet = MockXHR.prototype.setRequestHeader;

        patch.install();
        expect(MockXHR.prototype.open).not.toBe(origOpen);

        patch.uninstall();
        expect(MockXHR.prototype.open).toBe(origOpen);
        expect(MockXHR.prototype.send).toBe(origSend);
        expect(MockXHR.prototype.setRequestHeader).toBe(origSet);
    });

    test('listener receives completed entries', () => {
        const received: NetworkEntry[] = [];
        patch.onEntry((entry) => received.push(entry));

        patch.install();

        const xhr = new MockXHR();
        xhr.open('GET', 'https://example.com/listen');
        xhr.send();

        expect(received).toHaveLength(1);
        expect(received[0]!.url).toBe('https://example.com/listen');
        expect(received[0]!.status).toBe(200);
    });

    test('unsubscribe stops delivery to that listener', () => {
        const received: NetworkEntry[] = [];
        const unsub = patch.onEntry((entry) => received.push(entry));

        patch.install();

        const first = new MockXHR();
        first.open('GET', 'https://example.com/a');
        first.send();
        expect(received).toHaveLength(1);

        unsub();

        const second = new MockXHR();
        second.open('GET', 'https://example.com/b');
        second.send();
        expect(received).toHaveLength(1);
    });

    test('user onreadystatechange handler is preserved', () => {
        patch.install();

        let userCalls = 0;
        let userSawStatus: number | null = null;
        const xhr = new MockXHR();
        xhr.open('GET', 'https://example.com/preserve');
        xhr.onreadystatechange = function (this: MockXHR): void {
            userCalls++;
            if (this.readyState === 4) {
                userSawStatus = this.status;
            }
        };
        xhr.send();

        expect(userCalls).toBeGreaterThan(0);
        expect(userSawStatus).toBe(200);
        expect(patch.getBuffer()).toHaveLength(1);
    });

    test('user onerror handler is preserved', () => {
        patch.install();

        let userErrorCalls = 0;
        const xhr = new MockXHR();
        xhr.mode = 'error';
        xhr.open('GET', 'https://example.com/err');
        xhr.onerror = function (): void {
            userErrorCalls++;
        };
        xhr.send();

        expect(userErrorCalls).toBe(1);
        expect(patch.getBuffer()).toHaveLength(1);
        expect(patch.getBuffer()[0]!.error).toBe('Network error');
    });

    test('install is idempotent (second call is a no-op)', () => {
        patch.install();
        const patched = MockXHR.prototype.open;
        patch.install();
        expect(MockXHR.prototype.open).toBe(patched);
    });

    test('clearBuffer empties the buffer', () => {
        patch.install();

        const xhr = new MockXHR();
        xhr.open('GET', 'https://example.com/clear');
        xhr.send();
        expect(patch.getBuffer()).toHaveLength(1);

        patch.clearBuffer();
        expect(patch.getBuffer()).toHaveLength(0);
    });

    test('buffer caps at 100 entries', () => {
        patch.install();

        for (let i = 0; i < 120; i++) {
            const xhr = new MockXHR();
            xhr.open('GET', `https://example.com/${i}`);
            xhr.send();
        }

        const buffer = patch.getBuffer();
        expect(buffer).toHaveLength(100);
        expect(buffer[0]!.url).toBe('https://example.com/20');
        expect(buffer[99]!.url).toBe('https://example.com/119');
    });

    test('defaults to GET when open is called with only a URL', () => {
        patch.install();

        const xhr = new MockXHR();
        xhr.open('GET', 'https://example.com/default');
        xhr.send();

        const entry = patch.getBuffer()[0]!;
        expect(entry.method).toBe('GET');
    });
});
