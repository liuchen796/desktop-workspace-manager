import { afterEach, describe, expect, it } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error Shared CommonJS module is consumed by Electron at runtime.
import storage from '../shared/storage.cjs';

const { loadJsonWithRecovery, writeJsonAtomic, createRotatingBackup } = storage;
const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true }))));

describe('JSON storage recovery', () => {
  it('quarantines malformed JSON and recreates a valid file', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'desktop-settings-'));
    roots.push(root);
    const file = path.join(root, 'settings.json');
    await fsp.writeFile(file, '{broken', 'utf8');
    const result = await loadJsonWithRecovery(file, { version: 3 }, { currentVersion: 3 });
    expect(result.status).toBe('corrupt');
    expect(result.preservedPath).toContain('.corrupt-');
    expect(JSON.parse(await fsp.readFile(file, 'utf8'))).toEqual({ version: 3 });
  });

  it('preserves a future-version file instead of overwriting it', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'desktop-settings-'));
    roots.push(root);
    const file = path.join(root, 'settings.json');
    await writeJsonAtomic(file, { version: 99, categories: ['future'] });
    const result = await loadJsonWithRecovery(file, { version: 3 }, { currentVersion: 3 });
    expect(result.status).toBe('unsupported');
    expect(JSON.parse(await fsp.readFile(result.preservedPath, 'utf8')).version).toBe(99);
  });

  it('keeps only the requested number of rotating backups', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'desktop-settings-'));
    roots.push(root);
    const file = path.join(root, 'settings.json');
    const backupDirectory = path.join(root, 'backups');
    await writeJsonAtomic(file, { version: 3 });
    for (let index = 0; index < 4; index += 1) {
      await createRotatingBackup(file, backupDirectory, 2);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect((await fsp.readdir(backupDirectory)).length).toBe(2);
  });
});
