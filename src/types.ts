export type ItemScope = 'personal' | 'public' | 'external';
export type ItemType = 'folder' | 'shortcut' | 'image' | 'video' | 'document' | 'file';

export interface Category {
  id: string;
  label: string;
  color: string;
  system?: boolean;
  archiveFolder: string;
  archivePath: string | null;
  rules: CategoryRule[];
  ruleMode: 'all' | 'any';
  quickPanel: boolean;
  hiddenWhenEmpty: boolean;
  launchItemIds: string[];
  launchUrls: string[];
  launchSteps: LaunchStep[];
}

export interface LaunchStep { id: string; type: 'item' | 'url' | 'delay'; value: string; label: string; enabled: boolean }

export interface CategoryRule {
  id: string;
  field: 'name' | 'extension' | 'target' | 'path' | 'scope' | 'type';
  operator: 'contains' | 'equals' | 'startsWith' | 'in';
  value: string;
  enabled: boolean;
}

export interface DesktopItem {
  id: string;
  name: string;
  fileName: string;
  path: string;
  scope: ItemScope;
  type: ItemType;
  extension: string;
  target: string;
  shortcutArgs: string;
  targetExists: boolean;
  modifiedAt: number;
  size: number | null;
  icon: string;
  exists: boolean;
  categoryId: string;
  isNew: boolean;
  suggestedCategoryId: string | null;
  suggestionReason: string | null;
  favorite: boolean;
  hidden: boolean;
  duplicateKey: string | null;
  duplicateKind: 'shortcut-target' | 'suspected-file' | 'exact-file' | null;
  useCount: number;
  lastOpenedAt: number | null;
}

export interface DesktopPayload {
  items: DesktopItem[];
  roots: Array<{ scope: ItemScope; path: string }>;
  categories: Category[];
  recoveryNotice?: string;
}

export interface AppSettings {
  version: number;
  theme: 'system' | 'light' | 'dark';
  view: 'grid' | 'list';
  sortMode: 'custom' | 'name' | 'modified' | 'used' | 'type';
  activeView: string;
  categorySortModes: Record<string, AppSettings['sortMode']>;
  gridDensity: 'compact' | 'comfortable' | 'large';
  workspaceItemScale: number;
  hideEmptyCategories: boolean;
  detailsPaneOpen: boolean;
  sidebarCollapsed: boolean;
  closeToTray: boolean;
  launchAtStartup: boolean;
  launchAtStartupHidden: boolean;
  reduceMotion: boolean;
  hotkey: string;
  quickPanelPinned: boolean;
  quickPanelView: 'list' | 'grid';
  quickPanelItemScale: number;
  quickPanelAutoHide: boolean;
  quickPanelDocked: boolean;
  quickPanelDockPosition: 'top' | 'left' | 'right';
  quickPanelDockDisplayId: string;
  quickPanelHideDelay: number;
  quickPanelTriggerSize: number;
  quickPanelSnapDistance: number;
  quickPanelSlideDuration: number;
  everythingPath: string;
  everythingResultLimit: 50 | 100 | 200;
  itemOrder: string[];
  categories: Category[];
}

export interface EverythingStatus {
  configuredPath: string;
  effectivePath: string;
  suggestedPath: string;
  everythingExists: boolean;
  connectorExists: boolean;
  connectorPath: string;
  version: string;
  everythingVersion: string;
  running: boolean;
  ready: boolean;
}

export interface EverythingResult {
  id: string;
  name: string;
  path: string;
  directory: string;
  extension: string;
  size: number | null;
  modifiedAt: number | null;
  isDirectory: boolean;
  icon: string;
}

export interface OrganizeOperation {
  id: string;
  name: string;
  source: string;
  target: string;
  renamed: boolean;
  reason?: string;
  crossDevice?: boolean;
  sourceRecovery?: 'recycle-bin' | 'retained';
  recoveryPath?: string;
}

export interface MoveRecoveryIssue {
  id: string;
  name: string;
  stage: string;
  source: string;
  target: string;
  updatedAt: number;
  sourceExists: boolean;
  targetExists: boolean;
  hiddenSourceExists: boolean;
  temporaryExists: boolean;
  error: string;
}

export interface OrganizePlan {
  categoryId: string;
  categoryLabel: string;
  destinationDir: string;
  operations: OrganizeOperation[];
  failures: OrganizeOperation[];
}

export interface OrganizeResult extends OrganizePlan {
  completed: OrganizeOperation[];
  failed: OrganizeOperation[];
}

export interface HistoryEntry {
  id: string;
  type?: 'organize' | 'shortcut-repair';
  status?: 'pending' | 'completed' | 'partial' | 'failed' | 'partially-undone' | 'undone';
  timestamp: number;
  categoryId: string;
  categoryLabel?: string;
  personalRoot?: string;
  destinationDir?: string;
  itemCount?: number;
  operations: OrganizeOperation[];
  pendingOperations?: OrganizeOperation[];
  failedOperations?: OrganizeOperation[];
  lastUndoFailures?: OrganizeOperation[];
  undone: boolean;
}

export interface DesktopApi {
  listDesktopItems(): Promise<DesktopPayload>;
  openItem(id: string): Promise<boolean>;
  revealItem(id: string): Promise<boolean>;
  reorderItems(orderedIds: string[], view: string): Promise<AppSettings>;
  assignCategory(id: string, categoryId: string): Promise<DesktopPayload>;
  assignCategories(ids: string[], categoryId: string): Promise<DesktopPayload>;
  toggleFavorite(id: string): Promise<DesktopPayload>;
  setFavorites(ids: string[], favorite: boolean): Promise<DesktopPayload>;
  setHidden(id: string, hidden: boolean): Promise<DesktopPayload>;
  setHiddenMany(ids: string[], hidden: boolean): Promise<DesktopPayload>;
  setInboxMany(ids: string[]): Promise<DesktopPayload>;
  revealItems(ids: string[]): Promise<number>;
  markInboxSeen(): Promise<DesktopPayload>;
  acceptSuggestions(ids: string[]): Promise<{ payload: DesktopPayload; accepted: number }>;
  scanExactDuplicates(ids?: string[]): Promise<{ payload: DesktopPayload; hashedCount: number; failures: Array<{ id: string; name: string; reason: string }>; cancelled: boolean }>;
  cancelExactDuplicateScan(): Promise<boolean>;
  onDuplicateScanProgress(callback: (progress: { current: number; total: number; name: string; done?: boolean; cancelled?: boolean }) => void): () => void;
  previewOrganize(ids: string[], categoryId: string): Promise<OrganizePlan>;
  executeOrganize(ids: string[], categoryId: string): Promise<OrganizeResult>;
  undoLastOperation(transactionId?: string): Promise<{ transactionId?: string; restored: OrganizeOperation[]; failed: OrganizeOperation[]; message?: string }>;
  listMoveRecoveryIssues(): Promise<MoveRecoveryIssue[]>;
  recoverMoveIssue(id: string): Promise<{ result: { id: string; restored: string[]; preserved: string[]; cleaned: string[] }; remaining: MoveRecoveryIssue[] }>;
  recoverAllMoveIssues(): Promise<{ completed: Array<{ id: string; restored: string[]; preserved: string[]; cleaned: string[] }>; failed: Array<{ id: string; name: string; reason: string }>; remaining: MoveRecoveryIssue[] }>;
  revealMoveRecoveryIssue(id: string): Promise<boolean>;
  getHistory(): Promise<HistoryEntry[]>;
  revealHistory(transactionId: string): Promise<boolean>;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  updateCategories(categories: Category[]): Promise<DesktopPayload>;
  chooseArchiveDirectory(): Promise<string | null>;
  previewCategoryRules(rules: CategoryRule[], ruleMode: Category['ruleMode']): Promise<{ matches: Array<{ id: string; name: string; currentCategoryId: string; scope: ItemScope; type: ItemType }>; total: number }>;
  launchCategory(categoryId: string): Promise<{ categoryId: string; categoryLabel: string; completed: Array<{ id: string; type: LaunchStep['type']; label: string; value: string }>; failed: Array<{ id: string; type: LaunchStep['type']; label: string; value: string; reason: string }> }>;
  addExternalItems(kind: 'file' | 'folder'): Promise<DesktopPayload>;
  removeExternalItem(id: string): Promise<DesktopPayload>;
  getItemPreview(id: string): Promise<{ kind: 'image' | 'video' | 'pdf' | 'folder' | 'missing' | 'none'; source: string; childCount: number | null }>;
  exportBackup(): Promise<string | null>;
  prepareImportBackup(): Promise<{ token: string; filePath: string; categories: number; favorites: number; assignments: number; externalItems: number } | null>;
  applyImportBackup(token: string): Promise<DesktopPayload>;
  listAutomaticBackups(): Promise<Array<{ name: string; path: string; timestamp: number }>>;
  restoreAutomaticBackup(name: string): Promise<DesktopPayload>;
  openBackupFolder(): Promise<boolean>;
  createSnapshot(label: string): Promise<SnapshotSummary>;
  listSnapshots(): Promise<SnapshotSummary[]>;
  diffSnapshot(id: string): Promise<SnapshotDiff>;
  restoreSnapshot(id: string): Promise<{ payload: DesktopPayload; restored: number }>;
  deleteSnapshot(id: string): Promise<boolean>;
  findShortcutCandidates(id: string): Promise<ShortcutCandidate[]>;
  chooseShortcutCandidate(id: string): Promise<ShortcutCandidate | null>;
  repairShortcut(token: string): Promise<{ payload: DesktopPayload; oldTarget: string; newTarget: string }>;
  getEverythingStatus(): Promise<EverythingStatus>;
  chooseEverythingDirectory(): Promise<EverythingStatus | null>;
  installEverythingConnector(): Promise<EverythingStatus>;
  startEverything(): Promise<EverythingStatus>;
  searchEverything(query: string, limit: 50 | 100 | 200): Promise<{ results: EverythingResult[]; elapsedMs: number }>;
  openEverythingResult(path: string): Promise<boolean>;
  revealEverythingResult(path: string): Promise<boolean>;
  toggleDock(): Promise<void>;
  openMain(): Promise<void>;
  dockPointerEnter(): Promise<void>;
  dockPointerLeave(): Promise<void>;
  minimize(): Promise<void>;
  maximize(): Promise<void>;
  close(): Promise<void>;
  onDesktopChanged(callback: (payload: DesktopPayload & { reason: string }) => void): () => void;
  onOpenSettings(callback: () => void): () => void;
  onSettingsChanged(callback: (settings: AppSettings) => void): () => void;
}

export interface SnapshotSummary { id: string; label: string; timestamp: number; automatic: boolean; itemCount: number }
export interface SnapshotDiffItem { id: string; name: string; path: string; fields?: string[] }
export interface SnapshotDiff { added: SnapshotDiffItem[]; removed: SnapshotDiffItem[]; changed: SnapshotDiffItem[] }
export interface ShortcutCandidate { token: string; path: string; name: string; score: number }
