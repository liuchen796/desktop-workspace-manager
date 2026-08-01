import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error Shared CommonJS service is consumed by Electron at runtime.
import recoveryModule from '../electron/organize-service.cjs';

const { createMoveRecoveryService } = recoveryModule;
const roots: string[] = [];

async function fixture() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'desktop-move-recovery-'));
  roots.push(root);
  const desktop = path.join(root, 'Desktop');
  const archive = path.join(root, 'Archive');
  const journals = path.join(root, 'journals');
  await Promise.all([fsp.mkdir(desktop), fsp.mkdir(archive), fsp.mkdir(journals)]);
  const trashed: string[] = [];
  const service = createMoveRecoveryService({
    directory: journals,
    getPersonalRoot: () => desktop,
    trash: async (target: string) => { trashed.push(target); await fsp.rm(target, { recursive: true, force: false }); },
  });
  return { root, desktop, archive, journals, service, trashed };
}

afterEach(async () => Promise.all(roots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true }))));

describe('cross-volume move recovery', () => {
  it('restores a hidden source while preserving an already committed target', async () => {
    const { desktop, archive, service } = await fixture();
    const source = path.join(desktop, 'project.txt');
    const target = path.join(archive, 'project.txt');
    const holding = path.join(desktop, '.desktop-workspace-test-project.txt.moving');
    const journal = service.createRecoveryJournal({ id: 'item', name: 'project.txt', source, target });
    await Promise.all([fsp.writeFile(holding, 'source'), fsp.writeFile(target, 'target')]);
    await journal.update({ stage: 'committed', source, target, holding, sealed: `${holding}.sealed`, temporary: `${target}.desktop-workspace-test.partial` });
    const [issue] = await service.listRecoveryIssues();
    expect(issue.hiddenSourceExists).toBe(true);
    expect(issue.targetExists).toBe(true);
    const result = await service.recover(issue.id);
    expect(await fsp.readFile(source, 'utf8')).toBe('source');
    expect(await fsp.readFile(target, 'utf8')).toBe('target');
    expect(result.restored).toEqual([source]);
    expect(await service.listRecoveryIssues()).toEqual([]);
  });

  it('uses a unique desktop name and recycles a partial copy when the source already exists', async () => {
    const { desktop, archive, service, trashed } = await fixture();
    const source = path.join(desktop, 'report.txt');
    const target = path.join(archive, 'report.txt');
    const holding = path.join(desktop, '.desktop-workspace-test-report.txt.moving');
    const temporary = `${target}.desktop-workspace-test.partial`;
    await Promise.all([fsp.writeFile(source, 'new'), fsp.writeFile(holding, 'old'), fsp.writeFile(temporary, 'partial')]);
    const journal = service.createRecoveryJournal({ id: 'item', name: 'report.txt', source, target });
    await journal.update({ stage: 'failed', source, target, holding, sealed: `${holding}.sealed`, temporary });
    const [issue] = await service.listRecoveryIssues();
    const result = await service.recover(issue.id);
    expect(result.restored).toHaveLength(1);
    expect(result.restored[0]).not.toBe(source);
    expect(await fsp.readFile(result.restored[0], 'utf8')).toBe('old');
    expect(await fsp.readFile(source, 'utf8')).toBe('new');
    expect(trashed).toEqual([temporary]);
  });

  it('clears a prepared transaction when the untouched source is still present', async () => {
    const { desktop, archive, service } = await fixture();
    const source = path.join(desktop, 'safe.txt');
    const target = path.join(archive, 'safe.txt');
    await fsp.writeFile(source, 'safe');
    const journal = service.createRecoveryJournal({ id: 'item', name: 'safe.txt', source, target });
    await journal.update({ stage: 'prepared', source, target, holding: path.join(desktop, '.desktop-workspace-test-safe.txt.moving'), sealed: path.join(desktop, '.desktop-workspace-test-safe.txt.moving.sealed'), temporary: `${target}.desktop-workspace-test.partial` });
    const [issue] = await service.listRecoveryIssues();
    const result = await service.recover(issue.id);
    expect(result.preserved).toEqual([source]);
    expect(await service.listRecoveryIssues()).toEqual([]);
  });

  it('refuses a tampered journal that points its hidden source outside the desktop', async () => {
    const { root, desktop, archive, service } = await fixture();
    const source = path.join(desktop, 'safe.txt');
    const target = path.join(archive, 'safe.txt');
    const outside = path.join(root, '.desktop-workspace-evil.moving');
    await fsp.writeFile(outside, 'do not touch');
    const journal = service.createRecoveryJournal({ id: 'item', name: 'safe.txt', source, target });
    await journal.update({ stage: 'held', source, target, holding: outside, sealed: `${outside}.sealed`, temporary: `${target}.desktop-workspace-test.partial` });
    const [issue] = await service.listRecoveryIssues();
    expect(issue.stage).toBe('invalid');
    await expect(service.recover(issue.id)).rejects.toThrow('隐藏恢复路径无效');
    expect(fs.existsSync(outside)).toBe(true);
  });
});
