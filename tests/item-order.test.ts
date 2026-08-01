import { describe, expect, it } from 'vitest';
// @ts-expect-error Shared CommonJS module is consumed by Electron at runtime.
import orderModule from '../shared/item-order.cjs';

const { mergeVisibleOrder } = orderModule;

describe('custom item order', () => {
  it('reorders only the visible subset while preserving other positions', () => {
    expect(mergeVisibleOrder(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd'], ['d', 'b'])).toEqual(['a', 'd', 'c', 'b']);
  });

  it('adds newly discovered items and removes stale ids', () => {
    expect(mergeVisibleOrder(['missing', 'b'], ['a', 'b', 'c'], ['c', 'a'])).toEqual(['b', 'c', 'a']);
  });

  it('sanitizes duplicate and unknown visible ids', () => {
    expect(() => mergeVisibleOrder(['a', 'b'], ['a', 'b'], ['a', 'a'])).not.toThrow();
    expect(() => mergeVisibleOrder(['a', 'b'], ['a', 'b'], ['unknown'])).not.toThrow();
  });
});
