import { describe, expect, test } from 'bun:test';

import { createRelayState, type RelayClient } from '../relay';

const HEARTBEAT_PONG_MESSAGE = JSON.stringify({ type: 'pong' });

interface TestClientOptions {
  readyState?: number;
  sendStatus?: number;
}

function createClient(options: TestClientOptions = {}) {
  const messages: string[] = [];
  let sendCount = 0;

  const client: RelayClient = {
    readyState: options.readyState,
    send(message) {
      sendCount += 1;

      if (options.sendStatus === 0) {
        return 0;
      }

      messages.push(message);
      return options.sendStatus;
    },
  };

  return {
    client,
    messages,
    getSendCount() {
      return sendCount;
    },
  };
}

describe('createRelayState heartbeat handling', () => {
  test('responds to heartbeat pings with pong without clearing cached runtime errors', () => {
    const relay = createRelayState(() => undefined);
    const first = createClient();
    const second = createClient();

    relay.addClient(first.client);
    relay.addClient(second.client);
    relay.relayMessage('{"type":"evalError","error":"boom"}');

    first.messages.splice(0);
    second.messages.splice(0);

    expect(relay.relayMessage('{"type":"ping"}')).toBe(2);
    expect(first.messages).toEqual([HEARTBEAT_PONG_MESSAGE]);
    expect(second.messages).toEqual([HEARTBEAT_PONG_MESSAGE]);
    expect(relay.getLastRuntimeErrorMessage()).toBe('{"type":"evalError","error":"boom"}');
  });

  test('prunes stale clients during heartbeat fanout', () => {
    const relay = createRelayState(() => undefined);
    const healthy = createClient();
    const closed = createClient({ readyState: 3 });
    const dropped = createClient({ sendStatus: 0 });

    relay.addClient(healthy.client);
    relay.addClient(closed.client);
    relay.addClient(dropped.client);

    expect(relay.relayMessage('{"type":"ping"}')).toBe(1);
    expect(relay.getClientCount()).toBe(1);
    expect(healthy.messages).toEqual([HEARTBEAT_PONG_MESSAGE]);
    expect(closed.getSendCount()).toBe(0);
    expect(dropped.getSendCount()).toBe(1);
    expect(dropped.messages).toEqual([]);
  });
});
