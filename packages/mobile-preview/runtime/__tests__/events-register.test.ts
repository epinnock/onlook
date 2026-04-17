import { beforeEach, describe, expect, it } from 'bun:test';

import { createHostConfig } from '../fabric-host-config.js';
import {
  __getLastFabricEventForTests,
  __resetFabricEventsForTests,
} from '../host/events.js';

describe('Fabric event registration', () => {
  beforeEach(() => {
    __resetFabricEventsForTests();
  });

  it('registers a Fabric event handler through createHostConfig and routes events into host/events', () => {
    const registeredHandlers: Array<(eventType: string, targetTag: number, payload: unknown) => void> = [];
    const fab = {
      registerEventHandler(handler: (eventType: string, targetTag: number, payload: unknown) => void) {
        registeredHandlers.push(handler);
      },
    };

    const hostConfig = createHostConfig(fab, 41);

    expect(hostConfig).toBeObject();
    expect(registeredHandlers).toHaveLength(1);

    registeredHandlers[0]?.('topTouchEnd', 1000001, { pageX: 12, pageY: 30 });

    expect(__getLastFabricEventForTests()).toEqual({
      eventType: 'topTouchEnd',
      targetTag: 1000001,
      payload: { pageX: 12, pageY: 30 },
    });
  });

  it('does not register the same Fabric host twice', () => {
    const registeredHandlers: Array<(eventType: string, targetTag: number, payload: unknown) => void> = [];
    const fab = {
      registerEventHandler(handler: (eventType: string, targetTag: number, payload: unknown) => void) {
        registeredHandlers.push(handler);
      },
    };

    createHostConfig(fab, 41);
    createHostConfig(fab, 99);

    expect(registeredHandlers).toHaveLength(1);
  });
});
