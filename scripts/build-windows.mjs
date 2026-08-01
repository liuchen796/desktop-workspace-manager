import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createPackage } = require('@electron/asar');
const { editWindowsResources } = require('app-builder-lib/out/util/resEdit');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const outputDir = path.join(root, 'release');
const appDir = path.join(outputDir, 'win-unpacked');
const stageDir = path.join(outputDir, '.asar-stage');
const electronDist = path.join(root, 'node_modules', 'electron', 'dist');
const runtimePackages = ['csv-parse', 'extract-zip', 'debug', 'ms', 'get-stream', 'pump', 'end-of-stream', 'once', 'wrappy', 'yauzl', 'fd-slicer', 'pend', 'buffer-crc32'];

const assertGeneratedPath = (target) => {
  const relative = path.relative(root, path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`拒绝操作项目外路径：${target}`);
};

for (const target of [outputDir, appDir, stageDir]) assertGeneratedPath(target);

await fs.mkdir(outputDir, { recursive: true });
for (const entry of await fs.readdir(outputDir, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  if (/^DesktopWorkspace-(Setup|Portable)-.+-x64\.exe(?:\.blockmap)?$/i.test(entry.name) || /^builder-(debug\.yml|effective-config\.yaml)$/i.test(entry.name)) {
    await fs.rm(path.join(outputDir, entry.name), { force: true });
  }
}
await fs.rm(appDir, { recursive: true, force: true });
await fs.rm(stageDir, { recursive: true, force: true });
await fs.cp(electronDist, appDir, { recursive: true });
await fs.mkdir(stageDir, { recursive: true });

for (const directory of ['dist', 'electron', 'shared']) {
  await fs.cp(path.join(root, directory), path.join(stageDir, directory), { recursive: true });
}
for (const packageName of runtimePackages) {
  await fs.cp(path.join(root, 'node_modules', packageName), path.join(stageDir, 'node_modules', packageName), { recursive: true });
}
await fs.copyFile(path.join(root, 'package.json'), path.join(stageDir, 'package.json'));

const executable = path.join(appDir, `${packageJson.build.productName}.exe`);
await fs.rename(path.join(appDir, 'electron.exe'), executable);
await fs.rm(path.join(appDir, 'resources', 'default_app.asar'), { force: true });
await createPackage(stageDir, path.join(appDir, 'resources', 'app.asar'));

await editWindowsResources({
  file: executable,
  versionStrings: {
    CompanyName: packageJson.author,
    FileDescription: packageJson.build.productName,
    ProductName: packageJson.build.productName,
    InternalName: packageJson.build.productName,
    OriginalFilename: `${packageJson.build.productName}.exe`,
    ProductVersion: packageJson.version,
  },
  fileVersion: packageJson.version,
  productVersion: `${packageJson.version}.0`,
  iconPath: path.join(root, packageJson.build.win.icon),
  requestedExecutionLevel: 'asInvoker',
});

await fs.rm(stageDir, { recursive: true, force: true });

const builderCli = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [builderCli, '--prepackaged', appDir, '--win', 'nsis', 'portable'], {
    cwd: root,
    stdio: 'inherit',
  });
  child.once('error', reject);
  child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`electron-builder 退出码：${code}`)));
});

for (const entry of await fs.readdir(outputDir, { withFileTypes: true })) {
  if (entry.isFile() && (/\.blockmap$/i.test(entry.name) || /^builder-(debug\.yml|effective-config\.yaml)$/i.test(entry.name))) {
    await fs.rm(path.join(outputDir, entry.name), { force: true });
  }
}
