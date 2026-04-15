import { describe, expect, test } from 'bun:test';

const {
  DEFAULT_PING_INTERVAL_MS,
  DEFAULT_PING_TIMEOUT_MS,
  createWebSocketKeepaliveManager,
} = require('../bootstrap/keepalive.js');
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
  clearTimeout: (id: number) => void;
  nativeModuleProxy: {
    WebSocketModule: {
      addListener: (eventName: string) => void;
      close?: (socketId: number) => void;
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
      return Array.from(timers.values())
        .map((timer) => timer.delay)
        .sort((left, right) => left - right);
    },

    runNext() {
      const nextTimer = Array.from(timers.values()).sort(
        (left, right) => left.delay - right.delay || left.id - right.id,
      )[0];
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

describe('websocket keepalive manager', () => {
  test('sends keepalive pings and marks the socket dead after a timeout', () => {
    const clock = createFakeClock();
    const deadReasons: string[] = [];
    const sentPayloads: string[] = [];
    const manager = createWebSocketKeepaliveManager({
      clearTimeout: clock.clearTimeout,
      handleDeadConnection(reason: string) {
        deadReasons.push(reason);
      },
      sendPing() {
        sentPayloads.push('ping');
      },
      setTimeout: clock.setTimeout,
    });

    manager.markConnected();
    expect(manager.getState()).toEqual({
      connected: true,
      hasPendingPing: true,
      hasPendingTimeout: false,
      waitingForActivity: false,
    });
    expect(clock.getDelays()).toEqual([DEFAULT_PING_INTERVAL_MS]);

    clock.runNext();
    expect(sentPayloads).toEqual(['ping']);
    expect(manager.getState()).toEqual({
      connected: true,
      hasPendingPing: false,
      hasPendingTimeout: true,
      waitingForActivity: true,
    });
    expect(clock.getDelays()).toEqual([DEFAULT_PING_TIMEOUT_MS]);

    clock.runNext();
    expect(deadReasons).toEqual(['keepalive timeout']);
    expect(manager.getState()).toEqual({
      connected: false,
      hasPendingPing: false,
      hasPendingTimeout: false,
      waitingForActivity: false,
    });
  });

  test('treats any inbound activity as a heartbeat and reschedules the next ping', () => {
    const clock = createFakeClock();
    const sentPayloads: string[] = [];
    const manager = createWebSocketKeepaliveManager({
      clearTimeout: clock.clearTimeout,
      sendPing() {
        sentPayloads.push('ping');
      },
      setTimeout: clock.setTimeout,
    });

    manager.markConnected();
    clock.runNext();
    expect(clock.getDelays()).toEqual([DEFAULT_PING_TIMEOUT_MS]);

    expect(manager.markActivity()).toBe(true);
    expect(manager.getState()).toEqual({
      connected: true,
      hasPendingPing: true,
      hasPendingTimeout: false,
      waitingForActivity: false,
    });
    expect(clock.getDelays()).toEqual([DEFAULT_PING_INTERVAL_MS]);

    clock.runNext();
    expect(sentPayloads).toEqual(['ping', 'ping']);
  });

  test('wires runtime keepalive into the websocket bootstrap', () => {
    const clock = createFakeClock();
    const closeCalls: number[] = [];
    const connectCalls: Array<{ socketId: number; url: string }> = [];
    const listeners: string[] = [];
    const sentPayloads: Array<{ payload: string; socketId: number }> = [];
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
          close(socketId) {
            closeCalls.push(socketId);
          },
          connect(url, _protocols, _options, socketId) {
            connectCalls.push({ socketId, url });
          },
          send(payload, socketId) {
            sentPayloads.push({ payload, socketId });
          },
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

    callableModules.RCTDeviceEventEmitter?.emit('websocketOpen', { id: 42 });
    expect(clock.getDelays()).toEqual([DEFAULT_PING_INTERVAL_MS]);

    clock.runNext();
    expect(sentPayloads).toEqual([
      { payload: JSON.stringify({ type: 'ping' }), socketId: 42 },
    ]);
    expect(clock.getDelays()).toEqual([DEFAULT_PING_TIMEOUT_MS]);

    callableModules.RCTDeviceEventEmitter?.emit('websocketMessage', {
      data: '{"type":"pong"}',
      id: 42,
    });
    expect(clock.getDelays()).toEqual([DEFAULT_PING_INTERVAL_MS]);

    clock.runNext();
    clock.runNext();
    expect(closeCalls).toEqual([42]);
    expect(connectCalls).toEqual([
      { socketId: 42, url: 'ws://127.0.0.1:8788' },
    ]);
    expect(clock.getDelays()).toEqual([1000]);
    expect(
      logs.some((message) => message.includes('B13 ws: dead connection detected (keepalive timeout)')),
    ).toBe(true);
  });
});
