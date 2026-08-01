const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { uniquePath } = require('./classifier.cjs');
const { isDirectChild, isWithin, assertNoLinkSegments, normalized } = require('./path-safety.cjs');

async function hashFile(target) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(target);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });
}

async function pathSummary(target) {
  const stat = await fsp.lstat(target);
  if (stat.isSymbolicLink()) throw new Error('跨盘复制不允许包含符号链接或目录联接');
  if (!stat.isDirectory()) return { files: 1, bytes: stat.size, digest: await hashFile(target) };
  let files = 0;
  let bytes = 0;
  const digest = crypto.createHash('sha256');
  const entries = (await fsp.readdir(target, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  for (const entry of entries) {
    const summary = await pathSummary(path.join(target, entry.name));
    files += summary.files;
    bytes += summary.bytes;
    digest.update(entry.name, 'utf8');
    digest.update(entry.isDirectory() ? 'directory' : 'file');
    digest.update(summary.digest);
  }
  return { files, bytes, digest: digest.digest('hex') };
}

async function movePath(source, target, dependencies = {}) {
  const rename = dependencies.rename || fsp.rename;
  const copy = dependencies.copy || fsp.cp;
  const remove = dependencies.remove || fsp.rm;
  const trash = dependencies.trash;
  const recoveryJournal = dependencies.recoveryJournal;
  try {
    await rename(source, target);
    return { crossDevice: false };
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
  }

  const nonce = `${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
  const temporary = `${target}.desktop-workspace-${nonce}.partial`;
  const holding = path.join(path.dirname(source), `.desktop-workspace-${nonce}-${path.basename(source)}.moving`);
  const sealed = `${holding}.sealed`;
  let recoveryPath = holding;
  let sourceHeld = false;
  let targetCommitted = false;
  try {
    await recoveryJournal?.update({ stage: 'prepared', source, target, temporary, holding, sealed });
    await rename(source, holding);
    sourceHeld = true;
    await recoveryJournal?.update({ stage: 'held', recoveryPath: holding });
    const beforeCopy = await pathSummary(holding);
    await copy(holding, temporary, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
    const [afterCopy, copiedSummary] = await Promise.all([pathSummary(holding), pathSummary(temporary)]);
    if (beforeCopy.files !== afterCopy.files || beforeCopy.bytes !== afterCopy.bytes || beforeCopy.digest !== afterCopy.digest) throw new Error('跨盘复制期间源项目发生变化，已取消移动');
    if (afterCopy.files !== copiedSummary.files || afterCopy.bytes !== copiedSummary.bytes || afterCopy.digest !== copiedSummary.digest) throw new Error('跨盘复制 SHA-256 校验失败');
    await recoveryJournal?.update({ stage: 'copied', sourceSummary: afterCopy });
    await rename(temporary, target);
    targetCommitted = true;
    await recoveryJournal?.update({ stage: 'committed' });
    if (fs.existsSync(source)) {
      const error = new Error('跨盘复制期间原位置出现了新项目；目标副本和原内容均已保留，请人工确认');
      error.code = 'SOURCE_RECREATED';
      error.targetPreserved = true;
      throw error;
    }
    await rename(holding, sealed);
    recoveryPath = sealed;
    await recoveryJournal?.update({ stage: 'sealed', recoveryPath: sealed });
    const [sealedSummary, committedSummary] = await Promise.all([pathSummary(sealed), pathSummary(target)]);
    if (sealedSummary.files !== committedSummary.files || sealedSummary.bytes !== committedSummary.bytes || sealedSummary.digest !== committedSummary.digest) {
      const error = new Error('目标提交后源内容再次发生变化；目标副本和变化后的源内容均已保留');
      error.code = 'SOURCE_CHANGED_AFTER_COMMIT';
      error.targetPreserved = true;
      throw error;
    }
    try {
      if (!trash) {
        await recoveryJournal?.update({ stage: 'retained', recoveryPath: sealed });
        return { crossDevice: true, sourceRecovery: 'retained', recoveryPath: sealed };
      }
      await trash(sealed);
    } catch (removeError) {
      let restoredSource = false;
      try {
        if (!fs.existsSync(source)) {
          await copy(target, source, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
          const [targetSummary, restoredSummary] = await Promise.all([pathSummary(target), pathSummary(source)]);
          restoredSource = targetSummary.files === restoredSummary.files && targetSummary.bytes === restoredSummary.bytes && targetSummary.digest === restoredSummary.digest;
          if (!restoredSource) throw new Error('源项目恢复校验失败');
        }
      } catch {
        try {
          if (fs.existsSync(recoveryPath) && !fs.existsSync(source)) {
            await rename(recoveryPath, source);
            restoredSource = true;
          }
        } catch {}
      }
      const error = new Error(`跨盘复制已完整保留在目标位置，但源项目清理失败${restoredSource ? '，剩余源内容已恢复原名' : ''}：${removeError.message}`);
      error.code = 'SOURCE_CLEANUP_FAILED';
      error.targetPreserved = true;
      throw error;
    }
    await recoveryJournal?.clear().catch(() => {});
    return { crossDevice: true, sourceRecovery: 'recycle-bin' };
  } catch (error) {
    try { await remove(temporary, { recursive: true, force: true }); } catch {}
    if (sourceHeld && !targetCommitted) {
      try { if (fs.existsSync(recoveryPath) && !fs.existsSync(source)) await rename(recoveryPath, source); } catch {}
    }
    if (sourceHeld && targetCommitted) {
      try { if (fs.existsSync(recoveryPath) && !fs.existsSync(source)) await rename(recoveryPath, source); } catch {}
    }
    await recoveryJournal?.update({ stage: 'failed', recoveryPath, sourceHeld, targetCommitted, error: error.message || String(error) }).catch(() => {});
    throw error;
  }
}

async function executeOperations(operations, dependencies = {}) {
  const completed = [];
  const failed = [];
  for (const operation of operations) {
    try {
      const stat = await fsp.lstat(operation.source);
      await assertNoLinkSegments(operation.source);
      await assertNoLinkSegments(require('node:path').dirname(operation.target));
      if (operation.sourceIdentity) {
        const identity = operation.sourceIdentity;
        if (Number.isFinite(identity.size) && stat.size !== identity.size) throw new Error('源项目在预览后已发生变化，请重新预览');
        if (Number.isFinite(identity.mtimeMs) && Math.abs(stat.mtimeMs - identity.mtimeMs) > 1) throw new Error('源项目在预览后已发生变化，请重新预览');
        if (Number.isFinite(identity.ino) && identity.ino > 0 && stat.ino !== identity.ino) throw new Error('源项目已被替换，请重新预览');
        if (Number.isFinite(identity.dev) && stat.dev !== identity.dev) throw new Error('源项目所在卷已发生变化，请重新预览');
      }
      if (stat.isSymbolicLink()) throw new Error('符号链接不允许移动');
      if (fs.existsSync(operation.target)) throw new Error('目标位置已存在同名项目');
      const recoveryJournal = dependencies.createRecoveryJournal?.(operation);
      const result = await movePath(operation.source, operation.target, { ...dependencies, recoveryJournal });
      completed.push({ ...operation, crossDevice: result.crossDevice, sourceRecovery: result.sourceRecovery, recoveryPath: result.recoveryPath });
    } catch (error) {
      failed.push({ ...operation, reason: error.message });
    }
  }
  return { completed, failed };
}

async function restoreOperations(operations, { personalRoot, archiveRoot, archiveRoots = [], trash }) {
  const restored = [];
  const failed = [];
  for (const operation of [...operations].reverse()) {
    try {
      if (!fs.existsSync(operation.target)) throw new Error('归档后的文件已不存在');
      if (!isDirectChild(operation.source, personalRoot)) throw new Error('原路径不在个人桌面第一层');
      await assertNoLinkSegments(operation.target);
      const allowedRoots = [...new Set([archiveRoot, ...archiveRoots].filter(Boolean))];
      if (!allowedRoots.some((root) => isWithin(operation.target, root))) throw new Error('归档路径已超出允许范围');
      const realTarget = await fsp.realpath(operation.target);
      const realRoots = await Promise.all(allowedRoots.map((root) => fsp.realpath(root)));
      if (!realRoots.some((root) => isWithin(realTarget, root) || normalized(require('node:path').dirname(realTarget)) === normalized(root))) throw new Error('归档项目解析到了允许目录之外');
      const restoreTarget = uniquePath(operation.source, fs.existsSync);
      const result = await movePath(operation.target, restoreTarget, { trash });
      restored.push({ ...operation, restoredTo: restoreTarget, renamed: restoreTarget !== operation.source, crossDevice: result.crossDevice });
    } catch (error) {
      failed.push({ ...operation, reason: error.message });
    }
  }
  return { restored, failed };
}

module.exports = { executeOperations, restoreOperations, movePath, pathSummary };
