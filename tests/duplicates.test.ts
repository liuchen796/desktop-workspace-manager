import { describe, expect, it } from 'vitest';
// @ts-expect-error Shared CommonJS module is consumed by Electron at runtime.
import duplicateModule from '../shared/duplicates.cjs';

const { duplicateEvidence } = duplicateModule;

describe('duplicate evidence', () => {
  it('groups shortcuts only when target and arguments match', () => {
    const items = [
      { id: 'a', type: 'shortcut', target: 'C:\\App\\app.exe', shortcutArgs: '--one' },
      { id: 'b', type: 'shortcut', target: 'c:\\app\\APP.exe', shortcutArgs: '--one' },
      { id: 'c', type: 'shortcut', target: 'C:\\App\\app.exe', shortcutArgs: '--two' },
    ];
    const result = duplicateEvidence(items);
    expect(result.get('a')?.kind).toBe('shortcut-target');
    expect(result.get('b')?.kind).toBe('shortcut-target');
    expect(result.get('c')).toBeNull();
  });

  it('marks same-name same-size files as suspected only', () => {
    const items = [
      { id: 'a', type: 'document', fileName: '报告.docx', size: 120, modifiedAt: 1 },
      { id: 'b', type: 'document', fileName: '报告.docx', size: 120, modifiedAt: 2 },
      { id: 'c', type: 'document', fileName: '报告.docx', size: 130, modifiedAt: 3 },
    ];
    const result = duplicateEvidence(items);
    expect(result.get('a')?.kind).toBe('suspected-file');
    expect(result.get('b')?.kind).toBe('suspected-file');
    expect(result.get('c')).toBeNull();
  });

  it('promotes matching current hashes to exact duplicates', () => {
    const items = [
      { id: 'a', type: 'file', fileName: 'a.bin', size: 3, modifiedAt: 10 },
      { id: 'b', type: 'file', fileName: 'b.bin', size: 3, modifiedAt: 20 },
    ];
    const hashes = {
      a: { hash: 'same', size: 3, modifiedAt: 10 },
      b: { hash: 'same', size: 3, modifiedAt: 20 },
    };
    const result = duplicateEvidence(items, hashes);
    expect(result.get('a')?.kind).toBe('exact-file');
    expect(result.get('b')?.kind).toBe('exact-file');
  });
});
