const { app, BrowserWindow, ipcMain: nativeIpcMain, shell, globalShortcut, screen, Tray, Menu, nativeImage, dialog, net } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { DEFAULT_CATEGORIES, classifyItem, safeCategoryFolder, uniquePath } = require('../shared/classifier.cjs');
const { CURRENT_SETTINGS_VERSION, createDefaultSettings, normalizeSettings, validateCategoryStructure } = require('../shared/settings.cjs');
const { writeJsonAtomic, loadJsonWithRecovery, createRotatingBackup } = require('../shared/storage.cjs');
const { normalized, isDirectChild, isWithin, assertNoLinkSegments, assertRealPath } = require('../shared/path-safety.cjs');
const { executeOperations, restoreOperations } = require('../shared/organizer.cjs');
const { reconcileUndo } = require('../shared/history.cjs');
const { duplicateEvidence } = require('../shared/duplicates.cjs');
const { sanitizeRules, matchesRules, matchCategoryRules } = require('../shared/rules.cjs');
const { createSnapshot, diffSnapshot, applySnapshotVirtualState } = require('../shared/snapshots.cjs');
const { sanitizeLaunchSteps } = require('../shared/scenes.cjs');
const { legacyItemId, stableItemId, migrateItemReferences } = require('../shared/identity.cjs');
const { mergeVisibleOrder, uniqueIds } = require('../shared/item-order.cjs');
const { dockSize, findNearestDockTarget, resolveDockTarget, collapsedDockBoundsForTarget } = require('../shared/dock-layout.cjs');
const { createMoveRecoveryService } = require('./organize-service.cjs');
const { createIpcService } = require('./ipc-service.cjs');
const { createScannerService, mapWithConcurrency } = require('./scanner-service.cjs');
const { createDockService } = require('./dock-service.cjs');
const { createBackupService } = require('./backup-service.cjs');
const { createEverythingService } = require('./everything-service.cjs');

const APP_NAME = '桌面工作台';
const ARCHIVE_NAME = '桌面归档';
const MAX_HISTORY = 30;
const configuredUserData = process.env.DESKTOP_WORKSPACE_USER_DATA
  ? path.resolve(process.env.DESKTOP_WORKSPACE_USER_DATA)
  : path.join(app.getPath('appData'), 'DesktopWorkspaceManager');
app.setPath('userData', configuredUserData);
let mainWindow = null;
let dockWindow = null;
let tray = null;
let isQuitting = false;
let lastItems = [];
let settingsWriteQueue = Promise.resolve();
let settingsCache = null;
let settingsLoadPromise = null;
let dockHideTimer = null;
let dockRevealTimer = null;
let dockAnimationTimer = null;
let dockExpandedBounds = null;
let dockPreviewWindow = null;
let dockDragging = false;
let dockDragCandidate = null;
let dockDragOriginTarget = null;
let dockDragDetached = false;
let dockDragOriginRearmed = false;
let dockCollapsed = false;
let dockPointerInside = false;
let dockRevealGraceUntil = 0;
let suppressDockBoundsPersistence = false;
let mainBoundsTimer = null;
let scanInFlight = null;
let fileOperationQueue = Promise.resolve();
let settingsBackedUpThisRun = false;
let settingsRecoveryNotice = '';
const iconCache = new Map();
const approvedArchivePaths = new Set();
const pendingImports = new Map();
const approvedShortcutRepairs = new Map();
const activeDuplicateScans = new Map();

const defaultSettings = createDefaultSettings();
const scannerService = createScannerService({ app, fs });
const desktopRoots = scannerService.roots;
const dockService = createDockService({ screen, dockSize, resolveDockTarget });
const backupService = createBackupService({ currentVersion: CURRENT_SETTINGS_VERSION, normalizeSettings, validateCategoryStructure, assertRealPath, isWithin, getDesktopRoots: desktopRoots });
const trimHistory = (history) => backupService.trimHistory(history, MAX_HISTORY);
const trimSnapshots = backupService.trimSnapshots;
const validateImportedSettings = backupService.validateImportedSettings;
const ipcMain = createIpcService(nativeIpcMain, { applicationFile: path.join(__dirname, '..', 'dist', 'index.html'), devServerUrl: process.env.VITE_DEV_SERVER_URL || '' });
const everythingService = createEverythingService({ app, net, getSettings, saveSettings, resolveIcon: (...args) => resolveCachedIcon(...args) });
const getEverythingStatus = () => everythingService.getStatus();
const installEverythingConnector = () => everythingService.installConnector();
const searchEverything = (query, limit) => everythingService.search(query, limit);
const moveRecoveryService = createMoveRecoveryService({
  directory: path.join(app.getPath('userData'), 'move-recovery'),
  getPersonalRoot: () => app.getPath('desktop'),
  trash: (targetPath) => shell.trashItem(targetPath),
});

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function historyPath() {
  return path.join(app.getPath('userData'), 'history.json');
}

function snapshotsPath() {
  return path.join(app.getPath('userData'), 'snapshots.json');
}

function iconCacheDirectory() {
  return path.join(app.getPath('userData'), 'icon-cache');
}

function iconCachePath(filePath) {
  return path.join(iconCacheDirectory(), `${crypto.createHash('sha1').update(normalized(filePath)).digest('hex')}.json`);
}

function mergeSettings(value = {}) {
  return normalizeSettings(value);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await writeJsonAtomic(file, value);
}

async function getSettings() {
  if (settingsCache) return settingsCache;
  if (!settingsLoadPromise) {
    settingsLoadPromise = loadJsonWithRecovery(settingsPath(), defaultSettings, { normalize: mergeSettings, currentVersion: CURRENT_SETTINGS_VERSION }).then((result) => {
      settingsCache = result.value;
      if (result.status === 'corrupt') settingsRecoveryNotice = `设置文件损坏，已恢复默认设置；原文件保留在 ${result.preservedPath}`;
      if (result.status === 'unsupported') settingsRecoveryNotice = `检测到更高版本的设置，已安全保留在 ${result.preservedPath}`;
      if (result.status === 'migrated') settingsRecoveryNotice = '设置已升级，升级前的副本已自动保留';
      return settingsCache;
    });
  }
  return settingsLoadPromise;
}

async function saveSettings(settings) {
  const merged = mergeSettings(settings);
  if (!settingsCache) settingsCache = merged;
  else Object.assign(settingsCache, merged);
  const snapshot = JSON.parse(JSON.stringify(settingsCache));
  settingsWriteQueue = settingsWriteQueue.catch(() => {}).then(async () => {
    if (!settingsBackedUpThisRun) {
      await createRotatingBackup(settingsPath(), path.join(app.getPath('userData'), 'backups'), 5);
      settingsBackedUpThisRun = true;
    }
    await writeJson(settingsPath(), snapshot);
  });
  await settingsWriteQueue;
  return settingsCache;
}

function enqueueFileOperation(task) {
  const operation = fileOperationQueue.catch(() => {}).then(task);
  fileOperationQueue = operation.catch(() => {});
  return operation;
}

async function saveCurrentSnapshot(label, automatic = false) {
  await scanDesktop();
  const settings = await getSettings();
  const snapshots = await readJson(snapshotsPath(), []);
  const snapshot = createSnapshot(lastItems, settings, { id: crypto.randomUUID(), label, automatic });
  snapshots.unshift(snapshot);
  await writeJson(snapshotsPath(), trimSnapshots(snapshots));
  return snapshot;
}

async function applyImportedSettings(imported) {
  settingsCache = normalizeSettings(imported);
  await saveSettings(settingsCache);
  settingsCache.hotkey = await registerHotkey(settingsCache.hotkey);
  app.setLoginItemSettings({ openAtLogin: settingsCache.launchAtStartup, args: settingsCache.launchAtStartupHidden ? ['--hidden'] : [] });
  await saveSettings(settingsCache);
  await notifyDesktopChanged('settings-import');
  return settingsCache;
}

function idFor(scope, filePath, stats) {
  return stableItemId(scope, filePath, stats);
}

function findItem(id) {
  return lastItems.find((item) => item.id === id);
}

async function shortcutDetails(filePath) {
  if (path.extname(filePath).toLowerCase() !== '.lnk') return null;
  try {
    return shell.readShortcutLink(filePath);
  } catch {
    return null;
  }
}

function shortcutSignature(details) {
  if (!details) return '';
  return crypto.createHash('sha256').update(JSON.stringify({
    target: normalized(details.target || ''),
    cwd: normalized(details.cwd || ''),
    args: details.args || '',
    description: details.description || '',
    icon: normalized(details.icon || ''),
    iconIndex: Number(details.iconIndex) || 0,
    appUserModelId: details.appUserModelId || '',
  })).digest('hex');
}

function expandEnvironmentPath(value) {
  return String(value || '')
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .replace(/%([^%]+)%/g, (match, name) => process.env[name] || process.env[name.toUpperCase()] || match);
}

function shortcutIconPath(value) {
  return expandEnvironmentPath(value).replace(/,\s*-?\d+\s*$/, '');
}

async function resolveNativeIcon(filePath, shortcut) {
  const candidates = shortcut
    ? [shortcutIconPath(shortcut.icon), expandEnvironmentPath(shortcut.target), filePath]
    : [filePath];
  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const image = await app.getFileIcon(candidate, { size: 'large' });
      if (!image.isEmpty()) {
        const data = image.toDataURL();
        if (shortcut && data.length < 1400) continue;
        return data;
      }
    } catch {}
  }
  return '';
}

async function resolveCachedIcon(filePath, shortcut, signature) {
  const memory = iconCache.get(filePath);
  if (memory?.signature === signature) return memory.data;
  try {
    const cached = JSON.parse(await fsp.readFile(iconCachePath(filePath), 'utf8'));
    if (cached.signature === signature && typeof cached.data === 'string') {
      iconCache.set(filePath, cached);
      return cached.data;
    }
  } catch {}
  const data = await resolveNativeIcon(filePath, shortcut);
  const cached = { signature, data, accessedAt: Date.now() };
  iconCache.set(filePath, cached);
  try {
    await fsp.mkdir(iconCacheDirectory(), { recursive: true });
    await writeJson(iconCachePath(filePath), cached);
  } catch {}
  return data;
}

async function pruneIconCache(maxFiles = 500) {
  try {
    const directory = iconCacheDirectory();
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    const files = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map(async (entry) => ({ name: entry.name, modifiedAt: (await fsp.stat(path.join(directory, entry.name))).mtimeMs })));
    files.sort((a, b) => b.modifiedAt - a.modifiedAt);
    await Promise.all(files.slice(maxFiles).map((entry) => fsp.rm(path.join(directory, entry.name), { force: true })));
  } catch {}
}

function itemType(entry, extension) {
  if (entry.isDirectory()) return 'folder';
  if (extension === '.lnk') return 'shortcut';
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(extension)) return 'image';
  if (['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(extension)) return 'video';
  if (['.doc', '.docx', '.pdf', '.txt', '.md', '.xls', '.xlsx', '.ppt', '.pptx'].includes(extension)) return 'document';
  return 'file';
}

async function scanRoot(root) {
  let entries = [];
  try {
    entries = await fsp.readdir(root.path, { withFileTypes: true });
  } catch {
    return [];
  }
  const visible = entries.filter((entry) => !entry.name.startsWith('.') && entry.name.toLowerCase() !== 'desktop.ini' && entry.name !== ARCHIVE_NAME);
  return mapWithConcurrency(visible, 8, async (entry) => {
    const filePath = path.join(root.path, entry.name);
    const extension = entry.isDirectory() ? '' : path.extname(entry.name).toLowerCase();
    let stats;
    try {
      stats = await fsp.stat(filePath);
    } catch {
      return null;
    }
    const shortcut = await shortcutDetails(filePath);
    const target = shortcut?.target || '';
    const iconSignature = `native-icon-v2|${stats.mtimeMs}|${shortcut?.icon || ''}|${target}`;
    const icon = entry.isDirectory() ? '' : await resolveCachedIcon(filePath, shortcut, iconSignature);
    return {
      id: idFor(root.scope, filePath, stats),
      legacyId: legacyItemId(root.scope, filePath),
      name: entry.isDirectory() ? entry.name : path.basename(entry.name, extension === '.lnk' ? extension : ''),
      fileName: entry.name,
      path: filePath,
      scope: root.scope,
      type: itemType(entry, extension),
      extension,
      target,
      shortcutArgs: shortcut?.args || '',
      targetExists: target ? fs.existsSync(target) : true,
      modifiedAt: stats.mtimeMs,
      size: entry.isDirectory() ? null : stats.size,
      icon,
      exists: true,
    };
  }).then((items) => items.filter(Boolean));
}

async function scanExternalItems(settings) {
  return mapWithConcurrency(settings.externalItems.slice(0, 200), 8, async (entry) => {
    const filePath = entry.path;
    let id = legacyItemId('external', filePath);
    try {
      await assertNoLinkSegments(filePath);
      const stats = await fsp.lstat(filePath);
      id = idFor('external', filePath, stats);
      const extension = stats.isDirectory() ? '' : path.extname(filePath).toLowerCase();
      const shortcut = await shortcutDetails(filePath);
      const target = shortcut?.target || '';
      const iconSignature = `native-icon-v2|${stats.mtimeMs}|${shortcut?.icon || ''}|${target}`;
      return {
        id,
        legacyId: legacyItemId('external', filePath),
        name: stats.isDirectory() ? path.basename(filePath) : path.basename(filePath, extension === '.lnk' ? extension : ''),
        fileName: path.basename(filePath),
        path: filePath,
        scope: 'external',
        type: itemType({ isDirectory: () => stats.isDirectory() }, extension),
        extension,
        target,
        shortcutArgs: shortcut?.args || '',
        targetExists: target ? fs.existsSync(target) : true,
        modifiedAt: stats.mtimeMs,
        size: stats.isDirectory() ? null : stats.size,
        icon: stats.isDirectory() ? '' : await resolveCachedIcon(filePath, shortcut, iconSignature),
        exists: true,
      };
    } catch {
      return { id, legacyId: id, name: path.basename(filePath), fileName: path.basename(filePath), path: filePath, scope: 'external', type: 'file', extension: path.extname(filePath).toLowerCase(), target: '', shortcutArgs: '', targetExists: false, modifiedAt: 0, size: null, icon: '', exists: false };
    }
  });
}

async function performDesktopScan() {
  const settings = await getSettings();
  const raw = [...(await Promise.all(desktopRoots().map(scanRoot))).flat(), ...(await scanExternalItems(settings))];
  migrateItemReferences(settings, raw);
  const activePaths = new Set(raw.map((item) => item.path));
  for (const cachedPath of iconCache.keys()) if (!activePaths.has(cachedPath)) iconCache.delete(cachedPath);
  const currentIds = raw.map((item) => item.id);
  if (!settings.firstScanComplete) {
    settings.knownItemIds = currentIds;
    settings.newItemIds = [];
    settings.firstScanComplete = true;
  } else {
    const known = new Set(settings.knownItemIds);
    const newlyFound = currentIds.filter((id) => !known.has(id));
    settings.newItemIds = [...new Set([...settings.newItemIds, ...newlyFound])].filter((id) => currentIds.includes(id));
    settings.knownItemIds = [...new Set([...settings.knownItemIds, ...currentIds])];
  }
  const favoriteSet = new Set(settings.favorites);
  const hiddenSet = new Set(settings.hidden);
  const newSet = new Set(settings.newItemIds);
  const validCategoryIds = new Set(settings.categories.map((category) => category.id));
  const duplicateEvidenceById = duplicateEvidence(raw, settings.fileHashes);
  lastItems = raw.map(({ legacyId: _legacyId, ...item }) => {
    const duplicate = duplicateEvidenceById.get(item.id);
    const usage = settings.usage[item.id] || { count: 0, lastOpenedAt: null };
    const isNew = newSet.has(item.id);
    const manualCategory = settings.assignments[item.id];
    const customMatch = !manualCategory ? matchCategoryRules(item, settings.categories) : null;
    const fallbackSuggestion = classifyItem(item, '', false, validCategoryIds);
    const suggestedCategoryId = customMatch?.id || (fallbackSuggestion !== 'other' ? fallbackSuggestion : null);
    return {
      ...item,
      categoryId: manualCategory || (isNew ? 'inbox' : (customMatch?.id || classifyItem(item, '', false, validCategoryIds))),
      suggestedCategoryId: isNew ? suggestedCategoryId : null,
      suggestionReason: isNew && suggestedCategoryId ? (customMatch ? '匹配自定义规则' : '匹配内置场景特征') : null,
      isNew,
      favorite: favoriteSet.has(item.id),
      hidden: hiddenSet.has(item.id),
      duplicateKey: duplicate?.key || null,
      duplicateKind: duplicate?.kind || null,
      useCount: usage.count || 0,
      lastOpenedAt: usage.lastOpenedAt || null,
    };
  });
  await saveSettings(settings);
  return { items: lastItems, roots: desktopRoots(), categories: settings.categories, recoveryNotice: settingsRecoveryNotice };
}

function scanDesktop() {
  if (!scanInFlight) {
    scanInFlight = performDesktopScan().finally(() => { scanInFlight = null; });
  }
  return scanInFlight;
}

async function markUsage(id) {
  const settings = await getSettings();
  const current = settings.usage[id] || { count: 0 };
  settings.usage[id] = { count: (current.count || 0) + 1, lastOpenedAt: Date.now() };
  await saveSettings(settings);
}

async function hashPath(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });
}

async function scanExactDuplicates(ids = [], controls = {}) {
  await scanDesktop();
  const requested = new Set(Array.isArray(ids) ? ids : []);
  const files = lastItems.filter((item) => ['file', 'document', 'image', 'video'].includes(item.type) && item.size != null && (!requested.size || requested.has(item.id)));
  const bySize = new Map();
  for (const item of files) {
    if (!bySize.has(item.size)) bySize.set(item.size, []);
    bySize.get(item.size).push(item);
  }
  const candidates = [...bySize.values()].filter((group) => group.length > 1).flat().slice(0, 200);
  const settings = await getSettings();
  let hashedCount = 0;
  const failures = [];
  let cancelled = false;
  for (let index = 0; index < candidates.length; index += 1) {
    const item = candidates[index];
    if (controls.isCancelled?.()) { cancelled = true; break; }
    controls.onProgress?.({ current: index, total: candidates.length, name: item.name });
    try {
      settings.fileHashes[item.id] = { hash: await hashPath(item.path), size: item.size, modifiedAt: item.modifiedAt, checkedAt: Date.now() };
      hashedCount += 1;
    } catch (error) {
      failures.push({ id: item.id, name: item.name, reason: error.message || String(error) });
    }
  }
  controls.onProgress?.({ current: hashedCount + failures.length, total: candidates.length, name: '', done: true, cancelled });
  await saveSettings(settings);
  return { payload: await scanDesktop(), hashedCount, failures, cancelled };
}

async function validatePersonalSource(filePath, personalRoot) {
  if (!isDirectChild(filePath, personalRoot)) throw new Error('只允许整理个人桌面第一层项目');
  await assertNoLinkSegments(filePath);
  const [realParent, realRoot, stat] = await Promise.all([
    fsp.realpath(path.dirname(filePath)),
    fsp.realpath(personalRoot),
    fsp.lstat(filePath),
  ]);
  if (normalized(realParent) !== normalized(realRoot)) throw new Error('来源位置已发生变化，请刷新后重试');
  if (stat.isSymbolicLink()) throw new Error('符号链接或目录联接不允许移动');
  return stat;
}

async function validateArchiveDestination(destinationDir, personalRoot, create = false) {
  const realPersonalRoot = await assertRealPath(personalRoot);
  if (isWithin(destinationDir, personalRoot)) {
    await assertNoLinkSegments(destinationDir);
    if (create) await fsp.mkdir(destinationDir, { recursive: true });
    if (fs.existsSync(destinationDir)) {
      const realDestination = await assertRealPath(destinationDir);
      if (!isWithin(realDestination, realPersonalRoot)) throw new Error('桌面归档目录解析到了桌面之外');
    }
    return destinationDir;
  }
  const realDestination = await assertRealPath(destinationDir);
  if (isWithin(realDestination, realPersonalRoot)) throw new Error('独立归档目录不能位于桌面内部');
  return realDestination;
}

function shortcutSearchRoots() {
  return [...new Set([
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps'),
  ].filter((value) => value && fs.existsSync(value)))];
}

async function searchShortcutCandidates(item) {
  const targetName = path.basename(item.target || '').toLocaleLowerCase('en-US');
  const itemName = item.name.toLocaleLowerCase('zh-CN').replace(/\s*-\s*快捷方式$/u, '');
  const deadline = Date.now() + 5000;
  const queue = shortcutSearchRoots().map((root) => ({ directory: root, depth: 0 }));
  const candidates = [];
  let visited = 0;
  while (queue.length && visited < 18000 && Date.now() < deadline && candidates.length < 30) {
    const { directory, depth } = queue.shift();
    let entries;
    try { entries = await fsp.readdir(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      visited += 1;
      if (visited >= 18000 || Date.now() >= deadline) break;
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory() && depth < 6) queue.push({ directory: fullPath, depth: depth + 1 });
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.exe') continue;
      const executableName = entry.name.toLocaleLowerCase('en-US');
      const exactTarget = targetName && executableName === targetName;
      const nameMatch = itemName.length >= 3 && fullPath.toLocaleLowerCase('zh-CN').includes(itemName);
      if (!exactTarget && !nameMatch) continue;
      candidates.push({ path: fullPath, score: (exactTarget ? 100 : 0) + (nameMatch ? 30 : 0) - depth });
    }
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, 12);
}

function approveShortcutCandidate(item, candidatePath, score = 0) {
  const token = crypto.randomUUID();
  approvedShortcutRepairs.set(token, { itemId: item.id, shortcutPath: item.path, candidatePath, score, createdAt: Date.now() });
  return { token, path: candidatePath, name: path.basename(candidatePath), score };
}

async function repairShortcut(token) {
  const approved = approvedShortcutRepairs.get(token);
  if (!approved || Date.now() - approved.createdAt > 10 * 60 * 1000) throw new Error('修复候选已过期，请重新搜索');
  approvedShortcutRepairs.delete(token);
  await scanDesktop();
  const item = findItem(approved.itemId);
  if (!item || item.scope !== 'personal' || item.type !== 'shortcut') throw new Error('只允许修复个人桌面的快捷方式');
  const personalRoot = desktopRoots().find((root) => root.scope === 'personal').path;
  await validatePersonalSource(item.path, personalRoot);
  const candidate = await assertRealPath(approved.candidatePath);
  if (path.extname(candidate).toLowerCase() !== '.exe') throw new Error('修复目标必须是可执行程序');
  const details = await shortcutDetails(item.path);
  if (!details) throw new Error('无法读取原快捷方式');
  const backupDirectory = path.join(app.getPath('userData'), 'shortcut-backups');
  await fsp.mkdir(backupDirectory, { recursive: true });
  const backupPath = path.join(backupDirectory, `${item.id}-${Date.now()}.lnk`);
  await fsp.copyFile(item.path, backupPath);
  const written = shell.writeShortcutLink(item.path, 'update', {
    target: candidate,
    cwd: details.cwd || path.dirname(candidate),
    args: details.args || '',
    description: details.description || '',
    icon: details.icon || candidate,
    iconIndex: Number.isFinite(details.iconIndex) ? details.iconIndex : 0,
    appUserModelId: details.appUserModelId || '',
  });
  if (!written) throw new Error('Windows 未能写入快捷方式');
  const verified = await shortcutDetails(item.path);
  if (normalized(verified?.target || '') !== normalized(candidate)) {
    await fsp.copyFile(backupPath, item.path);
    throw new Error('快捷方式写入校验失败，已恢复原文件');
  }
  const operation = { id: item.id, name: item.name, source: item.path, target: candidate, renamed: false };
  const history = await readJson(historyPath(), []);
  history.unshift({ id: crypto.randomUUID(), type: 'shortcut-repair', status: 'completed', timestamp: Date.now(), categoryId: item.categoryId, categoryLabel: '快捷方式修复', itemCount: 1, operations: [operation], pendingOperations: [operation], shortcutPath: item.path, backupPath, oldTarget: details.target || '', newTarget: candidate, oldShortcutSignature: shortcutSignature(details), repairedShortcutSignature: shortcutSignature(verified), undone: false });
  await writeJson(historyPath(), trimHistory(history));
  await notifyDesktopChanged('shortcut-repair');
  return { payload: await scanDesktop(), oldTarget: details.target || '', newTarget: candidate };
}

async function previewOrganize(ids, categoryId) {
  await scanDesktop();
  const settings = await getSettings();
  const category = settings.categories.find((entry) => entry.id === categoryId);
  if (!category || category.id === 'inbox') throw new Error('请选择有效的归档分类');
  const personalRoot = desktopRoots().find((root) => root.scope === 'personal').path;
  const destinationDir = category.archivePath || path.join(personalRoot, ARCHIVE_NAME, category.archiveFolder || safeCategoryFolder(category.label));
  await validateArchiveDestination(destinationDir, personalRoot, false);
  const operations = [];
  const failures = [];
  for (const id of [...new Set(ids)]) {
    const item = findItem(id);
    if (!item) {
      failures.push({ id, reason: '项目已不存在' });
      continue;
    }
    if (item.scope !== 'personal') {
      failures.push({ id, name: item.fileName, reason: '公共桌面项目仅支持虚拟分类' });
      continue;
    }
    if (!isDirectChild(item.path, personalRoot)) {
      failures.push({ id, name: item.fileName, reason: '只允许整理个人桌面第一层项目' });
      continue;
    }
    let sourceStat;
    try {
      sourceStat = await validatePersonalSource(item.path, personalRoot);
    } catch (error) {
      failures.push({ id, name: item.fileName, reason: error.message || '项目已不存在或无法读取' });
      continue;
    }
    try {
      const stat = await fsp.lstat(item.path);
      if (stat.isSymbolicLink()) {
        failures.push({ id, name: item.fileName, reason: '符号链接不允许移动' });
        continue;
      }
    } catch {
      failures.push({ id, name: item.fileName, reason: '项目已不存在或无法读取' });
      continue;
    }
    const candidate = path.join(destinationDir, item.fileName);
    const target = uniquePath(candidate, fs.existsSync);
    operations.push({ id, name: item.fileName, source: item.path, target, renamed: target !== candidate, sourceIdentity: { size: sourceStat.size, mtimeMs: sourceStat.mtimeMs, ino: sourceStat.ino, dev: sourceStat.dev } });
  }
  return { categoryId, categoryLabel: category.label, destinationDir, operations, failures };
}

async function executeOrganize(ids, categoryId) {
  const plan = await previewOrganize(ids, categoryId);
  if (!plan.operations.length) return { ...plan, completed: [], failed: plan.failures };
  await saveCurrentSnapshot(`整理前：${plan.categoryLabel}`, true);
  const transactionId = crypto.randomUUID();
  const personalRoot = desktopRoots().find((root) => root.scope === 'personal').path;
  await validateArchiveDestination(plan.destinationDir, personalRoot, true);
  const journal = await readJson(historyPath(), []);
  journal.unshift({
    id: transactionId,
    type: 'organize',
    status: 'pending',
    timestamp: Date.now(),
    categoryId,
    categoryLabel: plan.categoryLabel,
    personalRoot,
    destinationDir: plan.destinationDir,
    itemCount: plan.operations.length,
    operations: plan.operations,
    pendingOperations: plan.operations,
    failedOperations: plan.failures,
    undone: false,
  });
  await writeJson(historyPath(), trimHistory(journal));
  const moveResult = await executeOperations(plan.operations, {
    trash: (targetPath) => shell.trashItem(targetPath),
    createRecoveryJournal: (operation) => moveRecoveryService.createRecoveryJournal(operation),
  });
  const completed = moveResult.completed;
  const failed = [...plan.failures, ...moveResult.failed];
  if (completed.length) {
    const settings = await getSettings();
    for (const operation of completed) {
      settings.favorites = settings.favorites.filter((id) => id !== operation.id);
      settings.hidden = settings.hidden.filter((id) => id !== operation.id);
      settings.newItemIds = settings.newItemIds.filter((id) => id !== operation.id);
      delete settings.assignments[operation.id];
    }
    await saveSettings(settings);
  }
  const history = await readJson(historyPath(), []);
  const transaction = history.find((entry) => entry.id === transactionId);
  if (transaction) {
    transaction.status = completed.length ? (failed.length ? 'partial' : 'completed') : 'failed';
    transaction.itemCount = completed.length;
    transaction.operations = completed;
    transaction.pendingOperations = completed;
    transaction.failedOperations = failed;
    transaction.completedAt = Date.now();
    transaction.undone = completed.length === 0;
    await writeJson(historyPath(), trimHistory(history));
  }
  await notifyDesktopChanged('organize');
  return { ...plan, completed, failed };
}

async function undoOperation(transactionId = null) {
  const history = await readJson(historyPath(), []);
  const transaction = transactionId ? history.find((entry) => entry.id === transactionId) : history.find((entry) => !entry.undone && entry.pendingOperations?.length);
  if (transaction?.type === 'shortcut-repair') {
    try {
      const personalRoot = desktopRoots().find((root) => root.scope === 'personal').path;
      if (!isDirectChild(transaction.shortcutPath, personalRoot)) throw new Error('快捷方式已不在个人桌面');
      const backupRoot = path.join(app.getPath('userData'), 'shortcut-backups');
      const [realBackup, realBackupRoot] = await Promise.all([assertRealPath(transaction.backupPath), assertRealPath(backupRoot)]);
      if (!isWithin(realBackup, realBackupRoot)) throw new Error('快捷方式备份位置无效');
      await validatePersonalSource(transaction.shortcutPath, personalRoot);
      const current = await shortcutDetails(transaction.shortcutPath);
      if (!current || shortcutSignature(current) !== transaction.repairedShortcutSignature) throw new Error('快捷方式在修复后又被修改，已停止撤销以避免覆盖后续修改');
      await fsp.copyFile(realBackup, transaction.shortcutPath);
      const verified = await shortcutDetails(transaction.shortcutPath);
      if (!verified || shortcutSignature(verified) !== transaction.oldShortcutSignature) throw new Error('原快捷方式恢复校验失败');
      transaction.undone = true;
      transaction.status = 'undone';
      transaction.pendingOperations = [];
      transaction.lastUndoAt = Date.now();
      transaction.lastUndoFailures = [];
      await writeJson(historyPath(), trimHistory(history));
      await notifyDesktopChanged('shortcut-repair-undo');
      return { transactionId: transaction.id, restored: transaction.operations, failed: [], message: '快捷方式已恢复到修复前状态' };
    } catch (error) {
      const failed = transaction.operations.map((operation) => ({ ...operation, reason: error.message || String(error) }));
      transaction.lastUndoFailures = failed;
      await writeJson(historyPath(), trimHistory(history));
      return { transactionId: transaction.id, restored: [], failed };
    }
  }
  if (!transaction) return { restored: [], failed: [], message: '没有可撤销的整理操作' };
  const personalRoot = transaction.personalRoot || desktopRoots().find((root) => root.scope === 'personal').path;
  const archiveRoot = transaction.destinationDir || path.join(personalRoot, ARCHIVE_NAME);
  const pendingOperations = transaction.pendingOperations || transaction.operations;
  const { restored, failed } = await restoreOperations(pendingOperations, { personalRoot, archiveRoot, archiveRoots: [transaction.destinationDir], trash: (targetPath) => shell.trashItem(targetPath) });
  reconcileUndo(transaction, restored);
  transaction.status = transaction.undone ? 'undone' : (restored.length ? 'partially-undone' : transaction.status);
  transaction.lastUndoAt = Date.now();
  transaction.lastUndoFailures = failed;
  await writeJson(historyPath(), trimHistory(history));
  await notifyDesktopChanged('undo');
  return { transactionId: transaction.id, restored, failed };
}

function clearDockTimers() {
  clearTimeout(dockHideTimer);
  clearTimeout(dockRevealTimer);
  dockHideTimer = null;
  dockRevealTimer = null;
}

function stopDockAnimation() {
  if (dockAnimationTimer) clearInterval(dockAnimationTimer);
  dockAnimationTimer = null;
  suppressDockBoundsPersistence = false;
}

function sendSettingsChanged(settings = settingsCache) {
  if (!settings) return;
  for (const window of [mainWindow, dockWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send('settings:changed', settings);
  }
}

function createDockPreviewWindow() {
  if (dockPreviewWindow && !dockPreviewWindow.isDestroyed()) return dockPreviewWindow;
  dockPreviewWindow = new BrowserWindow({
    width: 388,
    height: 680,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    focusable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const previewHtml = '<!doctype html><html><head><meta charset="utf-8"><style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}body{box-sizing:border-box;border:2px solid rgba(20,122,104,.9);background:rgba(20,122,104,.14);box-shadow:inset 0 0 0 1px rgba(255,255,255,.55)}</style></head><body></body></html>';
  void dockPreviewWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(previewHtml)}`);
  dockPreviewWindow.setIgnoreMouseEvents(true);
  dockPreviewWindow.setAlwaysOnTop(true, 'pop-up-menu');
  dockPreviewWindow.on('closed', () => { dockPreviewWindow = null; });
  return dockPreviewWindow;
}

function showDockPreview(candidate) {
  const preview = createDockPreviewWindow();
  preview.setBounds(candidate.bounds, false);
  preview.showInactive();
}

function hideDockPreview() {
  if (dockPreviewWindow && !dockPreviewWindow.isDestroyed()) dockPreviewWindow.hide();
}

function resolveConfiguredDockTarget(settings = settingsCache, preferredBounds = dockExpandedBounds || settings?.dockBounds) {
  if (!settings?.quickPanelDocked) return null;
  return resolveDockTarget(screen.getAllDisplays(), {
    position: settings.quickPanelDockPosition,
    displayId: settings.quickPanelDockDisplayId,
    preferredBounds,
  });
}

function animateDockTo(target, collapsed) {
  if (!dockWindow || dockWindow.isDestroyed()) return;
  stopDockAnimation();
  dockCollapsed = collapsed;
  const start = dockWindow.getBounds();
  const duration = settingsCache?.reduceMotion ? 0 : (settingsCache?.quickPanelSlideDuration || 180);
  if (!duration || ['x', 'y', 'width', 'height'].every((key) => start[key] === target[key])) {
    suppressDockBoundsPersistence = true;
    dockWindow.setBounds(target, false);
    suppressDockBoundsPersistence = false;
    return;
  }
  const startedAt = Date.now();
  suppressDockBoundsPersistence = true;
  dockAnimationTimer = setInterval(() => {
    if (!dockWindow || dockWindow.isDestroyed()) {
      stopDockAnimation();
      return;
    }
    const progress = Math.min(1, (Date.now() - startedAt) / duration);
    const eased = 1 - ((1 - progress) ** 3);
    const next = Object.fromEntries(['x', 'y', 'width', 'height'].map((key) => [key, Math.round(start[key] + (target[key] - start[key]) * eased)]));
    dockWindow.setBounds(next, false);
    if (progress >= 1) {
      clearInterval(dockAnimationTimer);
      dockAnimationTimer = null;
      suppressDockBoundsPersistence = false;
    }
  }, 16);
}

function cursorWithinDock(tolerance = 4) {
  if (!dockWindow || dockWindow.isDestroyed() || !dockWindow.isVisible()) return false;
  const point = screen.getCursorScreenPoint();
  const bounds = dockWindow.getBounds();
  return point.x >= bounds.x - tolerance
    && point.x <= bounds.x + bounds.width + tolerance
    && point.y >= bounds.y - tolerance
    && point.y <= bounds.y + bounds.height + tolerance;
}

function revealDock({ focus = false } = {}) {
  if (!dockWindow || dockWindow.isDestroyed()) return;
  clearDockTimers();
  const settings = settingsCache || defaultSettings;
  const target = resolveConfiguredDockTarget(settings);
  if (target) {
    dockExpandedBounds = target.bounds;
  } else if (settings.dockBounds) {
    const current = dockWindow.getBounds();
    dockExpandedBounds = { ...current, x: settings.dockBounds.x, y: settings.dockBounds.y };
  }
  if (!dockWindow.isVisible()) dockWindow.show();
  dockRevealGraceUntil = Date.now() + (settings.reduceMotion ? 0 : settings.quickPanelSlideDuration) + 360;
  animateDockTo(dockExpandedBounds, false);
  if (focus) dockWindow.focus();
}

function collapseDock() {
  clearTimeout(dockHideTimer);
  dockHideTimer = null;
  if (!dockWindow || dockWindow.isDestroyed() || !settingsCache?.quickPanelDocked || settingsCache?.quickPanelPinned || settingsCache?.quickPanelAutoHide === false || dockPointerInside || dockDragging) return;
  const graceRemaining = dockRevealGraceUntil - Date.now();
  if (graceRemaining > 0) {
    dockHideTimer = setTimeout(collapseDock, graceRemaining + 20);
    return;
  }
  if (cursorWithinDock()) {
    dockHideTimer = setTimeout(collapseDock, 180);
    return;
  }
  const target = resolveConfiguredDockTarget(settingsCache);
  if (!target) return;
  dockExpandedBounds = target.bounds;
  dockRevealGraceUntil = 0;
  animateDockTo(collapsedDockBoundsForTarget(dockExpandedBounds, target, settingsCache.quickPanelTriggerSize), true);
}

function scheduleDockCollapse() {
  clearTimeout(dockHideTimer);
  if (!dockWindow || dockWindow.isDestroyed() || !settingsCache?.quickPanelDocked || settingsCache?.quickPanelPinned || settingsCache?.quickPanelAutoHide === false || dockPointerInside || dockDragging) return;
  const delay = Math.max(settingsCache?.quickPanelHideDelay || 700, dockRevealGraceUntil - Date.now());
  dockHideTimer = setTimeout(collapseDock, Math.max(0, delay));
}

function handleDockPointerEnter() {
  dockPointerInside = true;
  clearTimeout(dockHideTimer);
  dockHideTimer = null;
  if (!dockCollapsed) return;
  clearTimeout(dockRevealTimer);
  dockRevealTimer = setTimeout(() => {
    if (dockPointerInside) revealDock();
  }, 110);
}

function handleDockPointerLeave() {
  dockPointerInside = false;
  clearTimeout(dockRevealTimer);
  dockRevealTimer = null;
  scheduleDockCollapse();
}

function applyDockSettings({ reveal = false } = {}) {
  if (!dockWindow || dockWindow.isDestroyed()) return;
  clearDockTimers();
  const target = resolveConfiguredDockTarget(settingsCache, dockWindow.getBounds());
  if (!target) {
    dockCollapsed = false;
    return;
  }
  dockExpandedBounds = target.bounds;
  if (reveal || settingsCache?.quickPanelPinned || settingsCache?.quickPanelAutoHide === false || !dockCollapsed) {
    animateDockTo(dockExpandedBounds, false);
  } else {
    animateDockTo(collapsedDockBoundsForTarget(dockExpandedBounds, target, settingsCache?.quickPanelTriggerSize), true);
  }
}

const dockEdgeDistance = dockService.edgeDistance;

function updateDockDragPreview() {
  if (!dockWindow || dockWindow.isDestroyed() || !dockDragging) return;
  const bounds = dockWindow.getBounds();
  const snapDistance = settingsCache?.quickPanelSnapDistance || 28;
  const originDistance = dockEdgeDistance(bounds, dockDragOriginTarget);
  if (dockDragOriginTarget && !dockDragDetached && originDistance >= 8) dockDragDetached = true;
  if (dockDragDetached && originDistance >= snapDistance + 14) dockDragOriginRearmed = true;
  dockDragCandidate = findNearestDockTarget(bounds, screen.getAllDisplays(), snapDistance);
  if (dockDragDetached && !dockDragOriginRearmed) dockDragCandidate = null;
  if (dockDragCandidate) showDockPreview(dockDragCandidate);
  else hideDockPreview();
}

async function finishDockDrag() {
  if (!dockWindow || dockWindow.isDestroyed() || !dockDragging) return;
  dockDragging = false;
  hideDockPreview();
  const settings = await getSettings();
  const currentBounds = dockWindow.getBounds();
  let candidate = dockDragCandidate || findNearestDockTarget(currentBounds, screen.getAllDisplays(), settings.quickPanelSnapDistance);
  if (dockDragDetached && !dockDragOriginRearmed) candidate = null;
  dockDragCandidate = null;
  dockDragOriginTarget = null;
  dockDragDetached = false;
  dockDragOriginRearmed = false;
  dockCollapsed = false;
  if (candidate) {
    settings.quickPanelDocked = true;
    settings.quickPanelDockPosition = candidate.position;
    settings.quickPanelDockDisplayId = candidate.displayId;
    settings.dockBounds = { x: candidate.bounds.x, y: candidate.bounds.y };
    dockExpandedBounds = candidate.bounds;
    await saveSettings(settings);
    sendSettingsChanged(settings);
    animateDockTo(candidate.bounds, false);
    if (!dockPointerInside) scheduleDockCollapse();
    return;
  }
  settings.quickPanelDocked = false;
  settings.quickPanelDockDisplayId = '';
  settings.dockBounds = { x: currentBounds.x, y: currentBounds.y };
  dockExpandedBounds = currentBounds;
  await saveSettings(settings);
  sendSettingsChanged(settings);
}

function hideDock() {
  clearDockTimers();
  stopDockAnimation();
  dockPointerInside = false;
  dockDragging = false;
  dockDragCandidate = null;
  dockDragOriginTarget = null;
  dockDragDetached = false;
  dockDragOriginRearmed = false;
  hideDockPreview();
  dockRevealGraceUntil = 0;
  dockCollapsed = false;
  if (dockWindow && !dockWindow.isDestroyed()) dockWindow.hide();
}

function createWindow(route = 'main') {
  const isDock = route === 'dock';
  const dockState = dockService.initialWindowState(settingsCache || defaultSettings);
  const defaultDockBounds = dockState.bounds;
  const savedMainBounds = settingsCache?.mainBounds;
  const mainBoundsValid = savedMainBounds
    && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(savedMainBounds[key]))
    && savedMainBounds.width >= 980
    && savedMainBounds.height >= 680;
  const mainBoundsVisible = mainBoundsValid && dockService.boundsVisible(screen.getAllDisplays(), savedMainBounds, savedMainBounds.width, savedMainBounds.height);
  const bounds = isDock
    ? defaultDockBounds
    : { ...(mainBoundsVisible ? savedMainBounds : { width: 1240, height: 820 }), minWidth: 980, minHeight: 680 };
  const window = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#F4F6F5',
    resizable: !isDock,
    alwaysOnTop: isDock,
    skipTaskbar: isDock,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const routeHash = route === 'dock' ? '#/dock' : '#/';
  if (process.env.VITE_DEV_SERVER_URL) window.loadURL(`${process.env.VITE_DEV_SERVER_URL}/${routeHash}`);
  else window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: route === 'dock' ? '/dock' : '/' });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    const allowedPrefix = process.env.VITE_DEV_SERVER_URL || 'file://';
    if (!url.startsWith(allowedPrefix)) event.preventDefault();
  });
  window.once('ready-to-show', () => window.show());
  if (isDock) {
    dockExpandedBounds = defaultDockBounds;
    dockCollapsed = false;
    window.on('will-move', () => {
      if (suppressDockBoundsPersistence || dockCollapsed || !window.isVisible()) return;
      stopDockAnimation();
      clearDockTimers();
      dockDragging = true;
      dockDragCandidate = null;
      dockDragOriginTarget = resolveConfiguredDockTarget(settingsCache, window.getBounds());
      dockDragDetached = !dockDragOriginTarget;
      dockDragOriginRearmed = false;
    });
    window.on('move', () => updateDockDragPreview());
    window.on('moved', () => { if (dockDragging) void finishDockDrag(); });
    window.on('blur', () => {
      if (!window.webContents.isDevToolsOpened()) scheduleDockCollapse();
    });
    window.on('closed', () => {
      clearDockTimers();
      stopDockAnimation();
      dockWindow = null;
      dockExpandedBounds = null;
      dockDragging = false;
      dockDragCandidate = null;
      dockDragOriginTarget = null;
      dockDragDetached = false;
      dockDragOriginRearmed = false;
      if (dockPreviewWindow && !dockPreviewWindow.isDestroyed()) dockPreviewWindow.destroy();
      dockRevealGraceUntil = 0;
      dockCollapsed = false;
    });
  } else {
    const persistMainBounds = () => {
      clearTimeout(mainBoundsTimer);
      mainBoundsTimer = setTimeout(async () => {
        if (!window.isDestroyed() && !window.isMaximized() && !window.isMinimized()) {
          const settings = await getSettings();
          settings.mainBounds = window.getBounds();
          await saveSettings(settings);
        }
      }, 350);
    };
    window.on('move', persistMainBounds);
    window.on('resize', persistMainBounds);
  }
  return window;
}

function showMain() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow('main');
    mainWindow.on('close', (event) => {
      if (isQuitting) return;
      event.preventDefault();
      if (settingsCache?.closeToTray !== false) mainWindow.hide();
      else {
        isQuitting = true;
        app.quit();
      }
    });
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function toggleDock() {
  if (!dockWindow || dockWindow.isDestroyed()) dockWindow = createWindow('dock');
  else if (dockWindow.isVisible() && !dockCollapsed) hideDock();
  else {
    revealDock({ focus: true });
  }
}

async function createTray() {
  let image;
  try {
    image = await app.getFileIcon(process.execPath, { size: 'small' });
  } catch {
    image = nativeImage.createEmpty();
  }
  tray = new Tray(image);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开工作台', click: showMain },
    { label: '快速面板', click: toggleDock },
    { label: '设置', click: openSettingsFromTray },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('double-click', showMain);
}

function openSettingsFromTray() {
  showMain();
  const send = () => mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.send('ui:open-settings');
  if (mainWindow.webContents.isLoadingMainFrame()) mainWindow.webContents.once('did-finish-load', send);
  else send();
}

async function registerHotkey(accelerator) {
  globalShortcut.unregisterAll();
  let registered = false;
  try {
    registered = globalShortcut.register(accelerator, toggleDock);
  } catch {
    registered = false;
  }
  if (!registered) {
    const fallback = 'Ctrl+Alt+D';
    try { globalShortcut.register(fallback, toggleDock); } catch {}
    return fallback;
  }
  return accelerator;
}

async function notifyDesktopChanged(reason = 'watcher') {
  const payload = await scanDesktop();
  for (const window of [mainWindow, dockWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send('desktop:changed', { reason, ...payload });
  }
}

function startDesktopWatchers() {
  scannerService.startWatchers(() => { void notifyDesktopChanged('watcher'); });
}

async function openWorkspaceItem(id, notify = true) {
  const item = findItem(id) || (await scanDesktop(), findItem(id));
  if (!item || !item.exists) throw new Error('项目不存在');
  const error = await shell.openPath(item.path);
  if (error) throw new Error(error);
  await markUsage(id);
  if (notify) await notifyDesktopChanged('usage');
  return item;
}

async function launchCategory(categoryId) {
  await scanDesktop();
  const settings = await getSettings();
  const category = settings.categories.find((entry) => entry.id === categoryId);
  if (!category) throw new Error('工作场景不存在');
  const steps = sanitizeLaunchSteps(category.launchSteps || []).filter((step) => step.enabled);
  if (!steps.length) throw new Error('这个工作场景还没有配置启动内容');
  const completed = [];
  const failed = [];
  for (const step of steps) {
    try {
      if (step.type === 'item') await openWorkspaceItem(step.value, false);
      if (step.type === 'url') await shell.openExternal(step.value, { activate: true });
      if (step.type === 'delay') await new Promise((resolve) => setTimeout(resolve, Number(step.value)));
      completed.push({ id: step.id, type: step.type, label: step.label, value: step.value });
    } catch (error) {
      failed.push({ id: step.id, type: step.type, label: step.label, value: step.value, reason: error.message || String(error) });
    }
  }
  await notifyDesktopChanged('scene-launch');
  return { categoryId, categoryLabel: category.label, completed, failed };
}

function registerIpc() {
  ipcMain.handle('desktop:list', scanDesktop);
  ipcMain.handle('desktop:open', async (_event, id) => { await openWorkspaceItem(id); return true; });
  ipcMain.handle('desktop:reveal', async (_event, id) => {
    const item = findItem(id) || (await scanDesktop(), findItem(id));
    if (!item) throw new Error('项目不存在');
    shell.showItemInFolder(item.path);
    return true;
  });
  ipcMain.handle('desktop:reorder-items', async (_event, { orderedIds, view }) => {
    if (!Array.isArray(orderedIds) || orderedIds.length < 2 || orderedIds.length > 500 || orderedIds.some((id) => typeof id !== 'string') || new Set(orderedIds).size !== orderedIds.length) throw new Error('图标排序数据无效');
    if (typeof view !== 'string' || view === 'everything') throw new Error('当前页面不支持图标排序');
    await scanDesktop();
    const knownIds = new Set(lastItems.map((item) => item.id));
    if (orderedIds.some((id) => !knownIds.has(id))) throw new Error('部分项目已不在工作台，请刷新后重试');
    const settings = await getSettings();
    const allowedViews = new Set(['all', 'favorites', 'recent', 'duplicates', 'duplicate-shortcuts', 'duplicate-files', 'duplicate-exact', 'broken', 'stale', 'hidden', ...settings.categories.map((category) => category.id)]);
    if (!allowedViews.has(view)) throw new Error('当前页面不支持图标排序');
    const nameOrderedIds = [...lastItems].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true })).map((item) => item.id);
    settings.itemOrder = mergeVisibleOrder(settings.itemOrder.length ? settings.itemOrder : nameOrderedIds, nameOrderedIds, orderedIds);
    settings.sortMode = 'custom';
    settings.categorySortModes = { ...settings.categorySortModes, [view]: 'custom' };
    return saveSettings(settings);
  });
  ipcMain.handle('desktop:assign-category', async (_event, { id, categoryId }) => {
    const settings = await getSettings();
    if (!settings.categories.some((entry) => entry.id === categoryId)) throw new Error('分类不存在');
    settings.assignments[id] = categoryId;
    settings.newItemIds = settings.newItemIds.filter((value) => value !== id);
    await saveSettings(settings);
    return scanDesktop();
  });
  ipcMain.handle('desktop:assign-category-many', async (_event, { ids, categoryId }) => {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 500 || ids.some((id) => typeof id !== 'string')) throw new Error('拖拽项目数据无效');
    const uniqueIds = [...new Set(ids)];
    const settings = await getSettings();
    if (!settings.categories.some((entry) => entry.id === categoryId)) throw new Error('分类不存在');
    if (uniqueIds.some((id) => !findItem(id))) throw new Error('部分项目已不在桌面，请刷新后重试');
    for (const id of uniqueIds) settings.assignments[id] = categoryId;
    settings.newItemIds = settings.newItemIds.filter((value) => !uniqueIds.includes(value));
    await saveSettings(settings);
    return scanDesktop();
  });
  ipcMain.handle('desktop:toggle-favorite', async (_event, id) => {
    const settings = await getSettings();
    settings.favorites = settings.favorites.includes(id) ? settings.favorites.filter((value) => value !== id) : [...settings.favorites, id];
    await saveSettings(settings);
    return scanDesktop();
  });
  ipcMain.handle('desktop:set-favorites', async (_event, { ids, favorite }) => {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 500 || ids.some((id) => typeof id !== 'string') || typeof favorite !== 'boolean') throw new Error('收藏项目数据无效');
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.some((id) => !findItem(id))) throw new Error('部分项目已不在桌面，请刷新后重试');
    const settings = await getSettings();
    const favorites = new Set(settings.favorites);
    for (const id of uniqueIds) {
      if (favorite) favorites.add(id); else favorites.delete(id);
    }
    settings.favorites = [...favorites];
    await saveSettings(settings);
    return scanDesktop();
  });
  ipcMain.handle('desktop:set-hidden', async (_event, { id, hidden }) => {
    const settings = await getSettings();
    settings.hidden = hidden ? [...new Set([...settings.hidden, id])] : settings.hidden.filter((value) => value !== id);
    await saveSettings(settings);
    return scanDesktop();
  });
  ipcMain.handle('desktop:set-hidden-many', async (_event, { ids, hidden }) => {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 500 || ids.some((id) => typeof id !== 'string') || typeof hidden !== 'boolean') throw new Error('隐藏项目数据无效');
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.some((id) => !findItem(id))) throw new Error('部分项目已不在工作台，请刷新后重试');
    const settings = await getSettings();
    const hiddenIds = new Set(settings.hidden);
    for (const id of uniqueIds) {
      if (hidden) hiddenIds.add(id); else hiddenIds.delete(id);
    }
    settings.hidden = [...hiddenIds];
    await saveSettings(settings);
    return scanDesktop();
  });
  ipcMain.handle('desktop:set-inbox-many', async (_event, ids) => {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 500 || ids.some((id) => typeof id !== 'string')) throw new Error('待整理项目数据无效');
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.some((id) => !findItem(id))) throw new Error('部分项目已不在工作台，请刷新后重试');
    const settings = await getSettings();
    for (const id of uniqueIds) delete settings.assignments[id];
    settings.newItemIds = [...new Set([...settings.newItemIds, ...uniqueIds])];
    await saveSettings(settings);
    return scanDesktop();
  });
  ipcMain.handle('desktop:reveal-many', async (_event, ids) => {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 10 || ids.some((id) => typeof id !== 'string')) throw new Error('一次最多定位 10 个项目');
    const uniqueItems = [...new Set(ids)].map(findItem);
    if (uniqueItems.some((item) => !item)) throw new Error('部分项目已不在工作台，请刷新后重试');
    for (const item of uniqueItems) shell.showItemInFolder(item.path);
    return uniqueItems.length;
  });
  ipcMain.handle('desktop:mark-inbox-seen', async () => {
    const settings = await getSettings();
    settings.newItemIds = [];
    await saveSettings(settings);
    return scanDesktop();
  });
  ipcMain.handle('desktop:accept-suggestions', async (_event, ids) => {
    if (!Array.isArray(ids) || ids.length > 500) throw new Error('建议项目数据无效');
    const settings = await getSettings();
    let accepted = 0;
    for (const id of [...new Set(ids)]) {
      const item = findItem(id);
      if (!item?.suggestedCategoryId || !settings.categories.some((category) => category.id === item.suggestedCategoryId)) continue;
      settings.assignments[id] = item.suggestedCategoryId;
      settings.newItemIds = settings.newItemIds.filter((value) => value !== id);
      accepted += 1;
    }
    await saveSettings(settings);
    return { payload: await scanDesktop(), accepted };
  });
  ipcMain.handle('desktop:scan-exact-duplicates', async (event, ids) => {
    if (activeDuplicateScans.has(event.sender.id)) throw new Error('精确重复扫描已经在运行');
    const control = { cancelled: false };
    activeDuplicateScans.set(event.sender.id, control);
    try {
      return await scanExactDuplicates(ids, { isCancelled: () => control.cancelled, onProgress: (progress) => { if (!event.sender.isDestroyed()) event.sender.send('desktop:duplicate-progress', progress); } });
    } finally {
      activeDuplicateScans.delete(event.sender.id);
    }
  });
  ipcMain.handle('desktop:cancel-exact-duplicates', (event) => {
    const control = activeDuplicateScans.get(event.sender.id);
    if (control) control.cancelled = true;
    return Boolean(control);
  });
  ipcMain.handle('desktop:preview-organize', (_event, { ids, categoryId }) => previewOrganize(ids, categoryId));
  ipcMain.handle('desktop:execute-organize', (_event, { ids, categoryId }) => enqueueFileOperation(() => executeOrganize(ids, categoryId)));
  ipcMain.handle('desktop:undo', (_event, transactionId) => enqueueFileOperation(() => undoOperation(transactionId)));
  ipcMain.handle('recovery:list', () => moveRecoveryService.listRecoveryIssues());
  ipcMain.handle('recovery:recover', async (_event, id) => enqueueFileOperation(async () => {
    const result = await moveRecoveryService.recover(id);
    await notifyDesktopChanged('move-recovery');
    return { result, remaining: await moveRecoveryService.listRecoveryIssues() };
  }));
  ipcMain.handle('recovery:recover-all', () => enqueueFileOperation(async () => {
    const result = await moveRecoveryService.recoverAll();
    await notifyDesktopChanged('move-recovery');
    return result;
  }));
  ipcMain.handle('recovery:reveal', (_event, id) => moveRecoveryService.reveal(id, (targetPath) => shell.showItemInFolder(targetPath)));
  ipcMain.handle('desktop:history', () => readJson(historyPath(), []));
  ipcMain.handle('desktop:reveal-history', async (_event, transactionId) => {
    const history = await readJson(historyPath(), []);
    const transaction = history.find((entry) => entry.id === transactionId);
    if (transaction?.type === 'shortcut-repair' && transaction.shortcutPath) {
      shell.showItemInFolder(transaction.shortcutPath);
      return true;
    }
    if (!transaction?.destinationDir) throw new Error('整理记录没有可定位的归档目录');
    const error = await shell.openPath(transaction.destinationDir);
    if (error) throw new Error(error);
    return true;
  });
  ipcMain.handle('external:add', async (event, kind) => {
    if (!['file', 'folder'].includes(kind)) throw new Error('外部项目类型无效');
    const owner = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(owner, {
      title: kind === 'folder' ? '添加常用文件夹到工作台' : '添加常用文件到工作台',
      properties: kind === 'folder' ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'],
    });
    if (result.canceled || !result.filePaths.length) return scanDesktop();
    const roots = desktopRoots();
    const selected = [];
    for (const selectedPath of result.filePaths.slice(0, 50)) {
      await assertNoLinkSegments(selectedPath);
      const real = await fsp.realpath(selectedPath);
      if (roots.some((root) => isWithin(real, root.path))) throw new Error('桌面内项目已经自动显示，无需重复添加');
      selected.push(real);
    }
    const settings = await getSettings();
    const paths = new Set(settings.externalItems.map((entry) => normalized(entry.path)));
    for (const selectedPath of selected) {
      if (!paths.has(normalized(selectedPath))) settings.externalItems.push({ path: selectedPath, addedAt: Date.now() });
    }
    await saveSettings(settings);
    return scanDesktop();
  });
  ipcMain.handle('external:remove', async (_event, id) => {
    const item = findItem(id) || (await scanDesktop(), findItem(id));
    if (!item || item.scope !== 'external') throw new Error('外部项目不存在');
    const settings = await getSettings();
    settings.externalItems = settings.externalItems.filter((entry) => normalized(entry.path) !== normalized(item.path));
    settings.favorites = settings.favorites.filter((value) => value !== id);
    settings.hidden = settings.hidden.filter((value) => value !== id);
    delete settings.assignments[id];
    await saveSettings(settings);
    return scanDesktop();
  });
  ipcMain.handle('desktop:preview', async (_event, id) => {
    const item = findItem(id) || (await scanDesktop(), findItem(id));
    if (!item) throw new Error('项目不存在');
    if (!item.exists || !fs.existsSync(item.path)) return { kind: 'missing', source: '', childCount: null };
    if (item.type === 'image') {
      const image = await nativeImage.createThumbnailFromPath(item.path, { width: 720, height: 520 });
      return { kind: 'image', source: image.toDataURL(), childCount: null };
    }
    if (item.type === 'video') return { kind: 'video', source: pathToFileURL(item.path).href, childCount: null };
    if (item.extension === '.pdf') return { kind: 'pdf', source: pathToFileURL(item.path).href, childCount: null };
    if (item.type === 'folder') {
      let childCount = null;
      try { childCount = (await fsp.readdir(item.path)).length; } catch {}
      return { kind: 'folder', source: '', childCount };
    }
    return { kind: 'none', source: '', childCount: null };
  });
  ipcMain.handle('shortcut:find-candidates', async (_event, id) => {
    await scanDesktop();
    const item = findItem(id);
    if (!item || item.scope !== 'personal' || item.type !== 'shortcut') throw new Error('只允许修复个人桌面的快捷方式');
    if (item.targetExists) throw new Error('这个快捷方式当前有效，无需修复');
    const candidates = await searchShortcutCandidates(item);
    return candidates.map((candidate) => approveShortcutCandidate(item, candidate.path, candidate.score));
  });
  ipcMain.handle('shortcut:choose-candidate', async (event, id) => {
    await scanDesktop();
    const item = findItem(id);
    if (!item || item.scope !== 'personal' || item.type !== 'shortcut') throw new Error('只允许修复个人桌面的快捷方式');
    const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const result = await dialog.showOpenDialog(owner, { title: `为“${item.name}”选择新的程序`, properties: ['openFile'], filters: [{ name: 'Windows 程序', extensions: ['exe'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const candidate = await assertRealPath(result.filePaths[0]);
    return approveShortcutCandidate(item, candidate, 0);
  });
  ipcMain.handle('shortcut:repair', (_event, token) => enqueueFileOperation(() => repairShortcut(token)));
  ipcMain.handle('everything:status', getEverythingStatus);
  ipcMain.handle('everything:choose-directory', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const current = await getEverythingStatus();
    const result = await dialog.showOpenDialog(owner, { title: '选择 Everything 安装目录', defaultPath: current.effectivePath || undefined, properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const selected = await fsp.realpath(result.filePaths[0]);
    if (!fs.existsSync(path.join(selected, 'Everything.exe'))) throw new Error('所选目录中没有找到 Everything.exe');
    const settings = await getSettings();
    settings.everythingPath = selected;
    await saveSettings(settings);
    return getEverythingStatus();
  });
  ipcMain.handle('everything:install-connector', installEverythingConnector);
  ipcMain.handle('everything:start', async () => {
    return everythingService.start();
  });
  ipcMain.handle('everything:search', (_event, { query, limit }) => searchEverything(query, limit));
  ipcMain.handle('everything:open', async (_event, id) => {
    const resultPath = everythingService.resultPath(id);
    if (!resultPath || !fs.existsSync(resultPath)) throw new Error('搜索结果已失效，请重新搜索');
    const error = await shell.openPath(resultPath);
    if (error) throw new Error(error);
    return true;
  });
  ipcMain.handle('everything:reveal', async (_event, id) => {
    const resultPath = everythingService.resultPath(id);
    if (!resultPath || !fs.existsSync(resultPath)) throw new Error('搜索结果已失效，请重新搜索');
    shell.showItemInFolder(resultPath);
    return true;
  });
  ipcMain.handle('backup:export', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const result = await dialog.showSaveDialog(owner, { title: '导出桌面工作台配置', defaultPath: `桌面工作台配置-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON 配置文件', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return null;
    await writeJson(result.filePath, { kind: 'DesktopWorkspaceBackup', version: CURRENT_SETTINGS_VERSION, exportedAt: Date.now(), settings: await getSettings() });
    return result.filePath;
  });
  ipcMain.handle('backup:prepare-import', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const result = await dialog.showOpenDialog(owner, { title: '选择桌面工作台配置', properties: ['openFile'], filters: [{ name: 'JSON 配置文件', extensions: ['json'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    let parsed;
    try { parsed = JSON.parse(await fsp.readFile(result.filePaths[0], 'utf8')); } catch { throw new Error('配置文件不是有效的 JSON 文件'); }
    const imported = await validateImportedSettings(parsed);
    const token = crypto.randomUUID();
    const now = Date.now();
    for (const [key, value] of pendingImports) if (now - value.createdAt > 10 * 60 * 1000) pendingImports.delete(key);
    pendingImports.set(token, { settings: imported, createdAt: now });
    return { token, filePath: result.filePaths[0], categories: imported.categories.length, favorites: imported.favorites.length, assignments: Object.keys(imported.assignments).length, externalItems: imported.externalItems.length };
  });
  ipcMain.handle('backup:apply-import', async (_event, token) => {
    const pending = pendingImports.get(token);
    if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) throw new Error('导入确认已过期，请重新选择配置文件');
    pendingImports.delete(token);
    await createRotatingBackup(settingsPath(), path.join(app.getPath('userData'), 'backups'), 5);
    await applyImportedSettings(pending.settings);
    return scanDesktop();
  });
  ipcMain.handle('backup:list-auto', async () => {
    const directory = path.join(app.getPath('userData'), 'backups');
    try {
      const entries = await fsp.readdir(directory, { withFileTypes: true });
      return Promise.all(entries.filter((entry) => entry.isFile() && /^settings-.*\.json$/i.test(entry.name)).map(async (entry) => ({ name: entry.name, path: path.join(directory, entry.name), timestamp: (await fsp.stat(path.join(directory, entry.name))).mtimeMs })));
    } catch { return []; }
  });
  ipcMain.handle('backup:restore-auto', async (_event, name) => {
    if (typeof name !== 'string' || !/^settings-[a-z0-9T.-]+\.json$/i.test(name)) throw new Error('自动备份名称无效');
    const file = path.join(app.getPath('userData'), 'backups', name);
    const imported = await validateImportedSettings(JSON.parse(await fsp.readFile(file, 'utf8')));
    await createRotatingBackup(settingsPath(), path.join(app.getPath('userData'), 'backups'), 5);
    await applyImportedSettings(imported);
    return scanDesktop();
  });
  ipcMain.handle('backup:open-folder', async () => {
    const directory = path.join(app.getPath('userData'), 'backups');
    await fsp.mkdir(directory, { recursive: true });
    const error = await shell.openPath(directory);
    if (error) throw new Error(error);
    return true;
  });
  ipcMain.handle('snapshot:create', async (_event, label) => {
    const safeLabel = typeof label === 'string' ? label.trim().slice(0, 60) : '';
    const snapshot = await saveCurrentSnapshot(safeLabel || `桌面快照 ${new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(Date.now())}`);
    return { id: snapshot.id, label: snapshot.label, timestamp: snapshot.timestamp, automatic: snapshot.automatic, itemCount: snapshot.items.length };
  });
  ipcMain.handle('snapshot:list', async () => (await readJson(snapshotsPath(), [])).map((snapshot) => ({ id: snapshot.id, label: snapshot.label, timestamp: snapshot.timestamp, automatic: snapshot.automatic, itemCount: snapshot.items.length })));
  ipcMain.handle('snapshot:diff', async (_event, id) => {
    await scanDesktop();
    const snapshot = (await readJson(snapshotsPath(), [])).find((entry) => entry.id === id);
    if (!snapshot) throw new Error('桌面快照不存在');
    const diff = diffSnapshot(snapshot, lastItems);
    return { added: diff.added.map(({ id: itemId, name, path: itemPath }) => ({ id: itemId, name, path: itemPath })), removed: diff.removed.map(({ id: itemId, name, path: itemPath }) => ({ id: itemId, name, path: itemPath })), changed: diff.changed.map(({ id: itemId, name, path: itemPath, fields }) => ({ id: itemId, name, path: itemPath, fields })) };
  });
  ipcMain.handle('snapshot:restore', async (_event, id) => {
    await scanDesktop();
    const snapshot = (await readJson(snapshotsPath(), [])).find((entry) => entry.id === id);
    if (!snapshot) throw new Error('桌面快照不存在');
    const settings = await getSettings();
    const restored = applySnapshotVirtualState(snapshot, lastItems, settings);
    await saveSettings(settings);
    return { payload: await scanDesktop(), restored };
  });
  ipcMain.handle('snapshot:delete', async (_event, id) => {
    const snapshots = await readJson(snapshotsPath(), []);
    const next = snapshots.filter((entry) => entry.id !== id);
    if (next.length === snapshots.length) throw new Error('桌面快照不存在');
    await writeJson(snapshotsPath(), next);
    return true;
  });
  ipcMain.handle('settings:get', getSettings);
  ipcMain.handle('settings:update', async (_event, patch) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('设置数据无效');
    const allowed = ['theme', 'view', 'sortMode', 'activeView', 'categorySortModes', 'gridDensity', 'workspaceItemScale', 'hideEmptyCategories', 'detailsPaneOpen', 'sidebarCollapsed', 'closeToTray', 'launchAtStartup', 'launchAtStartupHidden', 'reduceMotion', 'hotkey', 'quickPanelPinned', 'quickPanelView', 'quickPanelItemScale', 'quickPanelAutoHide', 'quickPanelDockPosition', 'quickPanelHideDelay', 'quickPanelTriggerSize', 'quickPanelSnapDistance', 'quickPanelSlideDuration', 'everythingResultLimit'];
    const settings = await getSettings();
    if (patch.theme && !['system', 'light', 'dark'].includes(patch.theme)) throw new Error('界面主题无效');
    if (patch.view && !['grid', 'list'].includes(patch.view)) throw new Error('视图模式无效');
    if (patch.sortMode && !['custom', 'name', 'modified', 'used', 'type'].includes(patch.sortMode)) throw new Error('排序方式无效');
    if (patch.gridDensity && !['compact', 'comfortable', 'large'].includes(patch.gridDensity)) throw new Error('网格密度无效');
    if (patch.quickPanelView && !['list', 'grid'].includes(patch.quickPanelView)) throw new Error('快速面板排列方式无效');
    for (const key of ['workspaceItemScale', 'quickPanelItemScale']) {
      if (Object.prototype.hasOwnProperty.call(patch, key) && (!Number.isFinite(patch[key]) || patch[key] < 80 || patch[key] > 160)) throw new Error(`${key} 图标缩放设置无效`);
    }
    if (patch.quickPanelDockPosition && !['top', 'left', 'right'].includes(patch.quickPanelDockPosition)) throw new Error('快速面板停靠位置无效');
    if (Object.prototype.hasOwnProperty.call(patch, 'quickPanelHideDelay') && (!Number.isFinite(patch.quickPanelHideDelay) || patch.quickPanelHideDelay < 300 || patch.quickPanelHideDelay > 3000)) throw new Error('快速面板隐藏延时无效');
    if (Object.prototype.hasOwnProperty.call(patch, 'quickPanelTriggerSize') && (!Number.isFinite(patch.quickPanelTriggerSize) || patch.quickPanelTriggerSize < 3 || patch.quickPanelTriggerSize > 24)) throw new Error('快速面板触发区域无效');
    if (Object.prototype.hasOwnProperty.call(patch, 'quickPanelSnapDistance') && (!Number.isFinite(patch.quickPanelSnapDistance) || patch.quickPanelSnapDistance < 8 || patch.quickPanelSnapDistance > 80)) throw new Error('快速面板吸附距离无效');
    if (Object.prototype.hasOwnProperty.call(patch, 'quickPanelSlideDuration') && (!Number.isFinite(patch.quickPanelSlideDuration) || patch.quickPanelSlideDuration < 80 || patch.quickPanelSlideDuration > 500)) throw new Error('快速面板滑动速度无效');
    if (Object.prototype.hasOwnProperty.call(patch, 'activeView') && typeof patch.activeView !== 'string') throw new Error('当前视图无效');
    if (Object.prototype.hasOwnProperty.call(patch, 'categorySortModes') && (!patch.categorySortModes || typeof patch.categorySortModes !== 'object' || Array.isArray(patch.categorySortModes))) throw new Error('分类排序设置无效');
    if (Object.prototype.hasOwnProperty.call(patch, 'everythingResultLimit') && ![50, 100, 200].includes(patch.everythingResultLimit)) throw new Error('Everything 结果数量无效');
    for (const key of ['hideEmptyCategories', 'detailsPaneOpen', 'sidebarCollapsed', 'closeToTray', 'launchAtStartup', 'launchAtStartupHidden', 'reduceMotion', 'quickPanelPinned', 'quickPanelAutoHide']) {
      if (Object.prototype.hasOwnProperty.call(patch, key) && typeof patch[key] !== 'boolean') throw new Error(`${key} 设置必须是布尔值`);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'hotkey') && (typeof patch.hotkey !== 'string' || patch.hotkey.length > 40)) throw new Error('快速面板热键无效');
    for (const key of allowed) if (Object.prototype.hasOwnProperty.call(patch, key)) settings[key] = patch[key];
    if (Object.prototype.hasOwnProperty.call(patch, 'quickPanelDockPosition')) {
      settings.quickPanelDocked = true;
      settings.quickPanelDockDisplayId = '';
      const preferredBounds = dockWindow && !dockWindow.isDestroyed() ? dockWindow.getBounds() : settings.dockBounds;
      const target = resolveDockTarget(screen.getAllDisplays(), { position: settings.quickPanelDockPosition, preferredBounds });
      if (target) {
        settings.quickPanelDockDisplayId = target.displayId;
        settings.dockBounds = { x: target.bounds.x, y: target.bounds.y };
      }
    }
    if (patch.hotkey) settings.hotkey = await registerHotkey(String(patch.hotkey));
    if (Object.prototype.hasOwnProperty.call(patch, 'launchAtStartup')) {
      app.setLoginItemSettings({ openAtLogin: Boolean(patch.launchAtStartup), args: settings.launchAtStartupHidden ? ['--hidden'] : [] });
    } else if (Object.prototype.hasOwnProperty.call(patch, 'launchAtStartupHidden')) {
      app.setLoginItemSettings({ openAtLogin: Boolean(settings.launchAtStartup), args: settings.launchAtStartupHidden ? ['--hidden'] : [] });
    }
    const saved = await saveSettings(settings);
    sendSettingsChanged(saved);
    if (['quickPanelPinned', 'quickPanelAutoHide', 'quickPanelDockPosition', 'quickPanelHideDelay', 'quickPanelTriggerSize', 'quickPanelSnapDistance', 'quickPanelSlideDuration', 'reduceMotion'].some((key) => Object.prototype.hasOwnProperty.call(patch, key))) applyDockSettings({ reveal: Object.prototype.hasOwnProperty.call(patch, 'quickPanelDockPosition') });
    return saved;
  });
  ipcMain.handle('settings:update-categories', async (_event, categories) => {
    if (!Array.isArray(categories) || categories.length < 2 || categories.length > 20) throw new Error('分类数量必须在 2 到 20 之间');
    const settings = await getSettings();
    const previousById = new Map(settings.categories.map((category) => [category.id, category]));
    const sanitized = categories.map((entry) => {
      const id = String(entry.id || '');
      const label = String(entry.label || '').trim().slice(0, 20);
      const color = String(entry.color || '');
      if (!/^[a-z0-9-]{1,64}$/i.test(id) || !label || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('分类名称、标识或颜色无效');
      const previous = previousById.get(id);
      let archivePath = previous?.archivePath || null;
      if (entry.archivePath === null) archivePath = null;
      else if (typeof entry.archivePath === 'string' && entry.archivePath.trim()) {
        const requestedPath = path.resolve(entry.archivePath);
        if (previous?.archivePath && normalized(previous.archivePath) === normalized(requestedPath)) archivePath = previous.archivePath;
        else if (approvedArchivePaths.has(normalized(requestedPath))) {
          archivePath = requestedPath;
          approvedArchivePaths.delete(normalized(requestedPath));
        } else throw new Error('归档目录必须通过文件夹选择器设置');
      }
      return {
        id,
        label,
        color,
        system: id === 'inbox' || id === 'other',
        archiveFolder: previous?.archiveFolder || safeCategoryFolder(entry.archiveFolder || label),
        archivePath,
        rules: sanitizeRules(Array.isArray(entry.rules) ? entry.rules : (previous?.rules || [])),
        ruleMode: entry.ruleMode === 'any' ? 'any' : 'all',
        quickPanel: typeof entry.quickPanel === 'boolean' ? entry.quickPanel : (previous?.quickPanel ?? false),
        hiddenWhenEmpty: entry.hiddenWhenEmpty === true,
        launchItemIds: Array.isArray(entry.launchItemIds) ? [...new Set(entry.launchItemIds.filter((value) => typeof value === 'string'))] : (previous?.launchItemIds || []),
        launchUrls: Array.isArray(entry.launchUrls) ? [...new Set(entry.launchUrls.filter((value) => typeof value === 'string'))] : (previous?.launchUrls || []),
        launchSteps: sanitizeLaunchSteps(Array.isArray(entry.launchSteps) ? entry.launchSteps : (previous?.launchSteps || [])),
      };
    });
    if (new Set(sanitized.map((entry) => entry.id)).size !== sanitized.length) throw new Error('分类标识不能重复');
    if (!sanitized.some((entry) => entry.id === 'inbox') || !sanitized.some((entry) => entry.id === 'other')) throw new Error('待整理和其他分类不能删除');
    settings.categories = sanitized;
    const validIds = new Set(sanitized.map((entry) => entry.id));
    for (const [itemId, categoryId] of Object.entries(settings.assignments)) {
      if (!validIds.has(categoryId)) settings.assignments[itemId] = 'other';
    }
    await saveSettings(settings);
    return scanDesktop();
  });
  ipcMain.handle('category:choose-archive-directory', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const result = await dialog.showOpenDialog(owner, { title: '选择此分类的归档目录', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const selected = path.resolve(result.filePaths[0]);
    const stat = await fsp.lstat(selected);
    if (stat.isSymbolicLink()) throw new Error('不能把符号链接作为归档目录');
    const real = await fsp.realpath(selected);
    if (desktopRoots().some((root) => isWithin(real, root.path))) throw new Error('独立归档目录不能位于桌面内部');
    approvedArchivePaths.add(normalized(real));
    return real;
  });
  ipcMain.handle('category:preview-rules', async (_event, { rules, ruleMode }) => {
    const sanitized = sanitizeRules(rules);
    await scanDesktop();
    const matches = lastItems
      .filter((item) => matchesRules(item, sanitized, ruleMode === 'any' ? 'any' : 'all'))
      .map((item) => ({ id: item.id, name: item.name, currentCategoryId: item.categoryId, scope: item.scope, type: item.type }));
    return { matches: matches.slice(0, 100), total: matches.length };
  });
  ipcMain.handle('category:launch', (_event, categoryId) => launchCategory(categoryId));
  ipcMain.handle('window:toggle-dock', toggleDock);
  ipcMain.handle('window:open-main', () => { showMain(); hideDock(); });
  ipcMain.handle('dock:pointer-enter', handleDockPointerEnter);
  ipcMain.handle('dock:pointer-leave', handleDockPointerLeave);
  ipcMain.handle('window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.handle('window:maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (window.isMaximized()) window.unmaximize(); else window.maximize();
  });
  ipcMain.handle('window:close', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (window === mainWindow && !isQuitting) {
      if (settingsCache?.closeToTray !== false) window.hide();
      else {
        isQuitting = true;
        app.quit();
      }
      return;
    }
    window.close();
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showMain);
  app.whenReady().then(async () => {
    app.setName(APP_NAME);
    registerIpc();
    void pruneIconCache();
    const settings = await getSettings();
    const activeHotkey = await registerHotkey(settings.hotkey);
    if (activeHotkey !== settings.hotkey) {
      settings.hotkey = activeHotkey;
      await saveSettings(settings);
    }
    app.setLoginItemSettings({ openAtLogin: Boolean(settings.launchAtStartup), args: settings.launchAtStartupHidden ? ['--hidden'] : [] });
    await scanDesktop();
    startDesktopWatchers();
    await createTray();
    const handleDisplayTopologyChange = async () => {
      const currentSettings = await getSettings();
      if (!currentSettings.quickPanelDocked) return;
      const preferredBounds = dockWindow && !dockWindow.isDestroyed() ? dockWindow.getBounds() : currentSettings.dockBounds;
      const target = resolveDockTarget(screen.getAllDisplays(), { position: currentSettings.quickPanelDockPosition, displayId: currentSettings.quickPanelDockDisplayId, preferredBounds });
      if (!target) {
        currentSettings.quickPanelDocked = false;
        currentSettings.quickPanelDockDisplayId = '';
      } else {
        currentSettings.quickPanelDockDisplayId = target.displayId;
        currentSettings.dockBounds = { x: target.bounds.x, y: target.bounds.y };
      }
      await saveSettings(currentSettings);
      sendSettingsChanged(currentSettings);
      applyDockSettings({ reveal: true });
    };
    screen.on('display-added', () => { void handleDisplayTopologyChange(); });
    screen.on('display-removed', () => { void handleDisplayTopologyChange(); });
    screen.on('display-metrics-changed', () => { void handleDisplayTopologyChange(); });
    if (!(settings.launchAtStartupHidden && process.argv.includes('--hidden'))) showMain();
  });
}

app.on('activate', showMain);
app.on('before-quit', () => { isQuitting = true; });
app.on('will-quit', () => {
  clearDockTimers();
  stopDockAnimation();
  if (dockPreviewWindow && !dockPreviewWindow.isDestroyed()) dockPreviewWindow.destroy();
  globalShortcut.unregisterAll();
  scannerService.stopWatchers();
});
app.on('window-all-closed', () => {});
