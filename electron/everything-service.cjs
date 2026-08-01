const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const extractZip = require('extract-zip');
const { parseEverythingCsv, validateEverythingQuery } = require('../shared/everything.cjs');
const { mapWithConcurrency } = require('./scanner-service.cjs');

const CONNECTOR_URL = 'https://www.voidtools.com/ES-1.1.0.30.x64.zip';

function createEverythingService({ app, net, getSettings, saveSettings, resolveIcon }) {
  const searchResults = new Map();
  const connectorDirectory = () => path.join(app.getPath('userData'), 'everything-connector');
  const managedConnectorPath = () => path.join(connectorDirectory(), 'es.exe');

  function execFileText(file, args, options = {}) {
    return new Promise((resolve, reject) => {
      execFile(file, args, { windowsHide: true, encoding: 'utf8', timeout: 8000, maxBuffer: 8 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
        if (error) { error.stdout = stdout; error.stderr = stderr; reject(error); return; }
        resolve(String(stdout || ''));
      });
    });
  }

  async function findInstallation(configuredPath = '') {
    const candidates = [configuredPath, (process.env.ProgramFiles || process.env.PROGRAMFILES) && path.join(process.env.ProgramFiles || process.env.PROGRAMFILES, 'Everything'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Everything'), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Everything')].filter(Boolean);
    for (const candidate of [...new Set(candidates.map((value) => path.resolve(value)))]) {
      try {
        const real = await fsp.realpath(candidate);
        if ((await fsp.stat(real)).isDirectory() && fs.existsSync(path.join(real, 'Everything.exe'))) return real;
      } catch {}
    }
    return '';
  }

  async function getStatus() {
    const settings = await getSettings();
    const effectivePath = await findInstallation(settings.everythingPath);
    const localConnector = effectivePath ? path.join(effectivePath, 'es.exe') : '';
    const managedConnector = managedConnectorPath();
    const connectorPath = localConnector && fs.existsSync(localConnector) ? localConnector : (fs.existsSync(managedConnector) ? managedConnector : '');
    let version = '';
    let everythingVersion = '';
    let running = false;
    if (connectorPath) {
      try { version = (await execFileText(connectorPath, ['-version'], { timeout: 3000 })).trim(); } catch {}
      try { everythingVersion = (await execFileText(connectorPath, ['-get-everything-version'], { timeout: 3000 })).trim(); running = Boolean(everythingVersion); } catch {}
    }
    return { configuredPath: settings.everythingPath, effectivePath, suggestedPath: !settings.everythingPath ? effectivePath : '', everythingExists: Boolean(effectivePath), connectorExists: Boolean(connectorPath), connectorPath, version, everythingVersion, running, ready: Boolean(effectivePath && connectorPath) };
  }

  async function findFileRecursive(root, fileName) {
    const entries = await fsp.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = path.join(root, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) return candidate;
      if (entry.isDirectory()) { const nested = await findFileRecursive(candidate, fileName); if (nested) return nested; }
    }
    return '';
  }

  async function installConnector() {
    const status = await getStatus();
    if (!status.everythingExists) throw new Error('请先选择包含 Everything.exe 的安装目录');
    const settings = await getSettings();
    if (!settings.everythingPath) { settings.everythingPath = status.effectivePath; await saveSettings(settings); }
    const directory = connectorDirectory();
    const zipPath = path.join(directory, 'connector-download.zip');
    const extractDirectory = path.join(directory, 'extracting');
    await fsp.mkdir(directory, { recursive: true });
    await fsp.rm(extractDirectory, { recursive: true, force: true });
    try {
      const response = await net.fetch(CONNECTOR_URL, { redirect: 'follow' });
      if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）`);
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length < 10_000 || data.length > 2 * 1024 * 1024) throw new Error('连接器文件大小异常');
      await fsp.writeFile(zipPath, data, { flag: 'w' });
      await fsp.mkdir(extractDirectory, { recursive: true });
      await extractZip(zipPath, { dir: extractDirectory });
      const extracted = await findFileRecursive(extractDirectory, 'es.exe');
      if (!extracted) throw new Error('下载包中未找到 es.exe');
      const stats = await fsp.stat(extracted);
      if (!stats.isFile() || stats.size < 10_000 || stats.size > 2 * 1024 * 1024) throw new Error('连接器程序无效');
      await fsp.copyFile(extracted, managedConnectorPath());
    } finally {
      await fsp.rm(zipPath, { force: true }).catch(() => {});
      await fsp.rm(extractDirectory, { recursive: true, force: true }).catch(() => {});
    }
    return getStatus();
  }

  async function search(queryValue, limitValue) {
    const query = validateEverythingQuery(queryValue);
    if (!query) return { results: [], elapsedMs: 0 };
    const limit = [50, 100, 200].includes(limitValue) ? limitValue : 100;
    const status = await getStatus();
    if (!status.everythingExists) throw new Error('尚未连接 Everything，请先选择安装目录');
    if (!status.connectorExists) throw new Error('搜索连接器尚未安装');
    const startedAt = Date.now();
    const outputDirectory = path.join(app.getPath('userData'), 'everything-search');
    const outputPath = path.join(outputDirectory, `${crypto.randomUUID()}.csv`);
    let output = '';
    try {
      await fsp.mkdir(outputDirectory, { recursive: true });
      await execFileText(status.connectorPath, ['-no-header', '-utf8-bom', '-name', '-path-column', '-extension', '-size', '-date-modified', '-attributes', '-date-format', '1', '-size-format', '1', '-n', String(limit), '-timeout', '5000', query, '-export-csv', outputPath], { timeout: 20000 });
      output = await fsp.readFile(outputPath, 'utf8');
    } catch (error) {
      if (error.code === 8) throw new Error('Everything 尚未运行，请先启动 Everything');
      throw new Error(String(error.stderr || error.message || 'Everything 搜索失败').trim());
    } finally { await fsp.rm(outputPath, { force: true }).catch(() => {}); }
    const parsed = parseEverythingCsv(output).slice(0, limit);
    const results = await mapWithConcurrency(parsed, 10, async (result) => {
      let icon = '';
      if (!result.isDirectory) {
        try { const stats = await fsp.stat(result.path); icon = await resolveIcon(result.path, null, `everything-icon-v1|${stats.mtimeMs}|${stats.size}`); } catch {}
      }
      return { ...result, icon };
    });
    searchResults.clear();
    for (const result of results) searchResults.set(result.id, result.path);
    return { results, elapsedMs: Date.now() - startedAt };
  }

  async function start() {
    const status = await getStatus();
    if (!status.everythingExists) throw new Error('请先选择 Everything 安装目录');
    const child = spawn(path.join(status.effectivePath, 'Everything.exe'), ['-startup'], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    await new Promise((resolve) => setTimeout(resolve, 700));
    return getStatus();
  }

  return { getStatus, findInstallation, installConnector, search, start, resultPath: (id) => searchResults.get(id) || '' };
}

module.exports = { createEverythingService, CONNECTOR_URL };
