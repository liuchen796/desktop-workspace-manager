import { describe, expect, it } from 'vitest';
// @ts-expect-error Shared CommonJS module is consumed by Electron at runtime.
import safety from '../shared/path-safety.cjs';

const { isDirectChild, isWithin, normalized } = safety;

describe('Windows path safety', () => {
  it('normalizes case and trailing separators', () => {
    expect(normalized('C:\\Users\\Demo\\Desktop\\')).toBe(normalized('c:\\users\\demo\\desktop'));
  });

  it('accepts only first-level desktop items', () => {
    const root = 'C:\\Users\\Demo\\Desktop';
    expect(isDirectChild(`${root}\\项目`, root)).toBe(true);
    expect(isDirectChild(`${root}\\项目\\文件.txt`, root)).toBe(false);
    expect(isDirectChild('C:\\Windows\\Temp\\文件.txt', root)).toBe(false);
  });

  it('rejects archive prefix lookalikes', () => {
    const archive = 'C:\\Users\\Demo\\Desktop\\桌面归档';
    expect(isWithin(`${archive}\\客户项目\\a.txt`, archive)).toBe(true);
    expect(isWithin('C:\\Users\\Demo\\Desktop\\桌面归档-伪造\\a.txt', archive)).toBe(false);
  });
});
