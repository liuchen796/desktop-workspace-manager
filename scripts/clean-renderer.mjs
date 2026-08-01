import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const relative = path.relative(root, dist);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`拒绝清理项目外目录：${dist}`);
await fs.rm(dist, { recursive: true, force: true });
