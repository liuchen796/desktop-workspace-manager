const path = require('node:path');

async function mapWithConcurrency(entries, limit, mapper) {
  const results = new Array(entries.length);
  let cursor = 0;
  async function worker() {
    while (cursor < entries.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(entries[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, entries.length) }, worker));
  return results;
}

function createScannerService({ app, fs, publicDirectory = process.env.PUBLIC }) {
  let watchers = [];
  let watcherTimer = null;

  function roots() {
    const result = [{ scope: 'personal', path: app.getPath('desktop') }];
    const publicRoot = publicDirectory ? path.join(publicDirectory, 'Desktop') : null;
    if (publicRoot && fs.existsSync(publicRoot)) result.push({ scope: 'public', path: publicRoot });
    return result;
  }

  function startWatchers(onChange, delay = 650) {
    stopWatchers();
    watchers = roots().map((root) => {
      try {
        return fs.watch(root.path, () => {
          clearTimeout(watcherTimer);
          watcherTimer = setTimeout(onChange, delay);
        });
      } catch {
        return null;
      }
    }).filter(Boolean);
  }

  function stopWatchers() {
    clearTimeout(watcherTimer);
    watcherTimer = null;
    watchers.forEach((watcher) => watcher.close());
    watchers = [];
  }

  return { roots, startWatchers, stopWatchers };
}

module.exports = { createScannerService, mapWithConcurrency };
