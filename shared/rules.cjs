const RULE_FIELDS = new Set(['name', 'extension', 'target', 'path', 'scope', 'type']);
const RULE_OPERATORS = new Set(['contains', 'equals', 'startsWith', 'in']);

function sanitizeRule(entry) {
  const id = String(entry?.id || '').slice(0, 80);
  const field = String(entry?.field || 'name');
  const operator = String(entry?.operator || 'contains');
  const value = String(entry?.value || '').trim().slice(0, 240);
  if (!id || !RULE_FIELDS.has(field) || !RULE_OPERATORS.has(operator) || !value) throw new Error('智能分类规则无效');
  return { id, field, operator, value, enabled: entry.enabled !== false };
}

function sanitizeRules(entries) {
  if (!Array.isArray(entries) || entries.length > 20) throw new Error('每个分类最多设置 20 条规则');
  const rules = entries.map(sanitizeRule);
  if (new Set(rules.map((rule) => rule.id)).size !== rules.length) throw new Error('智能分类规则标识不能重复');
  return rules;
}

function normalized(value) {
  return String(value || '').trim().toLocaleLowerCase('zh-CN');
}

function matchesRule(item, rule) {
  if (!rule.enabled) return true;
  const actual = normalized(item[rule.field]);
  const expected = normalized(rule.value);
  if (rule.operator === 'equals') return actual === expected;
  if (rule.operator === 'startsWith') return actual.startsWith(expected);
  if (rule.operator === 'in') return expected.split(/[,，;；|]/).map((part) => part.trim()).filter(Boolean).includes(actual);
  return actual.includes(expected);
}

function matchesRules(item, rules, mode = 'all') {
  const enabled = rules.filter((rule) => rule.enabled);
  if (!enabled.length) return false;
  return mode === 'any' ? enabled.some((rule) => matchesRule(item, rule)) : enabled.every((rule) => matchesRule(item, rule));
}

function matchCategoryRules(item, categories) {
  for (const category of categories) {
    if (category.id === 'inbox' || !Array.isArray(category.rules) || !category.rules.length) continue;
    if (matchesRules(item, category.rules, category.ruleMode)) return category;
  }
  return null;
}

module.exports = { RULE_FIELDS, RULE_OPERATORS, sanitizeRule, sanitizeRules, matchesRule, matchesRules, matchCategoryRules };
