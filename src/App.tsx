import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  AlertTriangle,
  AppWindow,
  Archive,
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  BriefcaseBusiness,
  Check,
  ChevronRight,
  Clock3,
  Code2,
  Columns3,
  Copy,
  Download,
  EyeOff,
  Eye,
  File,
  FileText,
  Fingerprint,
  Folder,
  FolderOpen,
  Gamepad2,
  Grid2X2,
  GripVertical,
  History,
  Image,
  Inbox,
  List,
  LoaderCircle,
  Maximize2,
  MessageSquareText,
  Minimize2,
  MonitorUp,
  MoreHorizontal,
  Network,
  Palette,
  PanelRightOpen,
  PanelRightClose,
  Pin,
  Plus,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import type {
  AppSettings,
  Category,
  CategoryRule,
  DesktopItem,
  DesktopPayload,
  HistoryEntry,
  EverythingResult,
  EverythingStatus,
  ItemType,
  MoveRecoveryIssue,
  OrganizePlan,
} from './types';
import { ItemContextMenu, type ContextItemAction } from './components/ItemContextMenu';
import { DetailsPane } from './components/DetailsPane';
import { DataSafetyDialog } from './components/DataSafetyDialog';
import { ShortcutRepairDialog } from './components/ShortcutRepairDialog';
import { Modal } from './components/Modal';
import { SettingsDialog } from './components/SettingsDialog';
import { CategoriesDialog } from './components/CategoriesDialog';
import { OrganizeDialog } from './components/OrganizeDialog';
import { HistoryDialog } from './components/HistoryDialog';
import { EverythingSearch } from './components/EverythingSearch';
import { MoveRecoveryDialog } from './components/MoveRecoveryDialog';
import { ItemZoomControl } from './components/ItemZoomControl';

type SpecialView = 'all' | 'everything' | 'favorites' | 'recent' | 'duplicates' | 'duplicate-shortcuts' | 'duplicate-files' | 'duplicate-exact' | 'broken' | 'stale' | 'hidden';
type ActiveView = SpecialView | string;
type SortMode = 'custom' | 'name' | 'modified' | 'used' | 'type';

const TYPE_LABELS: Record<ItemType, string> = {
  folder: '文件夹',
  shortcut: '快捷方式',
  document: '文档',
  image: '图片',
  video: '视频',
  file: '文件',
};

const SCOPE_LABELS: Record<DesktopItem['scope'], string> = { personal: '个人桌面', public: '公共桌面', external: '外部入口' };

const TYPE_ICONS = {
  folder: Folder,
  shortcut: AppWindow,
  document: FileText,
  image: Image,
  video: Video,
  file: File,
};

const NAV_ICONS: Record<string, typeof Folder> = {
  projects: BriefcaseBusiness,
  papers: FileText,
  'ai-dev': Code2,
  office: MessageSquareText,
  engineering: Columns3,
  network: Network,
  creative: Palette,
  entertainment: Gamepad2,
  inbox: Inbox,
  other: MoreHorizontal,
};

const formatDate = (timestamp: number | null) => {
  if (!timestamp) return '从未打开';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(timestamp);
};

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

function fuzzyIncludes(value: string, query: string) {
  let queryIndex = 0;
  for (const character of value) if (character === query[queryIndex]) queryIndex += 1;
  return queryIndex === query.length;
}

function smartSearchMatch(values: string[], rawQuery: string, phoneticValues: string[] = []) {
  const query = rawQuery.trim().toLocaleLowerCase('zh-CN').replace(/\s+/g, '');
  if (!query) return true;
  const text = values.join(' ').toLocaleLowerCase('zh-CN');
  return text.includes(query) || phoneticValues.some((value) => value.includes(query) || fuzzyIncludes(value, query));
}

function App() {
  const isDock = window.location.hash.includes('/dock');
  return isDock ? <DockApp /> : <WorkspaceApp />;
}

function useDesktop() {
  const [payload, setPayload] = useState<DesktopPayload>({ items: [], roots: [], categories: [] });
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextPayload, nextSettings] = await Promise.all([
        window.desktopAPI.listDesktopItems(),
        window.desktopAPI.getSettings(),
      ]);
      setPayload(nextPayload);
      setSettings(nextSettings);
      setError('');
    } catch (nextError) {
      setError(errorText(nextError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const unsubscribeDesktop = window.desktopAPI.onDesktopChanged((nextPayload) => setPayload(nextPayload));
    const unsubscribeSettings = window.desktopAPI.onSettingsChanged(setSettings);
    return () => { unsubscribeDesktop(); unsubscribeSettings(); };
  }, [refresh]);

  useEffect(() => {
    if (!settings) return;
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.reduceMotion = String(settings.reduceMotion);
  }, [settings]);

  return { payload, setPayload, settings, setSettings, loading, error, refresh };
}

function WorkspaceApp() {
  const desktop = useDesktop();
  const { payload, setPayload, settings, setSettings, loading, error, refresh } = desktop;
  const [activeView, setActiveView] = useState<ActiveView>('all');
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('name');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [toast, setToast] = useState('');
  const [contextMenu, setContextMenu] = useState<{ item: DesktopItem; x: number; y: number } | null>(null);
  const [draggedIds, setDraggedIds] = useState<string[]>([]);
  const [itemDropTarget, setItemDropTarget] = useState<{ id: string; placement: 'before' | 'after' } | null>(null);
  const [hashingDuplicates, setHashingDuplicates] = useState(false);
  const [duplicateProgress, setDuplicateProgress] = useState({ current: 0, total: 0, name: '' });
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [externalAddOpen, setExternalAddOpen] = useState(false);
  const [dataSafetyOpen, setDataSafetyOpen] = useState(false);
  const [repairItemId, setRepairItemId] = useState<string | null>(null);
  const [launchingCategoryId, setLaunchingCategoryId] = useState<string | null>(null);
  const [moveRecoveryIssues, setMoveRecoveryIssues] = useState<MoveRecoveryIssue[]>([]);
  const [moveRecoveryOpen, setMoveRecoveryOpen] = useState(false);
  const [moveRecoveryBusy, setMoveRecoveryBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const restoredWorkspaceState = useRef(false);
  const recoveryNoticeShown = useRef(false);

  useEffect(() => window.desktopAPI.onOpenSettings(() => setSettingsOpen(true)), []);
  useEffect(() => window.desktopAPI.onDuplicateScanProgress(setDuplicateProgress), []);
  useEffect(() => {
    let active = true;
    void window.desktopAPI.listMoveRecoveryIssues().then((issues) => {
      if (!active) return;
      setMoveRecoveryIssues(issues);
      if (issues.length) setMoveRecoveryOpen(true);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!settings || restoredWorkspaceState.current) return;
    restoredWorkspaceState.current = true;
    setActiveView(settings.activeView);
    setSortMode(settings.categorySortModes[settings.activeView] || settings.sortMode);
  }, [settings]);

  useEffect(() => {
    const specialViews = ['all', 'everything', 'favorites', 'recent', 'duplicates', 'duplicate-shortcuts', 'duplicate-files', 'duplicate-exact', 'broken', 'stale', 'hidden'];
    if (!specialViews.includes(activeView) && !payload.categories.some((category) => category.id === activeView)) setActiveView('all');
  }, [activeView, payload.categories]);

  useEffect(() => {
    if (focusedItemId && !payload.items.some((item) => item.id === focusedItemId)) setFocusedItemId(null);
  }, [focusedItemId, payload.items]);

  const now = Date.now();
  const itemOrderIndex = useMemo(() => new Map((settings?.itemOrder || []).map((id, index) => [id, index])), [settings?.itemOrder]);
  const duplicateIds = useMemo(() => new Set(payload.items.filter((item) => item.duplicateKey).map((item) => item.id)), [payload.items]);
  const counts = useMemo(() => ({
    total: payload.items.filter((item) => !item.hidden).length,
    favorites: payload.items.filter((item) => item.favorite && !item.hidden).length,
    recent: payload.items.filter((item) => item.lastOpenedAt && !item.hidden).length,
    duplicates: duplicateIds.size,
    duplicateShortcuts: payload.items.filter((item) => item.duplicateKind === 'shortcut-target' && !item.hidden).length,
    duplicateFiles: payload.items.filter((item) => item.duplicateKind === 'suspected-file' && !item.hidden).length,
    duplicateExact: payload.items.filter((item) => item.duplicateKind === 'exact-file' && !item.hidden).length,
    broken: payload.items.filter((item) => item.type === 'shortcut' && !item.targetExists).length,
    stale: payload.items.filter((item) => item.useCount === 0 && now - item.modifiedAt > 180 * 86400000).length,
    hidden: payload.items.filter((item) => item.hidden).length,
  }), [payload.items, duplicateIds, now]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('zh-CN');
    return payload.items
      .filter((item) => {
        if (activeView === 'everything') return false;
        if (activeView === 'hidden') return item.hidden;
        if (item.hidden) return false;
        if (activeView === 'favorites' && !item.favorite) return false;
        if (activeView === 'recent' && !item.lastOpenedAt) return false;
        if (activeView === 'duplicates' && !item.duplicateKey) return false;
        if (activeView === 'duplicate-shortcuts' && item.duplicateKind !== 'shortcut-target') return false;
        if (activeView === 'duplicate-files' && item.duplicateKind !== 'suspected-file') return false;
        if (activeView === 'duplicate-exact' && item.duplicateKind !== 'exact-file') return false;
        if (activeView === 'broken' && !(item.type === 'shortcut' && !item.targetExists)) return false;
        if (activeView === 'stale' && !(item.useCount === 0 && now - item.modifiedAt > 180 * 86400000)) return false;
        if (!['all', 'favorites', 'recent', 'duplicates', 'duplicate-shortcuts', 'duplicate-files', 'duplicate-exact', 'broken', 'stale'].includes(activeView) && item.categoryId !== activeView) return false;
        if (!query) return true;
        return smartSearchMatch([item.name, item.fileName, item.path, item.target, TYPE_LABELS[item.type]], query);
      })
      .sort((a, b) => {
        if (activeView === 'recent') return (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0);
        if (sortMode === 'custom') {
          return (itemOrderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (itemOrderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
        }
        if (sortMode === 'modified') return b.modifiedAt - a.modifiedAt;
        if (sortMode === 'used') return (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0) || b.useCount - a.useCount;
        if (sortMode === 'type') return TYPE_LABELS[a.type].localeCompare(TYPE_LABELS[b.type], 'zh-CN') || a.name.localeCompare(b.name, 'zh-CN');
        return a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
      });
  }, [payload.items, activeView, search, sortMode, now, itemOrderIndex]);

  useEffect(() => {
    if (focusedItemId && !filteredItems.some((item) => item.id === focusedItemId)) setFocusedItemId(null);
  }, [focusedItemId, filteredItems]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isEditing = target.matches('input, textarea, select, [contenteditable="true"]');
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (event.key === 'F5') {
        event.preventDefault();
        refresh();
        return;
      }
      if (isEditing || settingsOpen || categoriesOpen || organizeOpen || historyOpen || dataSafetyOpen || repairItemId) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setSelected(new Set(filteredItems.map((item) => item.id)));
      } else if (event.key === 'Escape') {
        setContextMenu(null);
        setSelected(new Set());
      } else if (event.key === 'Enter' && selected.size === 1 && !target.closest('.item-card, .item-row')) {
        const item = payload.items.find((entry) => selected.has(entry.id));
        if (item) window.desktopAPI.openItem(item.id);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [filteredItems, selected, payload.items, settingsOpen, categoriesOpen, organizeOpen, historyOpen, dataSafetyOpen, repairItemId, refresh]);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2600);
  };

  const recoverMoveIssue = async (id: string) => {
    setMoveRecoveryBusy(true);
    try {
      const response = await window.desktopAPI.recoverMoveIssue(id);
      setMoveRecoveryIssues(response.remaining);
      if (!response.remaining.length) setMoveRecoveryOpen(false);
      await refresh();
      showToast(`已恢复 ${response.result.restored.length} 个源项目，保留 ${response.result.preserved.length} 个完整副本`);
    } catch (nextError) {
      showToast(errorText(nextError));
    } finally {
      setMoveRecoveryBusy(false);
    }
  };

  const recoverAllMoveIssues = async () => {
    setMoveRecoveryBusy(true);
    try {
      const response = await window.desktopAPI.recoverAllMoveIssues();
      setMoveRecoveryIssues(response.remaining);
      if (!response.remaining.length) setMoveRecoveryOpen(false);
      await refresh();
      showToast(`已处理 ${response.completed.length} 个整理事务${response.failed.length ? `，${response.failed.length} 个需要人工检查` : ''}`);
    } catch (nextError) {
      showToast(errorText(nextError));
    } finally {
      setMoveRecoveryBusy(false);
    }
  };

  useEffect(() => {
    if (!payload.recoveryNotice || recoveryNoticeShown.current) return;
    recoveryNoticeShown.current = true;
    showToast(payload.recoveryNotice);
  }, [payload.recoveryNotice]);

  const changeActiveView = (view: ActiveView) => {
    setSelected(new Set());
    setFocusedItemId(null);
    setActiveView(view);
    if (!settings) return;
    setSortMode(settings.categorySortModes[view] || settings.sortMode);
    void window.desktopAPI.updateSettings({ activeView: view }).then(setSettings).catch((nextError) => showToast(errorText(nextError)));
  };

  const changeSortMode = (nextSort: SortMode) => {
    setSortMode(nextSort);
    if (!settings) return;
    const categorySortModes = { ...settings.categorySortModes, [activeView]: nextSort };
    void window.desktopAPI.updateSettings({ sortMode: nextSort, categorySortModes }).then(setSettings).catch((nextError) => showToast(errorText(nextError)));
  };

  const changeWorkspaceScale = (workspaceItemScale: number) => {
    setSettings({ ...settings!, workspaceItemScale });
    void window.desktopAPI.updateSettings({ workspaceItemScale }).then(setSettings).catch((nextError) => showToast(errorText(nextError)));
  };

  const updatePayload = (next: DesktopPayload) => {
    setPayload(next);
    setSelected(new Set());
  };

  const inspectItem = async (item: DesktopItem) => {
    setFocusedItemId(item.id);
    if (!settings?.detailsPaneOpen) {
      try { setSettings(await window.desktopAPI.updateSettings({ detailsPaneOpen: true })); } catch (nextError) { showToast(errorText(nextError)); }
    }
  };

  const closeDetails = async () => {
    setFocusedItemId(null);
    try { setSettings(await window.desktopAPI.updateSettings({ detailsPaneOpen: false })); } catch (nextError) { showToast(errorText(nextError)); }
  };

  const addExternalItems = async (kind: 'file' | 'folder') => {
    try {
      updatePayload(await window.desktopAPI.addExternalItems(kind));
      setExternalAddOpen(false);
      showToast(kind === 'folder' ? '常用文件夹已固定到工作台' : '常用文件已固定到工作台');
    } catch (nextError) {
      showToast(errorText(nextError));
    }
  };

  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const runItemAction = async (action: ContextItemAction, item: DesktopItem) => {
    try {
      if (action === 'open') await window.desktopAPI.openItem(item.id);
      if (action === 'reveal') await window.desktopAPI.revealItem(item.id);
      if (action === 'favorite') updatePayload(await window.desktopAPI.toggleFavorite(item.id));
      if (action === 'hide') updatePayload(await window.desktopAPI.setHidden(item.id, !item.hidden));
    } catch (nextError) {
      showToast(errorText(nextError));
    }
  };

  const assignSingle = async (item: DesktopItem, categoryId: string) => {
    try {
      updatePayload(await window.desktopAPI.assignCategory(item.id, categoryId));
      showToast(`已将“${item.name}”加入虚拟分类`);
    } catch (nextError) {
      showToast(errorText(nextError));
    }
  };

  const batchAssign = async (categoryId: string) => {
    const ids = [...selected];
    if (!ids.length) return;
    try {
      updatePayload(await window.desktopAPI.assignCategories(ids, categoryId));
      showToast(`已将 ${ids.length} 个项目加入虚拟分类`);
    } catch (nextError) {
      showToast(errorText(nextError));
    }
  };

  const beginItemDrag = (event: React.DragEvent<HTMLElement>, item: DesktopItem) => {
    if ((event.target as HTMLElement).closest('button, input, select')) {
      event.preventDefault();
      return;
    }
    const ids = selected.has(item.id) && selected.size > 1 ? [...selected] : [item.id];
    event.dataTransfer.effectAllowed = 'copyMove';
    event.dataTransfer.setData('application/x-desktop-workspace-items', JSON.stringify(ids));
    event.dataTransfer.setData('text/plain', ids.length === 1 ? item.name : `${ids.length} 个桌面项目`);
    setDraggedIds(ids);
    setContextMenu(null);
  };

  const reorderVisibleItems = async (targetId: string, placement: 'before' | 'after', droppedIds = draggedIds) => {
    const movingIds = droppedIds.filter((id) => filteredItems.some((item) => item.id === id));
    setItemDropTarget(null);
    setDraggedIds([]);
    if (!movingIds.length || movingIds.includes(targetId)) return;
    const remaining = filteredItems.map((item) => item.id).filter((id) => !movingIds.includes(id));
    const targetIndex = remaining.indexOf(targetId);
    if (targetIndex < 0) return;
    remaining.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, ...movingIds);
    try {
      const nextSettings = await window.desktopAPI.reorderItems(remaining, activeView);
      setSettings(nextSettings);
      setSortMode('custom');
      showToast(movingIds.length === 1 ? '图标位置已保存' : `${movingIds.length} 个图标的位置已保存`);
    } catch (nextError) {
      showToast(errorText(nextError));
    }
  };

  const dropIntoCategory = async (category: Category, droppedIds = draggedIds) => {
    const ids = droppedIds.filter((id) => payload.items.some((item) => item.id === id));
    setDraggedIds([]);
    if (!ids.length) return;
    try {
      updatePayload(await window.desktopAPI.assignCategories(ids, category.id));
      showToast(ids.length === 1 ? `已加入“${category.label}”` : `已将 ${ids.length} 个项目加入“${category.label}”`);
    } catch (nextError) {
      showToast(errorText(nextError));
    }
  };

  const dropIntoFavorites = async (droppedIds = draggedIds) => {
    const ids = droppedIds.filter((id) => payload.items.some((item) => item.id === id));
    setDraggedIds([]);
    if (!ids.length) return;
    try {
      updatePayload(await window.desktopAPI.setFavorites(ids, true));
      showToast(ids.length === 1 ? '已加入收藏项目' : `已收藏 ${ids.length} 个项目`);
    } catch (nextError) {
      showToast(errorText(nextError));
    }
  };

  const undo = async (transactionId?: string) => {
    try {
      const result = await window.desktopAPI.undoLastOperation(transactionId);
      await refresh();
      if (historyOpen) setHistory(await window.desktopAPI.getHistory());
      showToast(result.message || `已恢复 ${result.restored.length} 个项目${result.failed.length ? `，${result.failed.length} 个失败` : ''}`);
    } catch (nextError) {
      showToast(errorText(nextError));
    }
  };

  const openHistory = async () => {
    setHistory(await window.desktopAPI.getHistory());
    setHistoryOpen(true);
  };

  const scanDuplicates = async () => {
    setHashingDuplicates(true);
    try {
      const result = await window.desktopAPI.scanExactDuplicates();
      updatePayload(result.payload);
      showToast(`${result.cancelled ? '扫描已取消，' : ''}已校验 ${result.hashedCount} 个同大小文件${result.failures.length ? `，${result.failures.length} 个失败` : ''}`);
    } catch (nextError) {
      showToast(errorText(nextError));
    } finally {
      setHashingDuplicates(false);
    }
  };

  const acceptSuggestions = async (ids: string[]) => {
    try {
      const result = await window.desktopAPI.acceptSuggestions(ids);
      updatePayload(result.payload);
      showToast(`已接受 ${result.accepted} 条分类建议`);
    } catch (nextError) {
      showToast(errorText(nextError));
    }
  };

  const launchScene = async (category: Category) => {
    setLaunchingCategoryId(category.id);
    try {
      const result = await window.desktopAPI.launchCategory(category.id);
      showToast(`“${category.label}”已启动 ${result.completed.length} 步${result.failed.length ? `，${result.failed.length} 步失败` : ''}`);
    } catch (nextError) {
      showToast(errorText(nextError));
    } finally {
      setLaunchingCategoryId(null);
    }
  };

  const runBatchUpdate = async (operation: 'favorite' | 'hidden' | 'inbox' | 'reveal') => {
    const ids = [...selected];
    const selectedItems = payload.items.filter((item) => selected.has(item.id));
    if (!ids.length) return;
    try {
      if (operation === 'favorite') {
        const favorite = !selectedItems.every((item) => item.favorite);
        updatePayload(await window.desktopAPI.setFavorites(ids, favorite));
        showToast(favorite ? `已收藏 ${ids.length} 个项目` : `已取消收藏 ${ids.length} 个项目`);
      }
      if (operation === 'hidden') {
        const hidden = !selectedItems.every((item) => item.hidden);
        updatePayload(await window.desktopAPI.setHiddenMany(ids, hidden));
        showToast(hidden ? `已隐藏 ${ids.length} 个项目` : `已恢复显示 ${ids.length} 个项目`);
      }
      if (operation === 'inbox') {
        updatePayload(await window.desktopAPI.setInboxMany(ids));
        showToast(`已将 ${ids.length} 个项目送回待整理`);
      }
      if (operation === 'reveal') {
        const count = await window.desktopAPI.revealItems(ids);
        showToast(`已定位 ${count} 个项目`);
      }
    } catch (nextError) {
      showToast(errorText(nextError));
    }
  };

  const visibleIds = filteredItems.map((item) => item.id);
  const selectedItems = payload.items.filter((item) => selected.has(item.id));
  const focusedItem = focusedItemId ? payload.items.find((item) => item.id === focusedItemId) : null;
  const repairItem = repairItemId ? payload.items.find((item) => item.id === repairItemId) : null;
  const activeCategory = payload.categories.find((category) => category.id === activeView);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const toggleVisibleSelection = (checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of visibleIds) {
        if (checked) next.add(id); else next.delete(id);
      }
      return next;
    });
  };

  const title = activeView === 'all'
    ? '全部桌面内容'
    : payload.categories.find((category) => category.id === activeView)?.label
      || ({ favorites: '收藏项目', recent: '工作台最近打开', duplicates: '重复项目', 'duplicate-shortcuts': '重复快捷方式', 'duplicate-files': '疑似重复文件', 'duplicate-exact': '精确重复文件', broken: '失效快捷方式', stale: '工作台内未使用', hidden: '已隐藏项目' } as Record<string, string>)[activeView];

  const knownCategoryIds = new Set(payload.categories.map((category) => category.id));
  const allContentGroups = activeView === 'all'
    ? [
        ...payload.categories.map((category) => ({ category, items: filteredItems.filter((item) => item.categoryId === category.id) })),
        { category: undefined, items: filteredItems.filter((item) => !knownCategoryIds.has(item.categoryId)) },
      ].filter((group) => group.items.length > 0)
    : [];

  const renderWorkspaceItem = (item: DesktopItem) => settings?.view !== 'list'
    ? <ItemCard key={item.id} item={item} category={payload.categories.find((category) => category.id === item.categoryId)} selected={selected.has(item.id)} dragging={draggedIds.includes(item.id)} dropPlacement={itemDropTarget?.id === item.id ? itemDropTarget.placement : null} onInspect={() => inspectItem(item)} onSelect={() => toggleSelected(item.id)} onAction={(action) => runItemAction(action, item)} onDragStart={(event) => beginItemDrag(event, item)} onDragEnd={() => { setDraggedIds([]); setItemDropTarget(null); }} onReorderOver={(placement) => { if (!draggedIds.includes(item.id)) setItemDropTarget({ id: item.id, placement }); }} onReorderDrop={(placement, ids) => reorderVisibleItems(item.id, placement, ids)} onContextMenu={(event) => { event.preventDefault(); setContextMenu({ item, x: event.clientX, y: event.clientY }); }} />
    : <ItemRow key={item.id} item={item} category={payload.categories.find((category) => category.id === item.categoryId)} selected={selected.has(item.id)} dragging={draggedIds.includes(item.id)} onInspect={() => inspectItem(item)} onSelect={() => toggleSelected(item.id)} onAction={(action) => runItemAction(action, item)} onDragStart={(event) => beginItemDrag(event, item)} onDragEnd={() => setDraggedIds([])} onContextMenu={(event) => { event.preventDefault(); setContextMenu({ item, x: event.clientX, y: event.clientY }); }} />;

  if (!settings) return <LoadingScreen error={error} />;

  return (
    <div className="app-shell" style={{ '--item-scale': settings.workspaceItemScale / 100 } as CSSProperties} onWheel={(event) => { if (!event.ctrlKey) return; event.preventDefault(); changeWorkspaceScale(settings.workspaceItemScale + (event.deltaY < 0 ? 5 : -5)); }}>
      <a className="skip-link" href="#main-content">跳到桌面内容</a>
      <TitleBar onSettings={() => setSettingsOpen(true)} />
      <div className="workspace">
        <aside className={`sidebar ${draggedIds.length ? 'drag-active' : ''}`}>
          <div className="brand-block">
            <div className="brand-mark"><Grid2X2 size={19} /></div>
            <div><strong>桌面工作台</strong><span>{counts.total} 个可见项目</span></div>
          </div>
          <nav className="nav-scroll" aria-label="桌面分类">
            <NavItem icon={Grid2X2} label="全部内容" count={counts.total} active={activeView === 'all'} onClick={() => changeActiveView('all')} />
            <NavItem icon={Star} label="收藏项目" count={counts.favorites} active={activeView === 'favorites'} onClick={() => changeActiveView('favorites')} dropActive={draggedIds.length > 0} dropTitle="拖到这里收藏" onDropItems={(ids) => dropIntoFavorites(ids)} />
            <NavItem icon={Clock3} label="工作台最近打开" count={counts.recent} active={activeView === 'recent'} onClick={() => changeActiveView('recent')} />
            <NavItem icon={Search} label="Everything 搜索" count={0} active={activeView === 'everything'} onClick={() => changeActiveView('everything')} />
            <div className="nav-label nav-label-action"><span>工作场景</span><button title="管理工作场景" aria-label="管理工作场景" onClick={() => setCategoriesOpen(true)}><Settings size={15} /></button></div>
            {payload.categories.map((category) => {
              const Icon = NAV_ICONS[category.id] || Folder;
              const count = payload.items.filter((item) => !item.hidden && item.categoryId === category.id).length;
              if (count === 0 && (settings.hideEmptyCategories || category.hiddenWhenEmpty)) return null;
              return <NavItem key={category.id} icon={Icon} label={category.label} count={count} color={category.color} active={activeView === category.id} onClick={() => changeActiveView(category.id)} dropActive={draggedIds.length > 0} dropTitle={`拖到这里加入${category.label}`} onDropItems={(ids) => dropIntoCategory(category, ids)} />;
            })}
            <div className="nav-label">桌面健康</div>
            <NavItem icon={Copy} label="重复快捷方式" count={counts.duplicateShortcuts} active={activeView === 'duplicate-shortcuts'} onClick={() => changeActiveView('duplicate-shortcuts')} />
            <NavItem icon={FileText} label="疑似重复文件" count={counts.duplicateFiles} active={activeView === 'duplicate-files'} onClick={() => changeActiveView('duplicate-files')} />
            <NavItem icon={Fingerprint} label="精确重复文件" count={counts.duplicateExact} active={activeView === 'duplicate-exact'} onClick={() => changeActiveView('duplicate-exact')} />
            <NavItem icon={AlertTriangle} label="失效快捷方式" count={counts.broken} active={activeView === 'broken'} onClick={() => changeActiveView('broken')} />
            <NavItem icon={Clock3} label="工作台内未使用" count={counts.stale} active={activeView === 'stale'} onClick={() => changeActiveView('stale')} />
            <NavItem icon={EyeOff} label="已隐藏" count={counts.hidden} active={activeView === 'hidden'} onClick={() => changeActiveView('hidden')} />
          </nav>
          <div className="sidebar-actions">
            {moveRecoveryIssues.length > 0 && <button className="sidebar-button recovery-alert" onClick={() => setMoveRecoveryOpen(true)}><AlertTriangle size={17} />整理恢复中心<b>{moveRecoveryIssues.length}</b></button>}
            <button className="sidebar-button" onClick={() => setDataSafetyOpen(true)}><ShieldCheck size={17} />数据安全中心</button>
            <button className="sidebar-button" onClick={openHistory}><History size={17} />整理记录</button>
          </div>
        </aside>

        <main className="content" id="main-content" tabIndex={-1}>
          {activeView === 'everything' ? <EverythingSearch settings={settings} setSettings={setSettings} searchRef={searchRef} showToast={showToast} /> : <>
          <header className="content-header">
            <div className="heading-group"><h1>{title}</h1><p>个人桌面与公共桌面已合并显示</p></div>
            <div className="header-actions">
              {activeCategory?.launchSteps.some((step) => step.enabled) && <button className="primary-button" disabled={launchingCategoryId === activeCategory.id} onClick={() => launchScene(activeCategory)}><Play size={17} />{launchingCategoryId === activeCategory.id ? '正在启动' : '启动工作场景'}</button>}
              {['duplicates', 'duplicate-files', 'duplicate-exact'].includes(activeView) && (hashingDuplicates ? <button className="secondary-button" title={duplicateProgress.name || '正在校验文件'} onClick={() => window.desktopAPI.cancelExactDuplicateScan()}><X size={17} />取消扫描 {duplicateProgress.total ? `${duplicateProgress.current}/${duplicateProgress.total}` : ''}</button> : <button className="secondary-button" onClick={scanDuplicates}><Fingerprint size={17} />精确扫描</button>)}
              <button className="icon-button" title="撤销上次整理" onClick={() => undo()}><RotateCcw size={18} /></button>
              <button className="icon-button" title="刷新桌面" onClick={refresh}><RefreshCw size={18} className={loading ? 'spin' : ''} /></button>
              <button className="secondary-button" onClick={() => setExternalAddOpen(true)}><Plus size={17} />固定外部入口</button>
              <button className="icon-button" title={settings.detailsPaneOpen ? '关闭详情面板' : '打开详情面板'} onClick={async () => { const open = !settings.detailsPaneOpen; setSettings(await window.desktopAPI.updateSettings({ detailsPaneOpen: open })); if (!open) setFocusedItemId(null); }}>{settings.detailsPaneOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}</button>
              <button className="secondary-button" onClick={() => window.desktopAPI.toggleDock()}><PanelRightOpen size={17} />快速面板</button>
            </div>
          </header>

          <section className="control-bar">
            <label className="search-box"><Search size={18} /><input ref={searchRef} aria-label="搜索桌面项目" value={search} onChange={(event) => { setSearch(event.target.value); setSelected(new Set()); }} placeholder="搜索名称、类型或目标路径" /><span>{filteredItems.length}</span></label>
            <label className="select-visible"><input type="checkbox" disabled={!visibleIds.length} checked={allVisibleSelected} onChange={(event) => toggleVisibleSelection(event.target.checked)} /><span>全选当前</span></label>
            <select className="select-control" value={sortMode} onChange={(event) => changeSortMode(event.target.value as SortMode)} aria-label="排序方式">
              <option value="custom">自定义顺序</option><option value="name">按名称</option><option value="modified">按修改时间</option><option value="used">按最近使用</option><option value="type">按类型</option>
            </select>
            <ItemZoomControl value={settings.workspaceItemScale} label="桌面工作台图标" onChange={changeWorkspaceScale} />
            <div className="segmented" aria-label="视图模式">
              <button className={settings.view === 'grid' ? 'active' : ''} title="网格视图" onClick={async () => setSettings(await window.desktopAPI.updateSettings({ view: 'grid' }))}><Grid2X2 size={17} /></button>
              <button className={settings.view === 'list' ? 'active' : ''} title="列表视图" onClick={async () => setSettings(await window.desktopAPI.updateSettings({ view: 'list' }))}><List size={18} /></button>
            </div>
          </section>

          {activeView === 'inbox' && filteredItems.length > 0 && (
            <div className="inbox-banner"><Inbox size={19} /><span>{filteredItems.filter((item) => item.suggestedCategoryId).length ? `${filteredItems.filter((item) => item.suggestedCategoryId).length} 个项目已有分类建议` : '新出现的桌面项目会保留在这里，直到你完成分类。'}</span>{filteredItems.some((item) => item.suggestedCategoryId) && <button onClick={() => acceptSuggestions(filteredItems.filter((item) => item.suggestedCategoryId).map((item) => item.id))}>接受全部建议</button>}<button onClick={async () => updatePayload(await window.desktopAPI.markInboxSeen())}>全部标为已查看</button></div>
          )}

          {error && <div className="error-banner" role="alert"><AlertTriangle size={18} />{error}</div>}

          <div className="content-body">
          <section className={`items ${settings.view} density-${settings.gridDensity} ${activeView === 'all' ? 'grouped' : ''}`} aria-busy={loading}>
            {activeView === 'all'
              ? allContentGroups.map(({ category, items }) => {
                  const Icon = category ? NAV_ICONS[category.id] || Folder : Folder;
                  const groupId = category?.id || 'unassigned';
                  const headingId = `workspace-category-${groupId}`;
                  return <section className="workspace-category-group" data-category-id={groupId} aria-labelledby={headingId} key={groupId}>
                    <header className="workspace-category-header">
                      {category
                        ? <button className="workspace-category-title" title={`只查看${category.label}`} onClick={() => changeActiveView(category.id)}><span style={{ color: category.color }}><Icon size={17} /></span><strong id={headingId}>{category.label}</strong><b>{items.length}</b><ChevronRight size={15} /></button>
                        : <div className="workspace-category-title"><span><Folder size={17} /></span><strong id={headingId}>未分类</strong><b>{items.length}</b></div>}
                      <span className="workspace-category-line" />
                    </header>
                    <div className={`workspace-category-items ${settings.view}`}>{items.map(renderWorkspaceItem)}</div>
                  </section>;
                })
              : filteredItems.map(renderWorkspaceItem)}
            {!loading && filteredItems.length === 0 && <EmptyState query={search} />}
          </section>
          {settings.detailsPaneOpen && focusedItem && <DetailsPane item={focusedItem} category={payload.categories.find((category) => category.id === focusedItem.categoryId)} categories={payload.categories} onClose={closeDetails} onOpen={() => runItemAction('open', focusedItem)} onReveal={() => runItemAction('reveal', focusedItem)} onFavorite={() => runItemAction('favorite', focusedItem)} onHide={() => runItemAction('hide', focusedItem)} onAssign={(categoryId) => assignSingle(focusedItem, categoryId)} onRepairShortcut={() => setRepairItemId(focusedItem.id)} onRemoveExternal={async () => { if (!window.confirm(`只从工作台移除“${focusedItem.name}”入口，不会删除原文件。是否继续？`)) return; try { updatePayload(await window.desktopAPI.removeExternalItem(focusedItem.id)); setFocusedItemId(null); showToast('外部入口已移除，原文件未改变'); } catch (nextError) { showToast(errorText(nextError)); } }} />}
          {settings.detailsPaneOpen && !focusedItem && <aside className="details-pane details-empty"><PanelRightOpen size={30} /><strong>选择一个项目查看详情</strong><span>点击项目上的详情图标即可预览</span></aside>}
          </div>

          {selected.size > 0 && (
            <div className="selection-bar">
              <strong>已选择 {selected.size} 项</strong>
              {activeView === 'inbox' && [...selected].some((id) => payload.items.find((item) => item.id === id)?.suggestedCategoryId) && <button className="secondary-button" onClick={() => acceptSuggestions([...selected])}><Check size={17} />接受建议</button>}
              <button className="icon-button" title={selectedItems.every((item) => item.favorite) ? '取消收藏所选项目' : '收藏所选项目'} onClick={() => runBatchUpdate('favorite')}><Star size={17} fill={selectedItems.every((item) => item.favorite) ? 'currentColor' : 'none'} /></button>
              <button className="icon-button" title={selectedItems.every((item) => item.hidden) ? '恢复显示所选项目' : '隐藏所选项目'} onClick={() => runBatchUpdate('hidden')}>{selectedItems.every((item) => item.hidden) ? <Eye size={17} /> : <EyeOff size={17} />}</button>
              <button className="icon-button" title="送回待整理" onClick={() => runBatchUpdate('inbox')}><Inbox size={17} /></button>
              <button className="icon-button" title="在资源管理器中定位（最多 10 项）" disabled={selected.size > 10} onClick={() => runBatchUpdate('reveal')}><FolderOpen size={17} /></button>
              {selectedItems.some((item) => item.scope === 'public') && <button className="secondary-button" onClick={() => setSelected(new Set(selectedItems.filter((item) => item.scope === 'personal').map((item) => item.id)))}>仅保留个人桌面</button>}
              <select defaultValue="" onChange={(event) => { if (event.target.value) batchAssign(event.target.value); }}>
                <option value="" disabled>加入虚拟分类</option>
                {payload.categories.filter((category) => category.id !== 'inbox').map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
              </select>
              <button className="primary-button" onClick={() => setOrganizeOpen(true)}><Archive size={17} />整理到桌面归档</button>
              <button className="icon-button" title="取消选择" onClick={() => setSelected(new Set())}><X size={18} /></button>
            </div>
          )}
          </>}
        </main>
      </div>

      {contextMenu && <ItemContextMenu item={contextMenu.item} categories={payload.categories} x={contextMenu.x} y={contextMenu.y} onAction={(action) => runItemAction(action, contextMenu.item)} onAssign={(categoryId) => assignSingle(contextMenu.item, categoryId)} onClose={() => setContextMenu(null)} />}
      {settingsOpen && <SettingsDialog settings={settings} onClose={() => setSettingsOpen(false)} onSave={async (patch) => { setSettings(await window.desktopAPI.updateSettings(patch)); showToast('设置已保存'); }} />}
      {categoriesOpen && <CategoriesDialog categories={payload.categories} items={payload.items} onChooseArchive={() => window.desktopAPI.chooseArchiveDirectory()} onPreviewRules={(rules, mode) => window.desktopAPI.previewCategoryRules(rules, mode)} onClose={() => setCategoriesOpen(false)} onSave={async (categories) => { updatePayload(await window.desktopAPI.updateCategories(categories)); setCategoriesOpen(false); showToast('分类已更新'); }} />}
      {organizeOpen && <OrganizeDialog ids={[...selected]} categories={payload.categories} onClose={() => setOrganizeOpen(false)} onComplete={async (message) => { setOrganizeOpen(false); setSelected(new Set()); await refresh(); showToast(message); }} />}
      {historyOpen && <HistoryDialog history={history} categories={payload.categories} onUndo={undo} onReveal={async (id) => { try { await window.desktopAPI.revealHistory(id); } catch (nextError) { showToast(errorText(nextError)); } }} onClose={() => setHistoryOpen(false)} />}
      {externalAddOpen && <Modal title="固定桌面外的常用入口" onClose={() => setExternalAddOpen(false)}><div className="external-add-options"><button onClick={() => addExternalItems('folder')}><Folder size={25} /><span><strong>添加文件夹</strong><small>固定 D 盘、F 盘或其他位置的常用目录</small></span><ChevronRight size={17} /></button><button onClick={() => addExternalItems('file')}><File size={25} /><span><strong>添加文件</strong><small>固定常用文档、程序或快捷方式</small></span><ChevronRight size={17} /></button></div><footer className="modal-footer"><button className="secondary-button" onClick={() => setExternalAddOpen(false)}>取消</button></footer></Modal>}
      {dataSafetyOpen && <DataSafetyDialog onClose={() => setDataSafetyOpen(false)} onPayload={updatePayload} onMessage={showToast} />}
      {repairItem && <ShortcutRepairDialog item={repairItem} onClose={() => setRepairItemId(null)} onPayload={updatePayload} onMessage={showToast} />}
      {moveRecoveryOpen && moveRecoveryIssues.length > 0 && <MoveRecoveryDialog issues={moveRecoveryIssues} busy={moveRecoveryBusy} onRecover={recoverMoveIssue} onRecoverAll={recoverAllMoveIssues} onReveal={async (id) => { try { await window.desktopAPI.revealMoveRecoveryIssue(id); } catch (nextError) { showToast(errorText(nextError)); } }} onClose={() => setMoveRecoveryOpen(false)} />}
      {toast && <div className="toast" role="status" aria-live="polite"><Check size={17} />{toast}</div>}
    </div>
  );
}

function DockEverythingPage({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<EverythingStatus | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EverythingResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [loading, setLoading] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const loadStatus = useCallback(async () => {
    try {
      const next = await window.desktopAPI.getEverythingStatus();
      setStatus(next);
      setError('');
      return next;
    } catch (nextError) {
      setError(errorText(nextError));
      return null;
    }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => { if (status?.ready && status.running) inputRef.current?.focus(); }, [status?.ready, status?.running]);

  const searchEverything = useCallback(async (value: string) => {
    const keyword = value.trim();
    if (!keyword || !status?.ready || !status.running) {
      setResults([]);
      setElapsedMs(0);
      return;
    }
    setLoading(true);
    try {
      const response = await window.desktopAPI.searchEverything(keyword, 50);
      setResults(response.results);
      setElapsedMs(response.elapsedMs);
      setSelectedIndex(0);
      setError('');
    } catch (nextError) {
      setResults([]);
      setError(errorText(nextError));
    } finally {
      setLoading(false);
    }
  }, [status?.ready, status?.running]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void searchEverything(query); }, 260);
    return () => window.clearTimeout(timer);
  }, [query, searchEverything]);

  const runSetup = async (task: () => Promise<EverythingStatus | null>) => {
    setSetupLoading(true);
    try {
      const next = await task();
      if (next) {
        setStatus(next);
        setError('');
      }
    } catch (nextError) {
      setError(errorText(nextError));
    } finally {
      setSetupLoading(false);
    }
  };

  const openResult = async (result: EverythingResult) => {
    try { await window.desktopAPI.openEverythingResult(result.id); } catch (nextError) { setError(errorText(nextError)); }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onBack();
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest('button') || (event.key === 'Enter' && target instanceof HTMLInputElement)) return;
    if (!results.length || !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'ArrowDown') setSelectedIndex((value) => Math.min(results.length - 1, value + 1));
    if (event.key === 'ArrowUp') setSelectedIndex((value) => Math.max(0, value - 1));
    if (event.key === 'Enter') void openResult(results[selectedIndex]);
  };

  return <section className="dock-everything-page" onKeyDown={handleKeyDown}>
    <header className="dock-everything-header"><button className="icon-button" title="返回快速工作台" aria-label="返回快速工作台" onClick={onBack}><ArrowLeft size={18} /></button><span><strong>Everything 搜索</strong><small>{status?.running ? '已连接本机索引' : status?.ready ? '等待启动 Everything' : '尚未完成连接'}</small></span><button className="icon-button" title="刷新连接状态" aria-label="刷新连接状态" onClick={() => { void loadStatus(); }}><RefreshCw size={16} /></button></header>
    {!status?.ready && <div className="dock-everything-setup"><span className="dock-everything-setup-icon"><Search size={21} /></span><span><strong>{status?.everythingExists ? '需要搜索连接器' : '选择 Everything 目录'}</strong><small>{status?.effectivePath || '请选择包含 Everything.exe 的文件夹'}</small></span>{status?.everythingExists ? <button disabled={setupLoading} onClick={() => runSetup(() => window.desktopAPI.installEverythingConnector())}>{setupLoading ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}完成连接</button> : <button disabled={setupLoading} onClick={() => runSetup(() => window.desktopAPI.chooseEverythingDirectory())}><FolderOpen size={15} />选择目录</button>}</div>}
    {status?.ready && !status.running && <div className="dock-everything-offline"><AlertTriangle size={16} /><span>Everything 尚未运行</span><button disabled={setupLoading} onClick={() => runSetup(() => window.desktopAPI.startEverything())}><Play size={14} />启动</button></div>}
    <form className="dock-everything-search" onSubmit={(event) => { event.preventDefault(); void searchEverything(query); }}><Search size={18} /><input ref={inputRef} aria-label="快速面板 Everything 搜索" disabled={!status?.ready || !status.running} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={status?.running ? '输入文件名、路径或语法' : '连接并启动后即可搜索'} />{loading ? <LoaderCircle className="spin" size={16} /> : query && <button type="button" title="清除搜索" aria-label="清除搜索" onClick={() => setQuery('')}><X size={15} /></button>}</form>
    <div className="dock-everything-summary" aria-live="polite"><span>{query.trim() ? `${results.length} 个结果${elapsedMs ? ` · ${elapsedMs} ms` : ''}` : '搜索本机所有磁盘'}</span></div>
    {error && <div className="dock-everything-error" role="alert"><AlertTriangle size={15} /><span>{error}</span></div>}
    <div className="dock-everything-results">
      {results.map((result, index) => <article key={result.id} className={`dock-everything-result ${selectedIndex === index ? 'selected' : ''}`} tabIndex={0} onFocus={() => setSelectedIndex(index)} onMouseEnter={() => setSelectedIndex(index)} onClick={() => setSelectedIndex(index)} onDoubleClick={() => { void openResult(result); }}><span className="dock-everything-result-icon">{result.icon ? <img src={result.icon} alt="" /> : result.isDirectory ? <Folder size={23} /> : <File size={22} />}</span><span className="dock-everything-result-name"><strong title={result.name}>{result.name}</strong><small title={result.path}>{result.directory}</small></span><span className="dock-everything-result-actions"><button title="打开" aria-label={`打开 ${result.name}`} onClick={(event) => { event.stopPropagation(); void openResult(result); }}><FolderOpen size={15} /></button><button title="在资源管理器中显示" aria-label={`在资源管理器中显示 ${result.name}`} onClick={async (event) => { event.stopPropagation(); try { await window.desktopAPI.revealEverythingResult(result.id); } catch (nextError) { setError(errorText(nextError)); } }}><Search size={15} /></button></span></article>)}
      {!loading && status?.running && query.trim() && !results.length && !error && <div className="dock-everything-empty"><Search size={27} /><strong>没有找到匹配内容</strong><span>换一个关键词或搜索语法试试</span></div>}
      {!query.trim() && <div className="dock-everything-empty"><Search size={27} /><strong>全盘快速搜索</strong><span>结果会直接显示在快速面板中</span></div>}
    </div>
    <footer className="dock-everything-footer"><button onClick={onBack}><ArrowLeft size={14} />返回工作入口</button><span>最多显示 50 条</span></footer>
  </section>;
}

function DockApp() {
  const { payload, settings, setSettings, loading, error } = useDesktop();
  const [dockPage, setDockPage] = useState<'home' | 'everything'>('home');
  const [search, setSearch] = useState('');
  const [dockCategory, setDockCategory] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [phonetic, setPhonetic] = useState<((value: string) => string[]) | null>(null);
  const dockView = settings?.quickPanelView || 'list';
  const changeDockScale = (quickPanelItemScale: number) => {
    if (!settings) return;
    setSettings({ ...settings, quickPanelItemScale });
    void window.desktopAPI.updateSettings({ quickPanelItemScale }).then(setSettings).catch(() => {});
  };
  useEffect(() => {
    let active = true;
    void import('pinyin-pro').then(({ pinyin }) => {
      if (!active) return;
      setPhonetic(() => (value: string) => [pinyin(value, { toneType: 'none' }).replace(/\s+/g, '').toLowerCase(), pinyin(value, { pattern: 'first', toneType: 'none' }).replace(/\s+/g, '').toLowerCase()]);
    });
    return () => { active = false; };
  }, []);
  const available = payload.items.filter((item) => !item.hidden && item.exists && (!dockCategory || item.categoryId === dockCategory));
  const matches = (item: DesktopItem) => { const values = [item.name, item.target, payload.categories.find((category) => category.id === item.categoryId)?.label || '']; return smartSearchMatch(values, search, phonetic ? phonetic(values.join(' ')) : []); };
  const dockSortMode = settings?.categorySortModes[dockCategory || 'all'] || settings?.sortMode || 'name';
  const itemOrderIndex = new Map((settings?.itemOrder || []).map((id, index) => [id, index]));
  const matchedItems = available.filter(matches).sort((a, b) => {
    if (dockSortMode === 'custom') return (itemOrderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (itemOrderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
    if (dockSortMode === 'modified') return b.modifiedAt - a.modifiedAt;
    if (dockSortMode === 'used') return (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0) || b.useCount - a.useCount;
    if (dockSortMode === 'type') return TYPE_LABELS[a.type].localeCompare(TYPE_LABELS[b.type], 'zh-CN') || a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
    return a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
  });
  const knownDockCategoryIds = new Set(payload.categories.map((category) => category.id));
  const dockGroups = [
    ...payload.categories.map((category) => ({ category, items: matchedItems.filter((item) => item.categoryId === category.id) })),
    { category: undefined, items: matchedItems.filter((item) => !knownDockCategoryIds.has(item.categoryId)) },
  ].filter((group) => group.items.length > 0);
  const orderedDockItems = dockGroups.flatMap((group) => group.items);
  const scenes = payload.categories.filter((category) => { const values = [category.label, '工作场景 一键启动']; return category.quickPanel && category.launchSteps.some((step) => step.enabled) && (!dockCategory || category.id === dockCategory) && smartSearchMatch(values, search, phonetic ? phonetic(values.join(' ')) : []); });
  const actions = [...scenes.map((category) => ({ key: `scene-${category.id}`, run: () => window.desktopAPI.launchCategory(category.id) })), ...orderedDockItems.map((item) => ({ key: `item-${item.id}`, run: () => window.desktopAPI.openItem(item.id) }))];

  useEffect(() => setActiveIndex(0), [search, dockCategory, actions.length]);
  useEffect(() => { document.querySelector(`[data-dock-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' }); }, [activeIndex]);
  const runAction = async (index: number) => { try { await actions[index]?.run(); } catch {} };
  let actionIndex = 0;
  const renderDockGroup = ({ category, items }: (typeof dockGroups)[number]) => {
    const Icon = category ? NAV_ICONS[category.id] || Folder : Folder;
    const groupId = category?.id || 'unassigned';
    const title = category?.label || '未分类';
    const headerContents = <><span style={category ? { color: category.color } : undefined}><Icon size={15} /></span><strong>{title}</strong><b>{items.length}</b>{category && <ChevronRight size={14} />}</>;
    return <section className="dock-group dock-category-group" data-dock-category-id={groupId} aria-label={`${title}，${items.length} 个项目`} key={groupId}>
      {category
        ? <button className="dock-group-header" aria-pressed={dockCategory === category.id} title={dockCategory === category.id ? '返回全部工作场景' : `进入${category.label}`} onClick={() => setDockCategory(dockCategory === category.id ? null : category.id)}>{headerContents}</button>
        : <div className="dock-group-header">{headerContents}</div>}
      {items.map((item) => { const index = actionIndex; actionIndex += 1; return <button data-dock-index={index} data-dock-item-id={item.id} className={`dock-item ${activeIndex === index ? 'keyboard-active' : ''}`} key={item.id} onMouseEnter={() => setActiveIndex(index)} onClick={() => runAction(index)}><ItemIcon item={item} /><span><strong>{item.name}</strong><small>{payload.categories.find((entry) => entry.id === item.categoryId)?.label || TYPE_LABELS[item.type]}</small></span>{item.scope !== 'personal' && <i>{item.scope === 'public' ? '公共' : '外部'}</i>}</button>; })}
    </section>;
  };

  return (
    <div className={`dock-shell ${settings?.quickPanelDocked ? `dock-position-${settings.quickPanelDockPosition}` : 'dock-floating'}`} style={{ '--item-scale': (settings?.quickPanelItemScale || 100) / 100 } as CSSProperties} tabIndex={-1} onWheel={(event) => { if (!event.ctrlKey || !settings) return; event.preventDefault(); changeDockScale(settings.quickPanelItemScale + (event.deltaY < 0 ? 5 : -5)); }} onMouseEnter={() => { void window.desktopAPI.dockPointerEnter(); }} onMouseLeave={() => { void window.desktopAPI.dockPointerLeave(); }} onKeyDown={(event) => { if (dockPage === 'everything') return; const target = event.target as HTMLElement; if (target.closest('button, input, select, [role="button"]')) return; if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((value) => Math.min(Math.max(0, actions.length - 1), value + 1)); } if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((value) => Math.max(0, value - 1)); } if (event.key === 'Enter') { event.preventDefault(); void runAction(activeIndex); } if (event.key === 'Escape') void window.desktopAPI.toggleDock(); }}>
      <div className="dock-titlebar drag-region"><div className="brand-mark"><Grid2X2 size={17} /></div><strong>{dockPage === 'everything' ? '快速搜索' : '快速工作台'}</strong><button className={`icon-button no-drag ${settings?.quickPanelPinned ? 'active' : ''}`} title={settings?.quickPanelPinned ? '取消固定' : '固定面板'} onClick={async () => settings && setSettings(await window.desktopAPI.updateSettings({ quickPanelPinned: !settings.quickPanelPinned }))}><Pin size={16} fill={settings?.quickPanelPinned ? 'currentColor' : 'none'} /></button><button className="icon-button no-drag" title="关闭" onClick={() => window.desktopAPI.close()}><X size={17} /></button></div>
      {dockPage === 'everything' && settings ? <DockEverythingPage onBack={() => setDockPage('home')} /> : <>
      <label className="dock-search"><Search size={17} /><input aria-label="搜索并启动桌面项目" autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="名称、拼音或首字母" /></label>
      <button className="dock-everything-entry" onClick={() => setDockPage('everything')}><span className="dock-everything-icon"><Search size={18} /></span><span><strong>Everything 搜索</strong><small>全盘查找文件与文件夹</small></span><ChevronRight size={16} /></button>
      <div className="dock-section-title"><span>工作入口</span><div className="dock-section-actions">{settings && <ItemZoomControl compact value={settings.quickPanelItemScale} label="快速面板图标" onChange={changeDockScale} />}<div className="dock-view-toggle" aria-label="快速面板排列方式"><button className={dockView === 'list' ? 'active' : ''} aria-pressed={dockView === 'list'} title="列表排列" onClick={async () => setSettings(await window.desktopAPI.updateSettings({ quickPanelView: 'list' }))}><List size={15} /></button><button className={dockView === 'grid' ? 'active' : ''} aria-pressed={dockView === 'grid'} title="图标排列" onClick={async () => setSettings(await window.desktopAPI.updateSettings({ quickPanelView: 'grid' }))}><Grid2X2 size={15} /></button></div><button onClick={() => window.desktopAPI.openMain()}>完整窗口<ChevronRight size={15} /></button></div></div>
      <div className={`dock-list view-${dockView}`}>
        {scenes.length > 0 && <section className="dock-group"><div className="dock-group-label">一键启动场景</div>{scenes.map((category) => { const index = actionIndex; actionIndex += 1; return <button data-dock-index={index} className={`dock-item dock-scene ${activeIndex === index ? 'keyboard-active' : ''}`} key={category.id} onMouseEnter={() => setActiveIndex(index)} onClick={() => runAction(index)}><span className="dock-scene-icon" style={{ color: category.color }}><Play size={18} /></span><span><strong>{category.label}</strong><small>{category.launchSteps.filter((step) => step.enabled).length} 个启动步骤</small></span><Play size={15} /></button>; })}</section>}
        {dockGroups.map(renderDockGroup)}
        {!loading && actions.length === 0 && <div className="dock-empty">{error || '没有匹配项目'}</div>}
      </div>
      <div className="dock-categories">
        {payload.categories.filter((category) => category.quickPanel).map((category) => <button data-category-id={category.id} className={dockCategory === category.id ? 'active' : ''} aria-pressed={dockCategory === category.id} key={category.id} onClick={() => setDockCategory(dockCategory === category.id ? null : category.id)}><span style={{ background: category.color }} />{category.label}</button>)}
      </div>
      <footer className="dock-footer"><span><MonitorUp size={15} />{settings?.hotkey || 'Ctrl+Alt+D'}</span><button onClick={() => window.desktopAPI.toggleDock()}>{settings?.quickPanelPinned ? '关闭' : '收起'}</button></footer>
      </>}
    </div>
  );
}

function TitleBar({ onSettings }: { onSettings: () => void }) {
  return <div className="titlebar drag-region"><div className="titlebar-name">桌面工作台</div><div className="window-controls no-drag"><button title="设置" aria-label="设置" onClick={onSettings}><Settings size={16} /></button><button title="最小化" aria-label="最小化" onClick={() => window.desktopAPI.minimize()}><Minimize2 size={16} /></button><button title="最大化或还原" aria-label="最大化或还原" onClick={() => window.desktopAPI.maximize()}><Maximize2 size={15} /></button><button className="close-window" title="关闭" aria-label="关闭" onClick={() => window.desktopAPI.close()}><X size={17} /></button></div></div>;
}

function NavItem({ icon: Icon, label, count, active, color, onClick, dropActive = false, dropTitle, onDropItems }: { icon: typeof Folder; label: string; count: number; active: boolean; color?: string; onClick: () => void; dropActive?: boolean; dropTitle?: string; onDropItems?: (ids: string[]) => void | Promise<void> }) {
  const [dragOver, setDragOver] = useState(false);
  useEffect(() => { if (!dropActive) setDragOver(false); }, [dropActive]);
  return <button
    className={`nav-item ${active ? 'active' : ''} ${dropActive && onDropItems ? 'drop-capable' : ''} ${dragOver ? 'drag-over' : ''}`}
    title={dropActive ? dropTitle : undefined}
    onClick={onClick}
    onDragEnter={(event) => { if (dropActive && onDropItems) { event.preventDefault(); setDragOver(true); } }}
    onDragOver={(event) => { if (dropActive && onDropItems) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false); }}
    onDrop={(event) => {
      if (!onDropItems) return;
      event.preventDefault();
      setDragOver(false);
      let ids: string[] = [];
      try {
        const value = JSON.parse(event.dataTransfer.getData('application/x-desktop-workspace-items'));
        if (Array.isArray(value) && value.every((id) => typeof id === 'string')) ids = value;
      } catch {}
      void onDropItems(ids);
    }}
  ><Icon size={17} style={color ? { color } : undefined} /><span>{label}</span>{count > 0 && <b>{count}</b>}</button>;
}

function ItemIcon({ item }: { item: DesktopItem }) {
  const Fallback = TYPE_ICONS[item.type];
  const initials = item.name.trim().replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 2).toLocaleUpperCase('zh-CN') || 'APP';
  const hue = [...item.name].reduce((sum, character) => sum + character.codePointAt(0)!, 0) % 360;
  return <div className={`item-icon type-${item.type}`}>{item.icon ? <img src={item.icon} alt="" draggable={false} /> : item.type === 'shortcut' ? <span className="item-icon-initials" style={{ backgroundColor: `hsl(${hue} 48% 38%)` }}>{initials}</span> : <Fallback size={25} />}</div>;
}

function ItemCard({ item, category, selected, dragging, dropPlacement, onInspect, onSelect, onAction, onDragStart, onDragEnd, onReorderOver, onReorderDrop, onContextMenu }: { item: DesktopItem; category?: Category; selected: boolean; dragging: boolean; dropPlacement: 'before' | 'after' | null; onInspect: () => void; onSelect: () => void; onAction: (action: ContextItemAction) => void; onDragStart: (event: React.DragEvent<HTMLElement>) => void; onDragEnd: () => void; onReorderOver: (placement: 'before' | 'after') => void; onReorderDrop: (placement: 'before' | 'after', ids: string[]) => void | Promise<void>; onContextMenu: (event: React.MouseEvent) => void }) {
  const placementFromPointer = (event: React.DragEvent<HTMLElement>) => event.clientX < event.currentTarget.getBoundingClientRect().left + event.currentTarget.getBoundingClientRect().width / 2 ? 'before' : 'after';
  return <article draggable className={`item-card ${selected ? 'selected' : ''} ${dragging ? 'dragging' : ''} ${dropPlacement ? `drop-${dropPlacement}` : ''}`} data-item-id={item.id} data-drop-placement={dropPlacement || undefined} tabIndex={0} aria-label={`${item.name}，${category?.label || '其他'}，${SCOPE_LABELS[item.scope]}`} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragOver={(event) => { if (dragging) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; onReorderOver(placementFromPointer(event)); }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); if (dragging) return; let ids: string[] = []; try { const value = JSON.parse(event.dataTransfer.getData('application/x-desktop-workspace-items')); if (Array.isArray(value) && value.every((id) => typeof id === 'string')) ids = value; } catch {} void onReorderDrop(placementFromPointer(event), ids); }} onContextMenu={onContextMenu} onKeyDown={(event) => { if (event.key === 'Enter') onAction('open'); }} onDoubleClick={(event) => { if (!(event.target as HTMLElement).closest('button')) onAction('open'); }}>
    <div className="item-card-top"><button className={`check-button ${selected ? 'checked' : ''}`} aria-label={`选择 ${item.name}`} onClick={onSelect}>{selected && <Check size={14} />}</button><button className={`star-button ${item.favorite ? 'active' : ''}`} title={item.favorite ? '取消收藏' : '收藏'} onClick={() => onAction('favorite')}><Star size={16} fill={item.favorite ? 'currentColor' : 'none'} /></button></div>
    <ItemIcon item={item} />
    <div className="item-main"><strong title={item.fileName}>{item.name}</strong><span><i style={{ background: category?.color }} />{category?.label || '其他'}</span></div>
    <div className="item-badges">{item.scope !== 'personal' && <em>{SCOPE_LABELS[item.scope]}</em>}{item.duplicateKind === 'shortcut-target' && <em className="warning">重复快捷方式</em>}{item.duplicateKind === 'suspected-file' && <em className="warning">疑似重复</em>}{item.duplicateKind === 'exact-file' && <em className="danger">精确重复</em>}{(!item.targetExists || !item.exists) && <em className="danger">失效</em>}{item.isNew && <em className="new">{item.suggestedCategoryId ? `建议：${item.suggestionReason}` : '新'}</em>}</div>
    <div className="item-actions"><button title="打开" onClick={() => onAction('open')}><FolderOpen size={16} /></button><button title="在资源管理器中显示" onClick={() => onAction('reveal')}><Search size={16} /></button><button title="查看详情" onClick={onInspect}><PanelRightOpen size={16} /></button><button title={item.hidden ? '取消隐藏' : '从工作台隐藏'} onClick={() => onAction('hide')}><EyeOff size={16} /></button></div>
  </article>;
}

function ItemRow({ item, category, selected, dragging, onInspect, onSelect, onAction, onDragStart, onDragEnd, onContextMenu }: { item: DesktopItem; category?: Category; selected: boolean; dragging: boolean; onInspect: () => void; onSelect: () => void; onAction: (action: ContextItemAction) => void; onDragStart: (event: React.DragEvent<HTMLElement>) => void; onDragEnd: () => void; onContextMenu: (event: React.MouseEvent) => void }) {
  return <article draggable className={`item-row ${selected ? 'selected' : ''} ${dragging ? 'dragging' : ''}`} data-item-id={item.id} tabIndex={0} aria-label={`${item.name}，${category?.label || '其他'}，${SCOPE_LABELS[item.scope]}`} onDragStart={onDragStart} onDragEnd={onDragEnd} onContextMenu={onContextMenu} onKeyDown={(event) => { if (event.key === 'Enter') onAction('open'); }} onDoubleClick={(event) => { if (!(event.target as HTMLElement).closest('button')) onAction('open'); }}>
    <button className={`check-button ${selected ? 'checked' : ''}`} aria-label={`选择 ${item.name}`} onClick={onSelect}>{selected && <Check size={14} />}</button>
    <ItemIcon item={item} /><div className="row-name"><strong>{item.name}</strong><span>{item.target || item.path}</span></div>
    <span className="row-category"><i style={{ background: category?.color }} />{category?.label || '其他'}</span>
    <span className="row-scope">{SCOPE_LABELS[item.scope]}</span><span className="row-date">{formatDate(item.modifiedAt)}</span>
    <div className="row-actions"><button title="收藏" className={item.favorite ? 'active' : ''} onClick={() => onAction('favorite')}><Star size={16} fill={item.favorite ? 'currentColor' : 'none'} /></button><button title="定位" onClick={() => onAction('reveal')}><FolderOpen size={16} /></button><button title="查看详情" onClick={onInspect}><PanelRightOpen size={16} /></button><button title="隐藏" onClick={() => onAction('hide')}><EyeOff size={16} /></button></div>
  </article>;
}

function LoadingScreen({ error }: { error: string }) {
  return <div className="loading-screen"><div className="brand-mark"><Grid2X2 size={22} /></div><strong>{error || '正在读取桌面内容'}</strong></div>;
}

function EmptyState({ query }: { query: string }) {
  return <div className="empty-state"><Search size={32} /><strong>{query ? '没有匹配项目' : '当前分类为空'}</strong><span>{query ? '换一个名称、类型或路径试试' : '桌面有新内容时会自动出现在这里'}</span></div>;
}

export default App;
