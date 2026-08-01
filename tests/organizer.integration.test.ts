import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error Shared CommonJS module is consumed by Electron at runtime.
import organizer from '../shared/organizer.cjs';

const { executeOperations, restoreOperations, movePath } = organizer;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })));
});

describe('organize and undo integration', () => {
  it('moves a file into the archive and restores it', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'desktop-workspace-'));
    temporaryRoots.push(root);
    const archiveRoot = path.join(root, '桌面归档');
    const categoryRoot = path.join(archiveRoot, '客户项目');
    await fsp.mkdir(categoryRoot, { recursive: true });
    const source = path.join(root, '项目说明.txt');
    const target = path.join(categoryRoot, '项目说明.txt');
    await fsp.writeFile(source, 'safe move');
    const operation = { id: 'one', name: '项目说明.txt', source, target, renamed: false };

    const moved = await executeOperations([operation]);
    expect(moved.failed).toHaveLength(0);
    expect(fs.existsSync(source)).toBe(false);
    expect(await fsp.readFile(target, 'utf8')).toBe('safe move');

    const undone = await restoreOperations([operation], { personalRoot: root, archiveRoot });
    expect(undone.failed).toHaveLength(0);
    expect(await fsp.readFile(source, 'utf8')).toBe('safe move');
  });

  it('does not overwrite a file created at the original location', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'desktop-workspace-'));
    temporaryRoots.push(root);
    const archiveRoot = path.join(root, '桌面归档');
    const categoryRoot = path.join(archiveRoot, '其他');
    await fsp.mkdir(categoryRoot, { recursive: true });
    const source = path.join(root, '同名.txt');
    const target = path.join(categoryRoot, '同名.txt');
    await fsp.writeFile(target, 'archived');
    await fsp.writeFile(source, 'new file');
    const operation = { id: 'two', name: '同名.txt', source, target, renamed: false };

    const undone = await restoreOperations([operation], { personalRoot: root, archiveRoot });
    expect(undone.failed).toHaveLength(0);
    expect(await fsp.readFile(source, 'utf8')).toBe('new file');
    expect(await fsp.readFile(path.join(root, '同名 (2).txt'), 'utf8')).toBe('archived');
  });

  it('rejects a target outside the archive root', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'desktop-workspace-'));
    temporaryRoots.push(root);
    const outside = path.join(root, 'outside', '文件.txt');
    await fsp.mkdir(path.dirname(outside), { recursive: true });
    await fsp.writeFile(outside, 'do not restore');
    const operation = { id: 'three', name: '文件.txt', source: path.join(root, '文件.txt'), target: outside, renamed: false };

    const undone = await restoreOperations([operation], { personalRoot: root, archiveRoot: path.join(root, '桌面归档') });
    expect(undone.restored).toHaveLength(0);
    expect(undone.failed[0].reason).toContain('超出允许范围');
  });

  it('does not overwrite a target created after preview', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'desktop-workspace-'));
    temporaryRoots.push(root);
    const source = path.join(root, 'source.txt');
    const target = path.join(root, 'target.txt');
    await fsp.writeFile(source, 'source');
    await fsp.writeFile(target, 'existing target');
    const operation = { id: 'four', name: 'source.txt', source, target, renamed: false };

    const moved = await executeOperations([operation]);
    expect(moved.completed).toHaveLength(0);
    expect(moved.failed[0].reason).toContain('同名项目');
    expect(await fsp.readFile(source, 'utf8')).toBe('source');
    expect(await fsp.readFile(target, 'utf8')).toBe('existing target');
  });

  it('copies, verifies and removes the source when rename reports a cross-device move', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'desktop-workspace-'));
    temporaryRoots.push(root);
    const source = path.join(root, 'cross-source.txt');
    const target = path.join(root, 'cross-target.txt');
    await fsp.writeFile(source, 'cross-device-safe');
    const rename = async (from: string, to: string) => {
      if (from === source && to === target) throw Object.assign(new Error('cross device'), { code: 'EXDEV' });
      return fsp.rename(from, to);
    };

    const result = await movePath(source, target, { rename });
    expect(result.crossDevice).toBe(true);
    expect(fs.existsSync(source)).toBe(false);
    expect(await fsp.readFile(target, 'utf8')).toBe('cross-device-safe');
  });

  it('cancels a cross-device move when equal-length source content changes during copy', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'desktop-workspace-'));
    temporaryRoots.push(root);
    const source = path.join(root, 'changing.txt');
    const target = path.join(root, 'changing-target.txt');
    await fsp.writeFile(source, 'OLD');
    const rename = async (from: string, to: string) => {
      if (from === source && to === target) throw Object.assign(new Error('cross device'), { code: 'EXDEV' });
      return fsp.rename(from, to);
    };
    const copy = async (from: string, to: string, options: Parameters<typeof fsp.cp>[2]) => {
      await fsp.cp(from, to, options);
      if (to.includes('.partial')) await fsp.writeFile(from, 'NEW');
    };

    await expect(movePath(source, target, { rename, copy })).rejects.toThrow('源项目发生变化');
    expect(await fsp.readFile(source, 'utf8')).toBe('NEW');
    expect(fs.existsSync(target)).toBe(false);
  });

  it('preserves a verified target and reconstructs the source when cleanup fails', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'desktop-workspace-'));
    temporaryRoots.push(root);
    const source = path.join(root, 'source-directory');
    const target = path.join(root, 'target-directory');
    await fsp.mkdir(source);
    await fsp.writeFile(path.join(source, 'a.txt'), 'A');
    await fsp.writeFile(path.join(source, 'b.txt'), 'B');
    const rename = async (from: string, to: string) => {
      if (from === source && to === target) throw Object.assign(new Error('cross device'), { code: 'EXDEV' });
      return fsp.rename(from, to);
    };
    let cleanupFailed = false;
    const remove = async (targetPath: string, options: Parameters<typeof fsp.rm>[1]) => {
      if (!cleanupFailed && targetPath.endsWith('.sealed')) {
        cleanupFailed = true;
        await fsp.rm(path.join(targetPath, 'a.txt'));
        throw new Error('simulated cleanup failure');
      }
      return fsp.rm(targetPath, options);
    };

    const trash = (targetPath: string) => remove(targetPath, { recursive: true, force: false });
    await expect(movePath(source, target, { rename, remove, trash })).rejects.toThrow('目标位置');
    expect(await fsp.readFile(path.join(target, 'a.txt'), 'utf8')).toBe('A');
    expect(await fsp.readFile(path.join(target, 'b.txt'), 'utf8')).toBe('B');
    expect(await fsp.readFile(path.join(source, 'a.txt'), 'utf8')).toBe('A');
    expect(await fsp.readFile(path.join(source, 'b.txt'), 'utf8')).toBe('B');
  });

  it('detects an equal-length source update after target commit and preserves both versions', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'desktop-workspace-'));
    temporaryRoots.push(root);
    const source = path.join(root, 'late-change.txt');
    const target = path.join(root, 'late-change-target.txt');
    await fsp.writeFile(source, 'OLD');
    const rename = async (from: string, to: string) => {
      if (from === source && to === target) throw Object.assign(new Error('cross device'), { code: 'EXDEV' });
      await fsp.rename(from, to);
      if (to === target && from.includes('.partial')) {
        const holdingName = (await fsp.readdir(root)).find((name) => name.endsWith('.moving'));
        if (holdingName) await fsp.writeFile(path.join(root, holdingName), 'NEW');
      }
    };

    await expect(movePath(source, target, { rename })).rejects.toThrow('再次发生变化');
    expect(await fsp.readFile(source, 'utf8')).toBe('NEW');
    expect(await fsp.readFile(target, 'utf8')).toBe('OLD');
  });

  it('sends a source changed at cleanup time to recoverable trash instead of deleting it', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'desktop-workspace-'));
    temporaryRoots.push(root);
    const source = path.join(root, 'trash-race.txt');
    const target = path.join(root, 'trash-race-target.txt');
    const recycle = path.join(root, 'recycle-copy.txt');
    await fsp.writeFile(source, 'OLD');
    const rename = async (from: string, to: string) => {
      if (from === source && to === target) throw Object.assign(new Error('cross device'), { code: 'EXDEV' });
      return fsp.rename(from, to);
    };
    const trash = async (sealedPath: string) => {
      await fsp.writeFile(sealedPath, 'NEW');
      await fsp.rename(sealedPath, recycle);
    };

    const result = await movePath(source, target, { rename, trash });
    expect(result.sourceRecovery).toBe('recycle-bin');
    expect(await fsp.readFile(target, 'utf8')).toBe('OLD');
    expect(await fsp.readFile(recycle, 'utf8')).toBe('NEW');
  });

  it('rejects a source changed after preview', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'desktop-workspace-'));
    temporaryRoots.push(root);
    const source = path.join(root, 'changed.txt');
    const target = path.join(root, 'archive.txt');
    await fsp.writeFile(source, 'before');
    const stat = await fsp.lstat(source);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await fsp.writeFile(source, 'after-change');
    const operation = { id: 'changed', name: 'changed.txt', source, target, renamed: false, sourceIdentity: { size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino } };

    const moved = await executeOperations([operation]);
    expect(moved.completed).toHaveLength(0);
    expect(moved.failed[0].reason).toContain('发生变化');
    expect(await fsp.readFile(source, 'utf8')).toBe('after-change');
  });

  it('restores from a transaction-specific custom archive root', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'desktop-workspace-'));
    temporaryRoots.push(root);
    const customArchive = path.join(root, 'custom-archive');
    await fsp.mkdir(customArchive);
    const source = path.join(root, 'restore-custom.txt');
    const target = path.join(customArchive, 'restore-custom.txt');
    await fsp.writeFile(target, 'custom archive');
    const operation = { id: 'custom', name: 'restore-custom.txt', source, target, renamed: false };

    const result = await restoreOperations([operation], { personalRoot: root, archiveRoot: customArchive });
    expect(result.failed).toHaveLength(0);
    expect(await fsp.readFile(source, 'utf8')).toBe('custom archive');
  });
});
