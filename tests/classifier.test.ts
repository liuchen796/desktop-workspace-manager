import { describe, expect, it } from 'vitest';
// @ts-expect-error Shared CommonJS module is consumed by Electron at runtime.
import classifier from '../shared/classifier.cjs';

const { classifyItem, safeCategoryFolder, uniquePath } = classifier;

describe('desktop classifier', () => {
  it('prioritizes manual categories', () => {
    expect(classifyItem({ name: '论文.docx', path: 'C:\\Desktop\\论文.docx' }, 'projects', true)).toBe('projects');
  });

  it('puts newly discovered items in the inbox', () => {
    expect(classifyItem({ name: '临时文件', path: 'C:\\Desktop\\临时文件' }, '', true)).toBe('inbox');
  });

  it('recognizes the user work scenes', () => {
    expect(classifyItem({ name: 'Visual Studio Code', path: '', target: 'Code.exe' })).toBe('ai-dev');
    expect(classifyItem({ name: '企业微信', path: '', target: 'WXWork.exe' })).toBe('office');
    expect(classifyItem({ name: 'MATLAB R2024b', path: '', target: 'matlab.exe' })).toBe('engineering');
    expect(classifyItem({ name: 'v2rayN', path: '', target: 'v2rayN.exe' })).toBe('network');
  });

  it('sanitizes category folder names', () => {
    expect(safeCategoryFolder('客户:项目? ')).toBe('客户项目');
    expect(safeCategoryFolder('...')).toBe('其他');
  });

  it('falls back when an automatic preset category was deleted', () => {
    const item = { name: '客户项目说明', path: 'C:\\Desktop\\客户项目说明', target: '', extension: '' };
    expect(classifyItem(item, undefined, false, new Set(['inbox', 'other']))).toBe('other');
  });

  it('generates a non-overwriting target', () => {
    const occupied = new Set(['C:\\Desktop\\a.txt', 'C:\\Desktop\\a (2).txt']);
    expect(uniquePath('C:\\Desktop\\a.txt', (value: string) => occupied.has(value))).toBe('C:\\Desktop\\a (3).txt');
  });
});
