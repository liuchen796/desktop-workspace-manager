function createBackupService({ currentVersion, normalizeSettings, validateCategoryStructure, assertRealPath, isWithin, getDesktopRoots }) {
  function trimHistory(history, maxHistory = 30) {
    return [...history].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, maxHistory);
  }

  function trimSnapshots(snapshots) {
    const ordered = [...snapshots].sort((a, b) => b.timestamp - a.timestamp);
    const manual = ordered.filter((entry) => !entry.automatic).slice(0, 20);
    const automatic = ordered.filter((entry) => entry.automatic).slice(0, 10);
    return [...manual, ...automatic].sort((a, b) => b.timestamp - a.timestamp);
  }

  async function validateImportedSettings(value) {
    const source = value?.settings || value;
    if (Number(source?.version) > currentVersion) throw new Error(`配置来自更高版本（v${source.version}），当前版本无法安全导入`);
    validateCategoryStructure(source?.categories);
    const imported = normalizeSettings(source);
    const roots = getDesktopRoots();
    for (const category of imported.categories) {
      if (!category.archivePath) continue;
      try {
        const real = await assertRealPath(category.archivePath);
        if (roots.some((root) => isWithin(real, root.path))) throw new Error('inside desktop');
        category.archivePath = real;
      } catch {
        category.archivePath = null;
      }
    }
    const externalItems = [];
    for (const entry of imported.externalItems) {
      try {
        const real = await assertRealPath(entry.path);
        if (roots.some((root) => isWithin(real, root.path))) continue;
        externalItems.push({ path: real, addedAt: entry.addedAt || Date.now() });
      } catch {}
    }
    imported.externalItems = externalItems;
    return imported;
  }

  return { trimHistory, trimSnapshots, validateImportedSettings };
}

module.exports = { createBackupService };
