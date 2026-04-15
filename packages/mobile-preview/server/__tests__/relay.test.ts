import { describe, expect, test } from 'bun:test';

import { createRelayState, type RelayClient } from '../relay';

function createClient() {
  const messages: string[] = [];

  const client: RelayClient = {
    send(message) {
      messages.push(message);
    },
  };

  return { client, messages };
}

describe('createRelayState', () => {
  test('stores and replays the latest runtime eval error to late joiners', () => {
    const relay = createRelayState(() => undefined);
    const first = createClient();

    relay.addClient(first.client);
    relay.broadcastMessage('{"type":"eval","code":"render()"}');
    relay.relayMessage('{"type":"evalError","error":"Unexpected token <"}');

    expect(first.messages).toEqual([
      '{"type":"eval","code":"render()"}',
      '{"type":"evalError","error":"Unexpected token <"}',
    ]);
    expect(relay.getLastRuntimeErrorMessage()).toBe(
      '{"type":"evalError","error":"Unexpected token <"}',
    );

    const lateJoiner = createClient();
    relay.addClient(lateJoiner.client);

    expect(lateJoiner.messages).toEqual([
      '{"type":"eval","code":"render()"}',
      '{"type":"evalError","error":"Unexpected token <"}',
    ]);
  });

  test('clears the cached runtime eval error after a successful eval result', () => {
    const relay = createRelayState(() => undefined);
    const client = createClient();

    relay.addClient(client.client);
    relay.relayMessage('{"type":"evalError","error":"boom"}');
    relay.relayMessage('{"type":"evalResult","result":"ok"}');

    expect(relay.getLastRuntimeErrorMessage()).toBeNull();

    const lateJoiner = createClient();
    relay.addClient(lateJoiner.client);

    expect(lateJoiner.messages).toEqual([]);
  });
});
