const path = require('node:path');
const fsp = require('node:fs/promises');

function normalized(value) {
  return path.resolve(value).replace(/[\\/]+$/, '').toLocaleLowerCase('zh-CN');
}

function isDirectChild(filePath, rootPath) {
  return normalized(path.dirname(path.resolve(filePath))) === normalized(rootPath);
}

function isWithin(filePath, rootPath) {
  const candidate = normalized(filePath);
  const root = normalized(rootPath);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

async function assertNoLinkSegments(filePath) {
  const absolute = path.resolve(filePath);
  const parsed = path.parse(absolute);
  const relativeParts = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const part of relativeParts) {
    current = path.join(current, part);
    try {
      const stat = await fsp.lstat(current);
      if (stat.isSymbolicLink()) throw new Error(`路径包含符号链接或目录联接：${current}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return absolute;
}

async function assertRealPath(filePath, expectedPath = filePath) {
  await assertNoLinkSegments(filePath);
  const real = await fsp.realpath(filePath);
  if (normalized(real) !== normalized(expectedPath)) throw new Error('路径解析结果与已确认位置不一致');
  return real;
}

module.exports = { normalized, isDirectChild, isWithin, assertNoLinkSegments, assertRealPath };
