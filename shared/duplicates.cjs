function normalizedText(value) {
  return String(value || '').trim().replace(/\\/g, '/').toLocaleLowerCase('zh-CN');
}

function duplicateEvidence(items, fileHashes = {}) {
  const evidence = new Map(items.map((item) => [item.id, null]));
  const shortcutBuckets = new Map();
  const suspectedBuckets = new Map();
  const exactBuckets = new Map();

  for (const item of items) {
    if (item.type === 'shortcut' && item.target) {
      const key = `shortcut:${normalizedText(item.target)}|${String(item.shortcutArgs || '').trim()}`;
      if (!shortcutBuckets.has(key)) shortcutBuckets.set(key, []);
      shortcutBuckets.get(key).push(item.id);
      continue;
    }
    if (!['file', 'document', 'image', 'video'].includes(item.type) || item.size == null) continue;
    const key = `suspected:${normalizedText(item.fileName)}|${item.size}`;
    if (!suspectedBuckets.has(key)) suspectedBuckets.set(key, []);
    suspectedBuckets.get(key).push(item.id);
    const hashRecord = fileHashes[item.id];
    if (hashRecord && hashRecord.size === item.size && hashRecord.modifiedAt === item.modifiedAt && typeof hashRecord.hash === 'string') {
      const exactKey = `exact:${hashRecord.hash}`;
      if (!exactBuckets.has(exactKey)) exactBuckets.set(exactKey, []);
      exactBuckets.get(exactKey).push(item.id);
    }
  }

  const applyGroups = (buckets, kind) => {
    for (const [key, ids] of buckets) {
      if (ids.length < 2) continue;
      for (const id of ids) evidence.set(id, { kind, key, count: ids.length });
    }
  };
  applyGroups(shortcutBuckets, 'shortcut-target');
  applyGroups(suspectedBuckets, 'suspected-file');
  applyGroups(exactBuckets, 'exact-file');
  return evidence;
}

module.exports = { duplicateEvidence, normalizedText };
