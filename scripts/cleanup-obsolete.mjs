import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = path.join(root, 'release');
const artifacts = path.join(root, 'artifacts');
const obsoleteDirectories = [
  path.join(root, 'release-1.2.0'),
  path.join(root, '测试安装'),
  path.join(root, 'node_modules', '.vite'),
];
const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const currentVersion = packageJson.version;

function assertWithinWorkspace(target) {
  const resolved = path.resolve(target);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`拒绝清理项目外路径：${resolved}`);
  return resolved;
}

async function fileSize(file) {
  try { return (await fs.stat(file)).size; } catch { return 0; }
}

async function directorySize(directory) {
  let total = 0;
  try {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      total += entry.isDirectory() ? await directorySize(target) : await fileSize(target);
    }
  } catch {}
  return total;
}

assertWithinWorkspace(release);
assertWithinWorkspace(artifacts);
let removedFiles = 0;
let removedDirectories = 0;
let releasedBytes = 0;

for (const entry of await fs.readdir(release, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const isVersionedBuild = /^DesktopWorkspace-(Setup|Portable)-.+-x64\.exe(?:\.blockmap)?$/i.test(entry.name);
  const isCurrentExecutable = new RegExp(`-${currentVersion.replaceAll('.', '\\.')}\\-x64\\.exe$`, 'i').test(entry.name);
  const isBuildMetadata = /\.blockmap$/i.test(entry.name) || /^builder-(debug\.yml|effective-config\.yaml)$/i.test(entry.name);
  if ((!isVersionedBuild || isCurrentExecutable) && !isBuildMetadata) continue;
  const target = assertWithinWorkspace(path.join(release, entry.name));
  releasedBytes += await fileSize(target);
  await fs.rm(target, { force: true });
  removedFiles += 1;
}

try {
  const artifactFiles = await fs.readdir(artifacts, { recursive: true, withFileTypes: true });
  for (const entry of artifactFiles) if (entry.isFile()) releasedBytes += await fileSize(path.join(entry.parentPath, entry.name));
} catch {}
await fs.rm(artifacts, { recursive: true, force: true });

for (const directory of obsoleteDirectories) {
  const target = assertWithinWorkspace(directory);
  releasedBytes += await directorySize(target);
  try {
    await fs.rm(target, { recursive: true, force: true });
    removedDirectories += 1;
  } catch {}
}

console.log(JSON.stringify({ removedFiles, removedDirectories, releasedBytes }));
