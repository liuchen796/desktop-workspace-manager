const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function fileStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

async function writeJsonAtomic(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
  await fsp.rename(temporary, file);
}

async function preserveFile(file, suffix) {
  const extension = path.extname(file) || '.json';
  const destination = path.join(path.dirname(file), `${path.basename(file, extension)}.${suffix}-${fileStamp()}${extension}`);
  await fsp.rename(file, destination);
  return destination;
}

async function loadJsonWithRecovery(file, fallback, options = {}) {
  const normalize = options.normalize || ((value) => value);
  let text;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { value: normalize(fallback), status: 'missing', preservedPath: null };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const preservedPath = await preserveFile(file, 'corrupt');
    const value = normalize(fallback);
    await writeJsonAtomic(file, value);
    return { value, status: 'corrupt', preservedPath };
  }

  if (Number.isFinite(options.currentVersion) && Number(parsed?.version) > options.currentVersion) {
    const preservedPath = await preserveFile(file, `unsupported-v${parsed.version}`);
    const value = normalize(fallback);
    await writeJsonAtomic(file, value);
    return { value, status: 'unsupported', preservedPath };
  }

  const value = normalize(parsed);
  if (JSON.stringify(value) !== JSON.stringify(parsed)) {
    const preservedPath = await preserveFile(file, `before-migration-v${Number(parsed?.version) || 0}`);
    await writeJsonAtomic(file, value);
    return { value, status: 'migrated', preservedPath };
  }
  return { value, status: 'ok', preservedPath: null };
}

async function createRotatingBackup(file, backupDirectory, maxFiles = 5) {
  try {
    await fsp.access(file);
  } catch {
    return null;
  }
  await fsp.mkdir(backupDirectory, { recursive: true });
  const destination = path.join(backupDirectory, `settings-${fileStamp()}.json`);
  await fsp.copyFile(file, destination);
  const backups = (await fsp.readdir(backupDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^settings-.*\.json$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  await Promise.all(backups.slice(maxFiles).map((name) => fsp.rm(path.join(backupDirectory, name), { force: true })));
  return destination;
}

module.exports = { fileStamp, writeJsonAtomic, loadJsonWithRecovery, createRotatingBackup };
