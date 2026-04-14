export interface RelayClient {
  send(message: string): void;
}

export function decodeRelayMessage(message: string | ArrayBuffer | Uint8Array): string {
  if (typeof message === 'string') return message;
  if (message instanceof Uint8Array) return new TextDecoder().decode(message);

  return new TextDecoder().decode(new Uint8Array(message));
}

export function createRelayState(log: (message: string) => void = console.log) {
  const clients = new Set<RelayClient>();
  let lastPushedMessage: string | null = null;

  function sendToClients(message: string) {
    for (const client of clients) {
      try {
        client.send(message);
      } catch {}
    }
  }

  return {
    addClient(client: RelayClient) {
      clients.add(client);
      log(`[mobile-preview] WS client connected (${clients.size} total)`);

      if (lastPushedMessage) {
        try {
          client.send(lastPushedMessage);
        } catch {}
      }
    },

    removeClient(client: RelayClient) {
      clients.delete(client);
      log(`[mobile-preview] WS client disconnected (${clients.size} total)`);
    },

    broadcastMessage(message: string): number {
      lastPushedMessage = message;
      sendToClients(message);
      return clients.size;
    },

    relayMessage(message: string): number {
      sendToClients(message);
      return clients.size;
    },

    getClientCount(): number {
      return clients.size;
    },

    getLastPushedMessage(): string | null {
      return lastPushedMessage;
    },
  };
}
