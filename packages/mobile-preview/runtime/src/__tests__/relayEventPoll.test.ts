import { beforeEach, describe, expect, mock, test } from 'bun:test';

import {
    startRelayEventPoll,
    type HttpGetFn,
    type HttpGetResult,
    type RelayEvent,
} from '../relayEventPoll';

/**
 * Mock timer harness — captures scheduled callbacks without actually
 * waiting for real time to elapse. Each call to `runNextTick()` drains one
 * queued callback so we can walk the poll loop step-by-step.
 */
function makeMockTimer() {
    type Pending = { id: number; fn: () => void; delay: number };
    let nextId = 1;
    const pending: Pending[] = [];
    const setTimeoutFn = (fn: () => void, delay: number): unknown => {
        const id = nextId++;
        pending.push({ id, fn, delay });
        return id;
    };
    const clearTimeoutFn = (handle: unknown): void => {
        const idx = pending.findIndex((p) => p.id === handle);
        if (idx >= 0) pending.splice(idx, 1);
    };
    const runNextTick = (): boolean => {
        const next = pending.shift();
        if (!next) return false;
        next.fn();
        return true;
    };
    const pendingCount = (): number => pending.length;
    return { setTimeoutFn, clearTimeoutFn, runNextTick, pendingCount };
}

function okResult(body: string): HttpGetResult {
    return { ok: true, status: 200, body, contentType: 'application/json' };
}

describe('startRelayEventPoll', () => {
    let timer: ReturnType<typeof makeMockTimer>;
    let events: RelayEvent[];
    let errors: Error[];

    beforeEach(() => {
        timer = makeMockTimer();
        events = [];
        errors = [];
    });

    test('initial poll runs synchronously on start', () => {
        const httpGet = mock<HttpGetFn>(() => okResult('{"events":[],"cursor":"c0"}'));
        const handle = startRelayEventPoll({
            relayHost: 'http://relay.example.com/events',
            sessionId: 'sess-1',
            httpGet,
            onEvent: (e) => events.push(e),
            onError: (e) => errors.push(e),
            setTimeout: timer.setTimeoutFn,
            clearTimeout: timer.clearTimeoutFn,
        });
        expect(httpGet).toHaveBeenCalledTimes(1);
        expect(handle.getCursor()).toBe('c0');
        handle.stop();
    });

    test('events dispatched in order, cursor advances', () => {
        const responses = [
            '{"events":[{"id":"e1","type":"ack","data":{"ok":true}}],"cursor":"c1"}',
            '{"events":[{"id":"e2","type":"bundleUpdate","data":{}}],"cursor":"c2"}',
        ];
        let i = 0;
        const httpGet = mock<HttpGetFn>(() => okResult(responses[i++] ?? '{"events":[]}'));
        const handle = startRelayEventPoll({
            relayHost: 'http://relay/events',
            sessionId: 's',
            httpGet,
            onEvent: (e) => events.push(e),
            setTimeout: timer.setTimeoutFn,
            clearTimeout: timer.clearTimeoutFn,
        });
        timer.runNextTick(); // second poll
        expect(events.length).toBe(2);
        expect(events[0]?.id).toBe('e1');
        expect(events[1]?.id).toBe('e2');
        expect(handle.getCursor()).toBe('c2');
        handle.stop();
    });

    test('URL encodes session + cursor as query params', () => {
        let capturedUrl = '';
        const httpGet: HttpGetFn = (url) => {
            capturedUrl = url;
            return okResult('{"events":[],"cursor":"c1"}');
        };
        const handle = startRelayEventPoll({
            relayHost: 'http://relay/events',
            sessionId: 'sess with spaces',
            httpGet,
            onEvent: () => {},
            setTimeout: timer.setTimeoutFn,
            clearTimeout: timer.clearTimeoutFn,
        });
        expect(capturedUrl).toBe('http://relay/events?session=sess%20with%20spaces');
        timer.runNextTick(); // second poll with cursor=c1
        expect(capturedUrl).toBe(
            'http://relay/events?session=sess%20with%20spaces&since=c1',
        );
        handle.stop();
    });

    test('uses existing query-param separator correctly', () => {
        let capturedUrl = '';
        const httpGet: HttpGetFn = (url) => {
            capturedUrl = url;
            return okResult('{"events":[]}');
        };
        const handle = startRelayEventPoll({
            relayHost: 'http://relay/events?format=json',
            sessionId: 's',
            httpGet,
            onEvent: () => {},
            setTimeout: timer.setTimeoutFn,
            clearTimeout: timer.clearTimeoutFn,
        });
        expect(capturedUrl).toBe('http://relay/events?format=json&session=s');
        handle.stop();
    });

    test('stop prevents further polls', () => {
        const httpGet = mock<HttpGetFn>(() => okResult('{"events":[],"cursor":"c1"}'));
        const handle = startRelayEventPoll({
            relayHost: 'http://relay',
            sessionId: 's',
            httpGet,
            onEvent: () => {},
            setTimeout: timer.setTimeoutFn,
            clearTimeout: timer.clearTimeoutFn,
        });
        expect(httpGet).toHaveBeenCalledTimes(1);
        handle.stop();
        // Any queued callback should be cancelled and not re-issue.
        expect(timer.pendingCount()).toBe(0);
    });

    test('httpGet throwing surfaces via onError, loop continues', () => {
        let callIdx = 0;
        const httpGet: HttpGetFn = () => {
            callIdx += 1;
            if (callIdx === 1) throw new Error('network down');
            return okResult('{"events":[{"id":"e1","type":"x","data":null}],"cursor":"c1"}');
        };
        const handle = startRelayEventPoll({
            relayHost: 'http://relay',
            sessionId: 's',
            httpGet,
            onEvent: (e) => events.push(e),
            onError: (e) => errors.push(e),
            setTimeout: timer.setTimeoutFn,
            clearTimeout: timer.clearTimeoutFn,
        });
        expect(errors.length).toBe(1);
        expect(errors[0]?.message).toBe('network down');
        timer.runNextTick(); // retry
        expect(events.length).toBe(1);
        handle.stop();
    });

    test('non-ok HTTP status surfaces via onError', () => {
        const httpGet: HttpGetFn = () => ({
            ok: false,
            status: 503,
            body: '',
            contentType: 'text/plain',
        });
        const handle = startRelayEventPoll({
            relayHost: 'http://relay',
            sessionId: 's',
            httpGet,
            onEvent: () => {},
            onError: (e) => errors.push(e),
            setTimeout: timer.setTimeoutFn,
            clearTimeout: timer.clearTimeoutFn,
        });
        expect(errors.length).toBe(1);
        expect(errors[0]?.message).toBe('relay events HTTP 503');
        handle.stop();
    });

    test('httpGet returning error field surfaces via onError', () => {
        const httpGet: HttpGetFn = () => ({
            ok: false,
            status: 0,
            body: '',
            contentType: '',
            error: 'nssurlerror -1009',
        });
        const handle = startRelayEventPoll({
            relayHost: 'http://relay',
            sessionId: 's',
            httpGet,
            onEvent: () => {},
            onError: (e) => errors.push(e),
            setTimeout: timer.setTimeoutFn,
            clearTimeout: timer.clearTimeoutFn,
        });
        expect(errors[0]?.message).toBe('nssurlerror -1009');
        handle.stop();
    });

    test('malformed JSON surfaces via onError', () => {
        const httpGet: HttpGetFn = () => okResult('not-json');
        const handle = startRelayEventPoll({
            relayHost: 'http://relay',
            sessionId: 's',
            httpGet,
            onEvent: () => {},
            onError: (e) => errors.push(e),
            setTimeout: timer.setTimeoutFn,
            clearTimeout: timer.clearTimeoutFn,
        });
        expect(errors.length).toBe(1);
        handle.stop();
    });

    test('duplicate event ids are filtered (seen-Set dedup)', () => {
        const responses = [
            '{"events":[{"id":"e1","type":"x","data":null}],"cursor":"c1"}',
            '{"events":[{"id":"e1","type":"x","data":null},{"id":"e2","type":"x","data":null}],"cursor":"c2"}',
        ];
        let i = 0;
        const httpGet: HttpGetFn = () => okResult(responses[i++] ?? '{"events":[]}');
        const handle = startRelayEventPoll({
            relayHost: 'http://relay',
            sessionId: 's',
            httpGet,
            onEvent: (e) => events.push(e),
            setTimeout: timer.setTimeoutFn,
            clearTimeout: timer.clearTimeoutFn,
        });
        timer.runNextTick();
        expect(events.length).toBe(2);
        expect(events[0]?.id).toBe('e1');
        expect(events[1]?.id).toBe('e2');
        expect(handle.getSeenCount()).toBe(2);
        handle.stop();
    });

    test('events missing id or type are skipped silently', () => {
        const httpGet: HttpGetFn = () =>
            okResult(
                '{"events":[{"type":"no-id"},{"id":"ok","type":"t","data":1},{"id":"no-type"}],"cursor":"c1"}',
            );
        const handle = startRelayEventPoll({
            relayHost: 'http://relay',
            sessionId: 's',
            httpGet,
            onEvent: (e) => events.push(e),
            onError: (e) => errors.push(e),
            setTimeout: timer.setTimeoutFn,
            clearTimeout: timer.clearTimeoutFn,
        });
        expect(events.length).toBe(1);
        expect(events[0]?.id).toBe('ok');
        expect(errors.length).toBe(0);
        handle.stop();
    });

    test('onEvent throwing does not break the dispatch of later events', () => {
        const httpGet: HttpGetFn = () =>
            okResult(
                '{"events":[{"id":"e1","type":"x","data":null},{"id":"e2","type":"x","data":null}],"cursor":"c1"}',
            );
        const handle = startRelayEventPoll({
            relayHost: 'http://relay',
            sessionId: 's',
            httpGet,
            onEvent: (e) => {
                events.push(e);
                if (e.id === 'e1') throw new Error('bad handler');
            },
            onError: (e) => errors.push(e),
            setTimeout: timer.setTimeoutFn,
            clearTimeout: timer.clearTimeoutFn,
        });
        expect(events.length).toBe(2);
        expect(errors.length).toBe(1);
        expect(errors[0]?.message).toBe('bad handler');
        handle.stop();
    });

    test('stop is idempotent', () => {
        const httpGet: HttpGetFn = () => okResult('{"events":[]}');
        const handle = startRelayEventPoll({
            relayHost: 'http://relay',
            sessionId: 's',
            httpGet,
            onEvent: () => {},
            setTimeout: timer.setTimeoutFn,
            clearTimeout: timer.clearTimeoutFn,
        });
        expect(() => {
            handle.stop();
            handle.stop();
        }).not.toThrow();
    });
});
