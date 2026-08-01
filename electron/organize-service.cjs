const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { uniquePath } = require('../shared/classifier.cjs');
const { normalized, isDirectChild } = require('../shared/path-safety.cjs');
const { writeJsonAtomic } = require('../shared/storage.cjs');

const JOURNAL_PATTERN = /^move-[a-f0-9-]+\.json$/i;
const SPECIAL_PATTERN = /^\.desktop-workspace-.+\.(?:moving|sealed)$/i;

function createMoveRecoveryService({ directory, getPersonalRoot, trash }) {
  async function readRecord(file) {
    const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string') throw new Error('事务记录无效');
    return parsed;
  }

  function journalPath(id) {
    return path.join(directory, `move-${id}.json`);
  }

  function createRecoveryJournal(operation) {
    const id = crypto.randomUUID();
    const file = journalPath(id);
    let record = {
      id,
      operationId: operation.id,
      name: operation.name,
      source: operation.source,
      target: operation.target,
      stage: 'created',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    return {
      update: async (patch) => {
        record = { ...record, ...patch, updatedAt: Date.now() };
        await fsp.mkdir(directory, { recursive: true });
        await writeJsonAtomic(file, record);
      },
      clear: async () => fsp.rm(file, { force: true }),
    };
  }

  async function files() {
    try {
      return (await fsp.readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && JOURNAL_PATTERN.test(entry.name))
        .map((entry) => path.join(directory, entry.name));
    } catch {
      return [];
    }
  }

  function exists(target) {
    return typeof target === 'string' && target.length > 0 && fs.existsSync(target);
  }

  function validateRecord(record) {
    const personalRoot = getPersonalRoot();
    if (!record.source || !isDirectChild(record.source, personalRoot)) throw new Error('事务来源不在个人桌面第一层');
    const sourceParent = normalized(path.dirname(record.source));
    for (const candidate of [record.holding, record.sealed].filter(Boolean)) {
      if (normalized(path.dirname(candidate)) !== sourceParent || !SPECIAL_PATTERN.test(path.basename(candidate))) throw new Error('隐藏恢复路径无效');
    }
    if (record.temporary) {
      const expectedPrefix = `${path.basename(record.target)}.desktop-workspace-`;
      if (normalized(path.dirname(record.temporary)) !== normalized(path.dirname(record.target)) || !path.basename(record.temporary).startsWith(expectedPrefix) || !record.temporary.endsWith('.partial')) throw new Error('临时副本路径无效');
    }
  }

  function summarize(record) {
    const hiddenPath = [record.sealed, record.holding].find(exists) || '';
    return {
      id: record.id,
      name: record.name || path.basename(record.source || ''),
      stage: record.stage || 'unknown',
      source: record.source || '',
      target: record.target || '',
      updatedAt: Number(record.updatedAt) || Number(record.createdAt) || 0,
      sourceExists: exists(record.source),
      targetExists: exists(record.target),
      hiddenSourceExists: Boolean(hiddenPath),
      temporaryExists: exists(record.temporary),
      error: typeof record.error === 'string' ? record.error : '',
    };
  }

  async function listRecoveryIssues() {
    const issues = [];
    for (const file of await files()) {
      try {
        const record = await readRecord(file);
        validateRecord(record);
        issues.push(summarize(record));
      } catch (error) {
        issues.push({ id: path.basename(file, '.json').replace(/^move-/, ''), name: '无法读取的整理事务', stage: 'invalid', source: '', target: '', updatedAt: 0, sourceExists: false, targetExists: false, hiddenSourceExists: false, temporaryExists: false, error: error.message || String(error) });
      }
    }
    return issues.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async function recover(id) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{20,}$/i.test(id)) throw new Error('事务标识无效');
    const file = journalPath(id);
    const record = await readRecord(file);
    validateRecord(record);
    const restored = [];
    const preserved = [];
    const cleaned = [];
    const hiddenPaths = [...new Set([record.sealed, record.holding].filter(exists))];
    for (const hiddenPath of hiddenPaths) {
      const restoreTarget = uniquePath(record.source, fs.existsSync);
      await fsp.rename(hiddenPath, restoreTarget);
      restored.push(restoreTarget);
    }
    if (exists(record.source)) preserved.push(record.source);
    if (exists(record.target)) preserved.push(record.target);
    if (exists(record.temporary)) {
      if (!preserved.length && !restored.length) throw new Error('没有确认到完整源文件或目标文件，临时副本已保留，请人工检查');
      if (trash) await trash(record.temporary);
      else await fsp.rm(record.temporary, { recursive: true, force: false });
      cleaned.push(record.temporary);
    }
    const unresolvedHidden = [record.sealed, record.holding].some(exists);
    const unresolvedTemporary = exists(record.temporary);
    if (unresolvedHidden || unresolvedTemporary) throw new Error('仍有未处理的恢复文件，事务记录已保留');
    await fsp.rm(file, { force: true });
    return { id, restored, preserved: [...new Set(preserved)], cleaned };
  }

  async function recoverAll() {
    const completed = [];
    const failed = [];
    for (const issue of await listRecoveryIssues()) {
      try { completed.push(await recover(issue.id)); }
      catch (error) { failed.push({ id: issue.id, name: issue.name, reason: error.message || String(error) }); }
    }
    return { completed, failed, remaining: await listRecoveryIssues() };
  }

  async function reveal(id, showItemInFolder) {
    const record = await readRecord(journalPath(id));
    validateRecord(record);
    const candidate = [record.sealed, record.holding, record.temporary, record.target, record.source].find(exists);
    if (!candidate) throw new Error('事务相关文件已经不存在');
    showItemInFolder(candidate);
    return true;
  }

  return { createRecoveryJournal, listRecoveryIssues, recover, recoverAll, reveal };
}

module.exports = { createMoveRecoveryService };
