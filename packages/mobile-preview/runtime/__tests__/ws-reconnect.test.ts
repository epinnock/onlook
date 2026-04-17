import { describe, expect, test } from 'bun:test';

const {
  createWebSocketReconnectManager,
  getWebSocketReconnectDelay,
} = require('../bootstrap/ws-reconnect.js');
const { installWebSocketBootstrap } = require('../bootstrap/websocket.js');
const { registerCallableModules } = require('../bootstrap/callable-modules.js');

interface FakeTimer {
  callback: () => void;
  delay: number;
  id: number;
}

interface RuntimeHarness {
  RN$registerCallableModule: (
    name: string,
    factory: () => Record<string, (...args: unknown[]) => unknown>,
  ) => void;
  _markWebSocketConnected?: () => void;
  _scheduleWebSocketReconnect?: (reason?: string) => boolean;
  _tryConnectWebSocket?: (host: string, port: number) => boolean;
  clearTimeout: (id: number) => void;
  nativeModuleProxy: {
    WebSocketModule: {
      addListener: (eventName: string) => void;
      connect: (
        url: string,
        protocols: unknown[],
        options: Record<string, unknown>,
        socketId: number,
      ) => void;
      send: (payload: string, socketId: number) => void;
    };
  };
  setTimeout: (callback: () => void, delay: number) => number;
  wsConnected?: boolean;
}

function createFakeClock() {
  let nextId = 1;
  const timers = new Map<number, FakeTimer>();

  return {
    clearTimeout(id: number) {
      timers.delete(id);
    },

    getDelays() {
      return Array.from(timers.values()).map((timer) => timer.delay);
    },

    runNext() {
      const nextTimer = timers.values().next().value as FakeTimer | undefined;
      if (!nextTimer) {
        throw new Error('No pending timers');
      }

      timers.delete(nextTimer.id);
      nextTimer.callback();
    },

    setTimeout(callback: () => void, delay: number) {
      const id = nextId++;
      timers.set(id, { id, delay, callback });
      return id;
    },
  };
}

describe('websocket reconnect manager', () => {
  test('uses exponential backoff and caps the retry delay', () => {
    const clock = createFakeClock();
    const connectCalls: Array<{ host: string; port: number }> = [];
    const manager = createWebSocketReconnectManager({
      clearTimeout: clock.clearTimeout,
      connect(host: string, port: number) {
        connectCalls.push({ host, port });
      },
      maxDelayMs: 5000,
      setTimeout: clock.setTimeout,
    });

    manager.connectNow('127.0.0.1', 8788);
    expect(connectCalls).toEqual([{ host: '127.0.0.1', port: 8788 }]);

    expect(manager.scheduleReconnect('closed')).toBe(true);
    expect(clock.getDelays()).toEqual([1000]);

    clock.runNext();
    expect(connectCalls).toEqual([
      { host: '127.0.0.1', port: 8788 },
      { host: '127.0.0.1', port: 8788 },
    ]);

    expect(manager.scheduleReconnect('failed')).toBe(true);
    expect(clock.getDelays()).toEqual([2000]);
    clock.runNext();

    expect(manager.scheduleReconnect('failed')).toBe(true);
    expect(clock.getDelays()).toEqual([4000]);
    clock.runNext();

    expect(manager.scheduleReconnect('failed')).toBe(true);
    expect(clock.getDelays()).toEqual([5000]);
  });

  test('deduplicates pending reconnects and resets after a successful open', () => {
    const clock = createFakeClock();
    const manager = createWebSocketReconnectManager({
      clearTimeout: clock.clearTimeout,
      connect() {},
      setTimeout: clock.setTimeout,
    });

    manager.connectNow('127.0.0.1', 8788);
    expect(manager.scheduleReconnect('closed')).toBe(true);
    expect(manager.scheduleReconnect('failed')).toBe(false);
    expect(clock.getDelays()).toEqual([1000]);

    manager.markConnected();
    expect(clock.getDelays()).toEqual([]);

    expect(manager.scheduleReconnect('closed')).toBe(true);
    expect(clock.getDelays()).toEqual([1000]);
  });

  test('wires close and fail events into reconnect attempts for the bootstrap runtime', () => {
    const clock = createFakeClock();
    const connectCalls: Array<{ socketId: number; url: string }> = [];
    const listeners: string[] = [];
    const callableModules: Record<string, Record<string, (...args: unknown[]) => void>> = {};
    const logs: string[] = [];

    const runtimeHarness: RuntimeHarness = {
      RN$registerCallableModule(name, factory) {
        callableModules[name] = factory();
      },
      clearTimeout: clock.clearTimeout,
      nativeModuleProxy: {
        WebSocketModule: {
          addListener(eventName) {
            listeners.push(eventName);
          },
          connect(url, _protocols, _options, socketId) {
            connectCalls.push({ socketId, url });
          },
          send() {},
        },
      },
      setTimeout: clock.setTimeout,
    };

    installWebSocketBootstrap(runtimeHarness, (message: string) => {
      logs.push(message);
    });
    registerCallableModules(runtimeHarness, (message: string) => {
      logs.push(message);
    });

    callableModules.HMRClient?.setup('ios', 'index.bundle', '127.0.0.1', 8081);
    expect(listeners).toEqual([
      'websocketOpen',
      'websocketMessage',
      'websocketClosed',
      'websocketFailed',
    ]);
    expect(connectCalls).toEqual([{ socketId: 42, url: 'ws://127.0.0.1:8788' }]);

    callableModules.RCTDeviceEventEmitter?.emit('websocketClosed', { id: 42 });
    expect(clock.getDelays()).toEqual([1000]);
    clock.runNext();
    expect(connectCalls).toEqual([
      { socketId: 42, url: 'ws://127.0.0.1:8788' },
      { socketId: 42, url: 'ws://127.0.0.1:8788' },
    ]);

    callableModules.RCTDeviceEventEmitter?.emit('websocketFailed', {
      id: 42,
      message: 'network',
    });
    expect(clock.getDelays()).toEqual([2000]);

    callableModules.RCTDeviceEventEmitter?.emit('websocketOpen', { id: 42 });
    expect(clock.getDelays()).toEqual([15000]);

    callableModules.RCTDeviceEventEmitter?.emit('websocketClosed', { id: 42 });
    expect(clock.getDelays()).toEqual([1000]);
    expect(logs.some((message) => message.includes('B13 ws: reconnect in 2000ms'))).toBe(true);
  });

  test('exports the documented reconnect delay sequence', () => {
    expect([
      getWebSocketReconnectDelay(1),
      getWebSocketReconnectDelay(2),
      getWebSocketReconnectDelay(3),
      getWebSocketReconnectDelay(4),
      getWebSocketReconnectDelay(10),
    ]).toEqual([1000, 2000, 4000, 8000, 30000]);
  });
});
