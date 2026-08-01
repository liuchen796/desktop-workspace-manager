const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  listDesktopItems: () => ipcRenderer.invoke('desktop:list'),
  openItem: (id) => ipcRenderer.invoke('desktop:open', id),
  revealItem: (id) => ipcRenderer.invoke('desktop:reveal', id),
  reorderItems: (orderedIds, view) => ipcRenderer.invoke('desktop:reorder-items', { orderedIds, view }),
  assignCategory: (id, categoryId) => ipcRenderer.invoke('desktop:assign-category', { id, categoryId }),
  assignCategories: (ids, categoryId) => ipcRenderer.invoke('desktop:assign-category-many', { ids, categoryId }),
  toggleFavorite: (id) => ipcRenderer.invoke('desktop:toggle-favorite', id),
  setFavorites: (ids, favorite) => ipcRenderer.invoke('desktop:set-favorites', { ids, favorite }),
  setHidden: (id, hidden) => ipcRenderer.invoke('desktop:set-hidden', { id, hidden }),
  setHiddenMany: (ids, hidden) => ipcRenderer.invoke('desktop:set-hidden-many', { ids, hidden }),
  setInboxMany: (ids) => ipcRenderer.invoke('desktop:set-inbox-many', ids),
  revealItems: (ids) => ipcRenderer.invoke('desktop:reveal-many', ids),
  markInboxSeen: () => ipcRenderer.invoke('desktop:mark-inbox-seen'),
  acceptSuggestions: (ids) => ipcRenderer.invoke('desktop:accept-suggestions', ids),
  scanExactDuplicates: (ids) => ipcRenderer.invoke('desktop:scan-exact-duplicates', ids),
  cancelExactDuplicateScan: () => ipcRenderer.invoke('desktop:cancel-exact-duplicates'),
  onDuplicateScanProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('desktop:duplicate-progress', handler);
    return () => ipcRenderer.removeListener('desktop:duplicate-progress', handler);
  },
  previewOrganize: (ids, categoryId) => ipcRenderer.invoke('desktop:preview-organize', { ids, categoryId }),
  executeOrganize: (ids, categoryId) => ipcRenderer.invoke('desktop:execute-organize', { ids, categoryId }),
  undoLastOperation: (transactionId) => ipcRenderer.invoke('desktop:undo', transactionId),
  listMoveRecoveryIssues: () => ipcRenderer.invoke('recovery:list'),
  recoverMoveIssue: (id) => ipcRenderer.invoke('recovery:recover', id),
  recoverAllMoveIssues: () => ipcRenderer.invoke('recovery:recover-all'),
  revealMoveRecoveryIssue: (id) => ipcRenderer.invoke('recovery:reveal', id),
  getHistory: () => ipcRenderer.invoke('desktop:history'),
  revealHistory: (transactionId) => ipcRenderer.invoke('desktop:reveal-history', transactionId),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  updateCategories: (categories) => ipcRenderer.invoke('settings:update-categories', categories),
  chooseArchiveDirectory: () => ipcRenderer.invoke('category:choose-archive-directory'),
  previewCategoryRules: (rules, ruleMode) => ipcRenderer.invoke('category:preview-rules', { rules, ruleMode }),
  launchCategory: (categoryId) => ipcRenderer.invoke('category:launch', categoryId),
  addExternalItems: (kind) => ipcRenderer.invoke('external:add', kind),
  removeExternalItem: (id) => ipcRenderer.invoke('external:remove', id),
  getItemPreview: (id) => ipcRenderer.invoke('desktop:preview', id),
  exportBackup: () => ipcRenderer.invoke('backup:export'),
  prepareImportBackup: () => ipcRenderer.invoke('backup:prepare-import'),
  applyImportBackup: (token) => ipcRenderer.invoke('backup:apply-import', token),
  listAutomaticBackups: () => ipcRenderer.invoke('backup:list-auto'),
  restoreAutomaticBackup: (name) => ipcRenderer.invoke('backup:restore-auto', name),
  openBackupFolder: () => ipcRenderer.invoke('backup:open-folder'),
  createSnapshot: (label) => ipcRenderer.invoke('snapshot:create', label),
  listSnapshots: () => ipcRenderer.invoke('snapshot:list'),
  diffSnapshot: (id) => ipcRenderer.invoke('snapshot:diff', id),
  restoreSnapshot: (id) => ipcRenderer.invoke('snapshot:restore', id),
  deleteSnapshot: (id) => ipcRenderer.invoke('snapshot:delete', id),
  findShortcutCandidates: (id) => ipcRenderer.invoke('shortcut:find-candidates', id),
  chooseShortcutCandidate: (id) => ipcRenderer.invoke('shortcut:choose-candidate', id),
  repairShortcut: (token) => ipcRenderer.invoke('shortcut:repair', token),
  getEverythingStatus: () => ipcRenderer.invoke('everything:status'),
  chooseEverythingDirectory: () => ipcRenderer.invoke('everything:choose-directory'),
  installEverythingConnector: () => ipcRenderer.invoke('everything:install-connector'),
  startEverything: () => ipcRenderer.invoke('everything:start'),
  searchEverything: (query, limit) => ipcRenderer.invoke('everything:search', { query, limit }),
  openEverythingResult: (filePath) => ipcRenderer.invoke('everything:open', filePath),
  revealEverythingResult: (filePath) => ipcRenderer.invoke('everything:reveal', filePath),
  toggleDock: () => ipcRenderer.invoke('window:toggle-dock'),
  openMain: () => ipcRenderer.invoke('window:open-main'),
  dockPointerEnter: () => ipcRenderer.invoke('dock:pointer-enter'),
  dockPointerLeave: () => ipcRenderer.invoke('dock:pointer-leave'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  onDesktopChanged: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('desktop:changed', handler);
    return () => ipcRenderer.removeListener('desktop:changed', handler);
  },
  onOpenSettings: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('ui:open-settings', handler);
    return () => ipcRenderer.removeListener('ui:open-settings', handler);
  },
  onSettingsChanged: (callback) => {
    const handler = (_event, settings) => callback(settings);
    ipcRenderer.on('settings:changed', handler);
    return () => ipcRenderer.removeListener('settings:changed', handler);
  },
});
