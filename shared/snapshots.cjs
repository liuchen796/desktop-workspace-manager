const path = require('node:path');

function pathKey(value) {
  return path.resolve(value).replace(/[\\/]+$/, '').toLocaleLowerCase('zh-CN');
}

function createSnapshot(items, settings, options = {}) {
  const timestamp = options.timestamp || Date.now();
  return {
    id: options.id || `snapshot-${timestamp}`,
    label: String(options.label || '桌面快照').trim().slice(0, 60) || '桌面快照',
    timestamp,
    automatic: options.automatic === true,
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      path: item.path,
      scope: item.scope,
      categoryId: item.categoryId,
      favorite: Boolean(item.favorite),
      hidden: Boolean(item.hidden),
    })),
    categoryIds: settings.categories.map((category) => category.id),
  };
}

function diffSnapshot(snapshot, currentItems) {
  const before = new Map((snapshot?.items || []).map((item) => [pathKey(item.path), item]));
  const current = new Map(currentItems.map((item) => [pathKey(item.path), item]));
  const added = currentItems.filter((item) => !before.has(pathKey(item.path)));
  const removed = (snapshot?.items || []).filter((item) => !current.has(pathKey(item.path)));
  const changed = currentItems.flatMap((item) => {
    const previous = before.get(pathKey(item.path));
    if (!previous) return [];
    const fields = [];
    if (previous.categoryId !== item.categoryId) fields.push('category');
    if (Boolean(previous.favorite) !== Boolean(item.favorite)) fields.push('favorite');
    if (Boolean(previous.hidden) !== Boolean(item.hidden)) fields.push('hidden');
    return fields.length ? [{ id: item.id, name: item.name, path: item.path, fields, before: previous, current: item }] : [];
  });
  return { added, removed, changed };
}

function applySnapshotVirtualState(snapshot, currentItems, settings) {
  const before = new Map((snapshot?.items || []).map((item) => [pathKey(item.path), item]));
  const validCategories = new Set(settings.categories.map((category) => category.id));
  const favorites = new Set(settings.favorites);
  const hidden = new Set(settings.hidden);
  let restored = 0;
  for (const item of currentItems) {
    const previous = before.get(pathKey(item.path));
    if (!previous) continue;
    if (validCategories.has(previous.categoryId)) settings.assignments[item.id] = previous.categoryId;
    if (previous.favorite) favorites.add(item.id); else favorites.delete(item.id);
    if (previous.hidden) hidden.add(item.id); else hidden.delete(item.id);
    restored += 1;
  }
  settings.favorites = [...favorites];
  settings.hidden = [...hidden];
  return restored;
}

module.exports = { pathKey, createSnapshot, diffSnapshot, applySnapshotVirtualState };
