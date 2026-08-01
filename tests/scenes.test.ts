import { describe, expect, it } from 'vitest';
// @ts-expect-error Shared CommonJS module is consumed by Electron at runtime.
import scenes from '../shared/scenes.cjs';

const { sanitizeLaunchSteps } = scenes;

describe('work scene steps', () => {
  it('normalizes safe item, URL and delay steps in order', () => {
    const result = sanitizeLaunchSteps([
      { id: 'one', type: 'item', value: 'item-id', enabled: true },
      { id: 'two', type: 'url', value: 'https://example.com', enabled: true },
      { id: 'three', type: 'delay', value: 800, enabled: true },
    ]);
    expect(result.map((step: { type: string }) => step.type)).toEqual(['item', 'url', 'delay']);
    expect(result[1].value).toBe('https://example.com/');
    expect(result[2].value).toBe('800');
  });

  it('rejects unsafe URL protocols and excessive delays', () => {
    expect(() => sanitizeLaunchSteps([{ id: 'bad', type: 'url', value: 'file:///C:/secret' }])).toThrow('HTTP');
    expect(() => sanitizeLaunchSteps([{ id: 'slow', type: 'delay', value: 20000 }])).toThrow('10000');
  });
});
