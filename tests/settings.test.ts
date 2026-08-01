import { describe, expect, it } from 'vitest';
// @ts-expect-error Shared CommonJS module is consumed by Electron at runtime.
import settingsModule from '../shared/settings.cjs';

const { CURRENT_SETTINGS_VERSION, normalizeSettings, validateCategoryStructure } = settingsModule;

describe('settings migration', () => {
  it('migrates legacy categories to stable archive folders', () => {
    const settings = normalizeSettings({ version: 1, categories: [{ id: 'projects', label: '客户:项目', color: '#157A6E' }] });
    expect(settings.version).toBe(CURRENT_SETTINGS_VERSION);
    expect(settings.categories[0].archiveFolder).toBe('客户项目');
  });

  it('keeps the archive folder stable after a category rename', () => {
    const settings = normalizeSettings({ categories: [{ id: 'projects', label: '新显示名称', color: '#157A6E', archiveFolder: '客户项目' }] });
    expect(settings.categories[0].label).toBe('新显示名称');
    expect(settings.categories[0].archiveFolder).toBe('客户项目');
  });

  it('normalizes persisted workspace state', () => {
    const settings = normalizeSettings({ sortMode: 'invalid', activeView: 'missing', favorites: ['a', 'a', 1], gridDensity: 'compact', workspaceItemScale: 133, quickPanelView: 'grid', quickPanelItemScale: 117, quickPanelDockPosition: 'top', quickPanelDockDisplayId: '123', quickPanelHideDelay: 1250, quickPanelTriggerSize: 14, quickPanelSnapDistance: 44, quickPanelSlideDuration: 260, itemOrder: ['b', 'a', 'b'], everythingPath: ' C:\\Program Files\\Everything ' });
    expect(settings.sortMode).toBe('name');
    expect(settings.activeView).toBe('all');
    expect(settings.favorites).toEqual(['a']);
    expect(settings.gridDensity).toBe('compact');
    expect(settings.workspaceItemScale).toBe(135);
    expect(settings.quickPanelView).toBe('grid');
    expect(settings.quickPanelItemScale).toBe(115);
    expect(settings.quickPanelDockPosition).toBe('top');
    expect(settings.quickPanelDockDisplayId).toBe('123');
    expect(settings.quickPanelHideDelay).toBe(1250);
    expect(settings.quickPanelTriggerSize).toBe(14);
    expect(settings.quickPanelSnapDistance).toBe(44);
    expect(settings.quickPanelSlideDuration).toBe(260);
    expect(settings.itemOrder).toEqual(['b', 'a']);
    expect(settings.everythingPath).toBe('C:\\Program Files\\Everything');
  });

  it('normalizes quick panel auto-hide preferences', () => {
    const settings = normalizeSettings({ workspaceItemScale: 20, quickPanelItemScale: 300, quickPanelAutoHide: 'true', quickPanelDocked: 'yes', quickPanelDockPosition: 'bottom', quickPanelHideDelay: 50, quickPanelTriggerSize: 80, quickPanelSnapDistance: 3, quickPanelSlideDuration: 900 });
    expect(settings.workspaceItemScale).toBe(80);
    expect(settings.quickPanelItemScale).toBe(160);
    expect(settings.quickPanelAutoHide).toBe(true);
    expect(settings.quickPanelDockPosition).toBe('right');
    expect(settings.quickPanelDocked).toBe(true);
    expect(settings.quickPanelHideDelay).toBe(300);
    expect(settings.quickPanelTriggerSize).toBe(24);
    expect(settings.quickPanelSnapDistance).toBe(8);
    expect(settings.quickPanelSlideDuration).toBe(500);
  });

  it('does not treat string booleans as enabled settings', () => {
    const settings = normalizeSettings({ closeToTray: 'false', launchAtStartup: 1, reduceMotion: true, quickPanelPinned: 'true' });
    expect(settings.closeToTray).toBe(true);
    expect(settings.launchAtStartup).toBe(false);
    expect(settings.reduceMotion).toBe(true);
    expect(settings.quickPanelPinned).toBe(false);
  });

  it('drops invalid category rules and malformed window bounds', () => {
    const settings = normalizeSettings({
      categories: [{ id: 'custom', label: '自定义', color: 'red', rules: [{ id: 'bad', field: 'unknown', operator: 'equals', value: 'x' }] }],
      dockBounds: { x: '12', y: 20 },
    });
    expect(settings.categories[0].color).toBe('#64748B');
    expect(settings.categories[0].rules).toEqual([]);
    expect(settings.dockBounds).toBeNull();
  });

  it('rejects imported category structures without required system categories', () => {
    expect(() => validateCategoryStructure([{ id: 'projects', label: '项目' }])).toThrow('待整理');
    expect(() => validateCategoryStructure([{ id: 'inbox' }, { id: 'other' }, { id: 'other' }])).toThrow('重复');
  });
});
