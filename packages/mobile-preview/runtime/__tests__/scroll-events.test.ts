import { describe, expect, it } from 'bun:test';

import {
  createScrollEventPayload,
  createSyntheticScrollEvent,
} from '../host/events-scroll.js';

describe('createScrollEventPayload', () => {
  it('normalizes ScrollView payloads into an explicit RN-style shape', () => {
    expect(
      createScrollEventPayload({
        x: 12,
        y: 240,
        contentInset: { top: 10 },
        contentSize: { width: 320, height: 1200 },
        layoutMeasurement: { width: 320, height: 640 },
      }),
    ).toEqual({
      contentOffset: { x: 12, y: 240 },
      contentInset: { top: 10, left: 0, bottom: 0, right: 0 },
      contentSize: { width: 320, height: 1200 },
      layoutMeasurement: { width: 320, height: 640 },
      velocity: { x: 0, y: 0 },
      zoomScale: 1,
      responderIgnoreScroll: true,
    });
  });

  it('preserves explicit nested scroll fields when they are already provided', () => {
    expect(
      createScrollEventPayload({
        contentOffset: { x: 4, y: 18 },
        contentInset: { top: 1, left: 2, bottom: 3, right: 4 },
        contentSize: { width: 400, height: 900 },
        layoutMeasurement: { width: 320, height: 200 },
        velocity: { x: 0, y: 6 },
        zoomScale: 2,
        responderIgnoreScroll: false,
      }),
    ).toEqual({
      contentOffset: { x: 4, y: 18 },
      contentInset: { top: 1, left: 2, bottom: 3, right: 4 },
      contentSize: { width: 400, height: 900 },
      layoutMeasurement: { width: 320, height: 200 },
      velocity: { x: 0, y: 6 },
      zoomScale: 2,
      responderIgnoreScroll: false,
    });
  });
});

describe('createSyntheticScrollEvent', () => {
  it('wraps the normalized scroll payload in the shared synthetic event contract', () => {
    const event = createSyntheticScrollEvent(
      {
        y: 120,
        contentSize: { width: 300, height: 900 },
      },
      {
        target: 77,
        currentTarget: 88,
        timestamp: 444,
      },
    );

    expect(event.type).toBe('topScroll');
    expect(event.target).toBe(77);
    expect(event.currentTarget).toBe(88);
    expect(event.timeStamp).toBe(444);
    expect(event.nativeEvent).toEqual({
      contentOffset: { x: 0, y: 120 },
      contentInset: { top: 0, left: 0, bottom: 0, right: 0 },
      contentSize: { width: 300, height: 900 },
      layoutMeasurement: { width: 0, height: 0 },
      velocity: { x: 0, y: 0 },
      zoomScale: 1,
      responderIgnoreScroll: true,
      target: 77,
      timestamp: 444,
    });
  });
});
