import { getEvalErrorPayload, isEvalResultMessage } from '../runtime/bootstrap/messages.js';

const HEARTBEAT_PING_TYPE = 'ping';
const HEARTBEAT_PONG_TYPE = 'pong';
const HEARTBEAT_PONG_MESSAGE = JSON.stringify({ type: HEARTBEAT_PONG_TYPE });
const WEBSOCKET_OPEN_READY_STATE = 1;
const WEBSOCKET_DROPPED_SEND_STATUS = 0;

export interface RelayClient {
  readyState?: number;
  send(message: string): number | void;
}

export function decodeRelayMessage(message: string | ArrayBuffer | Uint8Array): string {
  if (typeof message === 'string') return message;
  if (message instanceof Uint8Array) return new TextDecoder().decode(message);

  return new TextDecoder().decode(new Uint8Array(message));
}

export function createRelayState(log: (message: string) => void = console.log) {
  const clients = new Set<RelayClient>();
  let lastPushedMessage: string | null = null;
  let lastRuntimeErrorMessage: string | null = null;

  function getRelayMessageType(message: string): string | null {
    try {
      const parsed = JSON.parse(message) as { type?: unknown };
      return typeof parsed.type === 'string' ? parsed.type : null;
    } catch {
      return null;
    }
  }

  function pruneClient(client: RelayClient, reason: string) {
    if (!clients.delete(client)) {
      return false;
    }

    log(`[mobile-preview] WS client pruned (${clients.size} total): ${reason}`);
    return true;
  }

  function sendToClient(client: RelayClient, message: string) {
    if (
      typeof client.readyState === 'number' &&
      client.readyState !== WEBSOCKET_OPEN_READY_STATE
    ) {
      pruneClient(client, `readyState=${client.readyState}`);
      return false;
    }

    try {
      const sendStatus = client.send(message);
      if (sendStatus === WEBSOCKET_DROPPED_SEND_STATUS) {
        pruneClient(client, 'message dropped');
        return false;
      }

      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'send failed';
      pruneClient(client, reason);
      return false;
    }
  }

  function sendToClients(message: string) {
    for (const client of Array.from(clients)) {
      sendToClient(client, message);
    }
  }

  return {
    addClient(client: RelayClient) {
      clients.add(client);
      log(`[mobile-preview] WS client connected (${clients.size} total)`);

      if (lastPushedMessage) {
        sendToClient(client, lastPushedMessage);
      }

      if (lastRuntimeErrorMessage && clients.has(client)) {
        sendToClient(client, lastRuntimeErrorMessage);
      }
    },

    removeClient(client: RelayClient) {
      if (!clients.delete(client)) {
        return;
      }

      log(`[mobile-preview] WS client disconnected (${clients.size} total)`);
    },

    broadcastMessage(message: string): number {
      lastPushedMessage = message;
      sendToClients(message);
      return clients.size;
    },

    relayMessage(message: string): number {
      const messageType = getRelayMessageType(message);
      if (messageType === HEARTBEAT_PING_TYPE) {
        sendToClients(HEARTBEAT_PONG_MESSAGE);
        return clients.size;
      }

      if (messageType === HEARTBEAT_PONG_TYPE) {
        return clients.size;
      }

      if (getEvalErrorPayload(message)) {
        lastRuntimeErrorMessage = message;
      } else if (isEvalResultMessage(message)) {
        lastRuntimeErrorMessage = null;
      }

      sendToClients(message);
      return clients.size;
    },

    getClientCount(): number {
      return clients.size;
    },

    getLastPushedMessage(): string | null {
      return lastPushedMessage;
    },

    getLastRuntimeErrorMessage(): string | null {
      return lastRuntimeErrorMessage;
    },
  };
}
