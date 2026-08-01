import { describe, expect, it } from 'vitest';
// @ts-expect-error Shared CommonJS module is consumed by Electron at runtime.
import everythingModule from '../shared/everything.cjs';

const { parseEverythingCsv, validateEverythingQuery } = everythingModule;

describe('Everything integration helpers', () => {
  it('parses quoted UTF-8 CSV results', () => {
    const results = parseEverythingCsv('"论文,终稿.docx","D:\\资料","docx","2048","2026-07-17T01:02:03","A"\n"项目","F:\\工作","","","2026-07-16T01:02:03","D"');
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ name: '论文,终稿.docx', path: 'D:\\资料\\论文,终稿.docx', extension: '.docx', size: 2048, isDirectory: false });
    expect(results[1]).toMatchObject({ path: 'F:\\工作\\项目', isDirectory: true, size: null });
  });

  it('rejects control characters and overly long queries', () => {
    expect(validateEverythingQuery('  *.docx  ')).toBe('*.docx');
    expect(() => validateEverythingQuery('a\u0000b')).toThrow('无效');
    expect(() => validateEverythingQuery('x'.repeat(501))).toThrow('无效');
  });
});
