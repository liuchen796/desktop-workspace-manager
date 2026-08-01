import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
// @ts-expect-error Electron CommonJS services are loaded directly at runtime.
import ipcModule from '../electron/ipc-service.cjs';
// @ts-expect-error Electron CommonJS services are loaded directly at runtime.
import scannerModule from '../electron/scanner-service.cjs';
// @ts-expect-error Electron CommonJS services are loaded directly at runtime.
import dockModule from '../electron/dock-service.cjs';
// @ts-expect-error Electron CommonJS services are loaded directly at runtime.
import backupModule from '../electron/backup-service.cjs';

describe('electron domain services', () => {
  it('rejects IPC calls from pages outside the packaged application', async () => {
    let wrapped: ((event: unknown, value: string) => unknown) | null = null;
    const native = { handle: (_channel: string, listener: typeof wrapped) => { wrapped = listener; } };
    const applicationFile = path.resolve('dist/index.html');
    const ipc = ipcModule.createIpcService(native, { applicationFile });
    ipc.handle('test', (_event: unknown, value: string) => `ok:${value}`);
    const trusted = { senderFrame: { url: `${pathToFileURL(applicationFile).href}#/` } };
    expect(await wrapped!(trusted, 'value')).toBe('ok:value');
    expect(() => wrapped!({ senderFrame: { url: 'file:///C:/Temp/untrusted.html' } }, 'value')).toThrow('非应用页面');
  });

  it('owns desktop roots and watcher cleanup independently from the main process', () => {
    const close = vi.fn();
    const watch = vi.fn(() => ({ close }));
    const service = scannerModule.createScannerService({ app: { getPath: () => 'C:\\Users\\Demo\\Desktop' }, fs: { existsSync: () => false, watch }, publicDirectory: '' });
    expect(service.roots()).toEqual([{ scope: 'personal', path: 'C:\\Users\\Demo\\Desktop' }]);
    service.startWatchers(vi.fn());
    expect(watch).toHaveBeenCalledOnce();
    service.stopWatchers();
    expect(close).toHaveBeenCalledOnce();
  });

  it('calculates a visible dock position and distance through the dock service', () => {
    const display = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 };
    const service = dockModule.createDockService({ screen: { getAllDisplays: () => [display], getPrimaryDisplay: () => display }, dockSize: () => ({ width: 388, height: 760 }), resolveDockTarget: () => null });
    const state = service.initialWindowState({ quickPanelDocked: false });
    expect(state.bounds.x).toBe(1514);
    expect(service.boundsVisible([display], state.bounds, 388, 760)).toBe(true);
    expect(service.edgeDistance({ x: 5, y: 0, width: 388 }, { position: 'left', edge: 0 })).toBe(5);
  });

  it('enforces a real history retention limit after module extraction', () => {
    const service = backupModule.createBackupService({ currentVersion: 1, normalizeSettings: (value: unknown) => value, validateCategoryStructure: () => true, assertRealPath: (value: string) => value, isWithin: () => false, getDesktopRoots: () => [] });
    const history = Array.from({ length: 40 }, (_, index) => ({ id: String(index), timestamp: index, undone: false }));
    expect(service.trimHistory(history, 30)).toHaveLength(30);
    expect(service.trimHistory(history, 30)[0].timestamp).toBe(39);
  });
});
