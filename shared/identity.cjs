const crypto = require('node:crypto');
const path = require('node:path');

function hash(value) {
  return crypto.createHash('sha1').update(value).digest('hex');
}

function pathKey(value) {
  return path.resolve(value).replace(/[\\/]+$/, '').toLocaleLowerCase('zh-CN');
}

function legacyItemId(scope, filePath) {
  return hash(`${scope}|${pathKey(filePath)}`);
}

function stableItemId(scope, filePath, stats = {}) {
  if (Number.isFinite(stats.dev) && Number.isFinite(stats.ino) && stats.ino > 0) return hash(`${scope}|file-id|${stats.dev}|${stats.ino}`);
  return legacyItemId(scope, filePath);
}

function migrateItemReferences(settings, items) {
  const pairs = items.filter((item) => item.legacyId && item.legacyId !== item.id).map((item) => [item.legacyId, item.id]);
  if (!pairs.length) return false;
  let changed = false;
  const migrateList = (values) => [...new Set(values.map((value) => pairs.find(([oldId]) => oldId === value)?.[1] || value))];
  for (const [oldId, newId] of pairs) {
    if (Object.prototype.hasOwnProperty.call(settings.assignments, oldId)) {
      if (!Object.prototype.hasOwnProperty.call(settings.assignments, newId)) settings.assignments[newId] = settings.assignments[oldId];
      delete settings.assignments[oldId];
      changed = true;
    }
    for (const recordName of ['usage', 'fileHashes']) {
      if (Object.prototype.hasOwnProperty.call(settings[recordName], oldId)) {
        if (!Object.prototype.hasOwnProperty.call(settings[recordName], newId)) settings[recordName][newId] = settings[recordName][oldId];
        delete settings[recordName][oldId];
        changed = true;
      }
    }
  }
  for (const listName of ['favorites', 'hidden', 'knownItemIds', 'newItemIds', 'itemOrder']) {
    const current = Array.isArray(settings[listName]) ? settings[listName] : [];
    const next = migrateList(current);
    if (JSON.stringify(next) !== JSON.stringify(current)) changed = true;
    settings[listName] = next;
  }
  for (const category of settings.categories) {
    category.launchSteps = category.launchSteps.map((step) => step.type === 'item' ? { ...step, value: pairs.find(([oldId]) => oldId === step.value)?.[1] || step.value } : step);
  }
  return changed;
}

module.exports = { legacyItemId, stableItemId, migrateItemReferences };
