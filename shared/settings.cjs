const { DEFAULT_CATEGORIES, safeCategoryFolder } = require('./classifier.cjs');
const { sanitizeRules } = require('./rules.cjs');
const { sanitizeLaunchSteps } = require('./scenes.cjs');

const CURRENT_SETTINGS_VERSION = 9;
const SORT_MODES = ['custom', 'name', 'modified', 'used', 'type'];

function categoryDefaults(category, index = 0) {
  const source = category && typeof category === 'object' ? category : {};
  let rules = [];
  try {
    rules = sanitizeRules(Array.isArray(source.rules) ? source.rules : []);
  } catch {}
  let launchSteps = [];
  try {
    const legacySteps = [
      ...(Array.isArray(source.launchItemIds) ? source.launchItemIds.map((value, stepIndex) => ({ id: `legacy-item-${stepIndex}`, type: 'item', value, enabled: true })) : []),
      ...(Array.isArray(source.launchUrls) ? source.launchUrls.map((value, stepIndex) => ({ id: `legacy-url-${stepIndex}`, type: 'url', value, enabled: true })) : []),
    ];
    launchSteps = sanitizeLaunchSteps(Array.isArray(source.launchSteps) ? source.launchSteps : legacySteps);
  } catch {}
  return {
    id: String(source.id || `category-${index}`),
    label: String(source.label || '未命名分类').trim().slice(0, 40) || '未命名分类',
    color: /^#[0-9a-f]{6}$/i.test(source.color) ? source.color : '#64748B',
    system: source.system === true,
    archiveFolder: safeCategoryFolder(source.archiveFolder || source.label || `分类-${index + 1}`),
    archivePath: typeof source.archivePath === 'string' && source.archivePath.trim() ? source.archivePath : null,
    rules,
    ruleMode: source.ruleMode === 'any' ? 'any' : 'all',
    quickPanel: typeof source.quickPanel === 'boolean' ? source.quickPanel : index < 6,
    hiddenWhenEmpty: source.hiddenWhenEmpty === true,
    launchItemIds: Array.isArray(source.launchItemIds) ? [...new Set(source.launchItemIds.filter((id) => typeof id === 'string'))] : [],
    launchUrls: Array.isArray(source.launchUrls) ? [...new Set(source.launchUrls.filter((url) => typeof url === 'string'))] : [],
    launchSteps,
  };
}

function createDefaultSettings() {
  return {
    version: CURRENT_SETTINGS_VERSION,
    theme: 'system',
    view: 'grid',
    sortMode: 'name',
    activeView: 'all',
    categorySortModes: {},
    gridDensity: 'comfortable',
    workspaceItemScale: 100,
    hideEmptyCategories: false,
    detailsPaneOpen: false,
    sidebarCollapsed: false,
    closeToTray: true,
    launchAtStartup: false,
    launchAtStartupHidden: true,
    reduceMotion: false,
    hotkey: 'Ctrl+Alt+D',
    quickPanelPinned: false,
    quickPanelView: 'list',
    quickPanelItemScale: 100,
    quickPanelAutoHide: true,
    quickPanelDocked: true,
    quickPanelDockPosition: 'right',
    quickPanelDockDisplayId: '',
    quickPanelHideDelay: 700,
    quickPanelTriggerSize: 8,
    quickPanelSnapDistance: 28,
    quickPanelSlideDuration: 180,
    everythingPath: '',
    everythingResultLimit: 100,
    categories: DEFAULT_CATEGORIES.map(categoryDefaults),
    assignments: {},
    favorites: [],
    hidden: [],
    knownItemIds: [],
    newItemIds: [],
    firstScanComplete: false,
    usage: {},
    fileHashes: {},
    externalItems: [],
    itemOrder: [],
    dockBounds: null,
    mainBounds: null,
  };
}

function normalizeRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function booleanOr(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function enumOr(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function stringRecord(value) {
  return Object.fromEntries(Object.entries(normalizeRecord(value)).filter(([key, entry]) => typeof key === 'string' && typeof entry === 'string'));
}

function sortModeRecord(value) {
  return Object.fromEntries(Object.entries(normalizeRecord(value)).filter(([key, entry]) => typeof key === 'string' && SORT_MODES.includes(entry)));
}

function boundsOrNull(value, includeSize = false) {
  const source = normalizeRecord(value);
  const keys = includeSize ? ['x', 'y', 'width', 'height'] : ['x', 'y'];
  return keys.every((key) => Number.isFinite(source[key])) ? Object.fromEntries(keys.map((key) => [key, source[key]])) : null;
}

function externalItemsOrEmpty(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const entry of value.slice(0, 200)) {
    const candidate = typeof entry === 'string' ? { path: entry, addedAt: 0 } : entry;
    if (!candidate || typeof candidate.path !== 'string' || !candidate.path.trim()) continue;
    const key = candidate.path.trim().toLocaleLowerCase('zh-CN');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ path: candidate.path.trim(), addedAt: Number.isFinite(candidate.addedAt) ? candidate.addedAt : 0 });
  }
  return result;
}

function validateCategoryStructure(categories) {
  if (!Array.isArray(categories) || categories.length === 0 || categories.length > 20) throw new Error('配置中的工作场景数量无效');
  const ids = categories.map((category) => String(category?.id || ''));
  if (ids.some((id) => !/^[a-z0-9-]{1,64}$/i.test(id)) || new Set(ids).size !== ids.length) throw new Error('配置中的工作场景标识无效或重复');
  if (!ids.includes('inbox') || !ids.includes('other')) throw new Error('配置必须包含“待整理”和“其他”基础分类');
  return true;
}

function normalizeSettings(value = {}) {
  const defaults = createDefaultSettings();
  const source = normalizeRecord(value);
  const categories = Array.isArray(source.categories) && source.categories.length
    ? source.categories.map(categoryDefaults)
    : defaults.categories;
  const validViews = new Set(['all', 'everything', 'favorites', 'recent', 'duplicates', 'duplicate-shortcuts', 'duplicate-files', 'duplicate-exact', 'broken', 'stale', 'hidden', ...categories.map((category) => category.id)]);
  return {
    ...defaults,
    version: CURRENT_SETTINGS_VERSION,
    theme: enumOr(source.theme, ['system', 'light', 'dark'], defaults.theme),
    view: enumOr(source.view, ['grid', 'list'], defaults.view),
    categories,
    assignments: stringRecord(source.assignments),
    usage: normalizeRecord(source.usage),
    fileHashes: normalizeRecord(source.fileHashes),
    categorySortModes: sortModeRecord(source.categorySortModes),
    favorites: Array.isArray(source.favorites) ? [...new Set(source.favorites.filter((id) => typeof id === 'string'))] : [],
    hidden: Array.isArray(source.hidden) ? [...new Set(source.hidden.filter((id) => typeof id === 'string'))] : [],
    knownItemIds: Array.isArray(source.knownItemIds) ? [...new Set(source.knownItemIds.filter((id) => typeof id === 'string'))] : [],
    newItemIds: Array.isArray(source.newItemIds) ? [...new Set(source.newItemIds.filter((id) => typeof id === 'string'))] : [],
    externalItems: externalItemsOrEmpty(source.externalItems),
    itemOrder: Array.isArray(source.itemOrder) ? [...new Set(source.itemOrder.filter((id) => typeof id === 'string'))].slice(0, 5000) : [],
    sortMode: SORT_MODES.includes(source.sortMode) ? source.sortMode : defaults.sortMode,
    activeView: validViews.has(source.activeView) ? source.activeView : 'all',
    gridDensity: ['compact', 'comfortable', 'large'].includes(source.gridDensity) ? source.gridDensity : defaults.gridDensity,
    workspaceItemScale: Number.isFinite(source.workspaceItemScale) ? Math.round(Math.min(160, Math.max(80, source.workspaceItemScale)) / 5) * 5 : defaults.workspaceItemScale,
    hideEmptyCategories: booleanOr(source.hideEmptyCategories, defaults.hideEmptyCategories),
    detailsPaneOpen: booleanOr(source.detailsPaneOpen, defaults.detailsPaneOpen),
    sidebarCollapsed: booleanOr(source.sidebarCollapsed, defaults.sidebarCollapsed),
    closeToTray: booleanOr(source.closeToTray, defaults.closeToTray),
    launchAtStartup: booleanOr(source.launchAtStartup, defaults.launchAtStartup),
    launchAtStartupHidden: booleanOr(source.launchAtStartupHidden, defaults.launchAtStartupHidden),
    reduceMotion: booleanOr(source.reduceMotion, defaults.reduceMotion),
    quickPanelPinned: booleanOr(source.quickPanelPinned, defaults.quickPanelPinned),
    quickPanelView: enumOr(source.quickPanelView, ['list', 'grid'], defaults.quickPanelView),
    quickPanelItemScale: Number.isFinite(source.quickPanelItemScale) ? Math.round(Math.min(160, Math.max(80, source.quickPanelItemScale)) / 5) * 5 : defaults.quickPanelItemScale,
    quickPanelAutoHide: booleanOr(source.quickPanelAutoHide, defaults.quickPanelAutoHide),
    quickPanelDocked: booleanOr(source.quickPanelDocked, defaults.quickPanelDocked),
    quickPanelDockPosition: enumOr(source.quickPanelDockPosition, ['top', 'left', 'right'], defaults.quickPanelDockPosition),
    quickPanelDockDisplayId: typeof source.quickPanelDockDisplayId === 'string' ? source.quickPanelDockDisplayId.slice(0, 64) : defaults.quickPanelDockDisplayId,
    quickPanelHideDelay: Number.isFinite(source.quickPanelHideDelay) ? Math.round(Math.min(3000, Math.max(300, source.quickPanelHideDelay))) : defaults.quickPanelHideDelay,
    quickPanelTriggerSize: Number.isFinite(source.quickPanelTriggerSize) ? Math.round(Math.min(24, Math.max(3, source.quickPanelTriggerSize))) : defaults.quickPanelTriggerSize,
    quickPanelSnapDistance: Number.isFinite(source.quickPanelSnapDistance) ? Math.round(Math.min(80, Math.max(8, source.quickPanelSnapDistance))) : defaults.quickPanelSnapDistance,
    quickPanelSlideDuration: Number.isFinite(source.quickPanelSlideDuration) ? Math.round(Math.min(500, Math.max(80, source.quickPanelSlideDuration))) : defaults.quickPanelSlideDuration,
    everythingPath: typeof source.everythingPath === 'string' ? source.everythingPath.trim().slice(0, 1024) : '',
    everythingResultLimit: [50, 100, 200].includes(source.everythingResultLimit) ? source.everythingResultLimit : defaults.everythingResultLimit,
    hotkey: typeof source.hotkey === 'string' && source.hotkey.trim().length <= 80 ? source.hotkey.trim() : defaults.hotkey,
    firstScanComplete: booleanOr(source.firstScanComplete, defaults.firstScanComplete),
    dockBounds: boundsOrNull(source.dockBounds),
    mainBounds: boundsOrNull(source.mainBounds, true),
  };
}

module.exports = { CURRENT_SETTINGS_VERSION, categoryDefaults, createDefaultSettings, normalizeSettings, validateCategoryStructure };
