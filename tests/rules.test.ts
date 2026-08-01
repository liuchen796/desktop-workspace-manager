import { describe, expect, it } from 'vitest';
// @ts-expect-error Shared CommonJS module is consumed by Electron at runtime.
import ruleModule from '../shared/rules.cjs';

const { matchesRules, matchCategoryRules, sanitizeRules } = ruleModule;

describe('smart category rules', () => {
  const item = { name: '客户项目报告.docx', extension: '.docx', target: '', path: 'D:\\客户项目\\报告.docx', scope: 'personal', type: 'document' };

  it('supports all and any matching modes', () => {
    const rules = [
      { id: 'one', field: 'name', operator: 'contains', value: '客户', enabled: true },
      { id: 'two', field: 'extension', operator: 'equals', value: '.pdf', enabled: true },
    ];
    expect(matchesRules(item, rules, 'all')).toBe(false);
    expect(matchesRules(item, rules, 'any')).toBe(true);
  });

  it('uses category order as rule priority', () => {
    const categories = [
      { id: 'first', rules: [{ id: 'a', field: 'name', operator: 'contains', value: '报告', enabled: true }], ruleMode: 'all' },
      { id: 'second', rules: [{ id: 'b', field: 'extension', operator: 'equals', value: '.docx', enabled: true }], ruleMode: 'all' },
    ];
    expect(matchCategoryRules(item, categories)?.id).toBe('first');
  });

  it('rejects empty or unsupported rules', () => {
    expect(() => sanitizeRules([{ id: 'x', field: 'unknown', operator: 'contains', value: 'a' }])).toThrow();
    expect(() => sanitizeRules([{ id: 'x', field: 'name', operator: 'contains', value: '' }])).toThrow();
  });
});
