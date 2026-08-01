const crypto = require('node:crypto');
const path = require('node:path');
const { parse } = require('csv-parse/sync');

function parseEverythingCsv(value) {
  const text = String(value || '').replace(/^\uFEFF/, '');
  if (!text.trim()) return [];
  const rows = parse(text, { bom: true, relax_column_count: true, skip_empty_lines: true });
  return rows.flatMap((row) => {
    const [name = '', directory = '', extension = '', size = '', modified = '', attributes = ''] = row.map((entry) => String(entry || ''));
    const fullPath = path.join(directory, name);
    if (!name || !path.isAbsolute(fullPath)) return [];
    const numericSize = size.trim() ? Number(size) : Number.NaN;
    const modifiedAt = Date.parse(modified);
    return [{
      id: crypto.createHash('sha1').update(fullPath.toLocaleLowerCase('zh-CN')).digest('hex'),
      name,
      path: fullPath,
      directory,
      extension: extension ? `.${extension.replace(/^\./, '').toLowerCase()}` : '',
      size: attributes.toUpperCase().includes('D') ? null : (Number.isFinite(numericSize) && numericSize >= 0 ? numericSize : null),
      modifiedAt: Number.isFinite(modifiedAt) ? modifiedAt : null,
      isDirectory: attributes.toUpperCase().includes('D'),
      icon: '',
    }];
  });
}

function validateEverythingQuery(value) {
  const query = String(value || '').trim();
  if (!query) return '';
  if (query.length > 500 || /[\u0000-\u001f]/.test(query)) throw new Error('Everything 搜索内容无效');
  return query;
}

module.exports = { parseEverythingCsv, validateEverythingQuery };
