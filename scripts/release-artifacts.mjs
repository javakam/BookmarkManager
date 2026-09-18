import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(
  await (await import('node:fs/promises')).readFile(
    resolve(rootDir, 'package.json'),
    'utf8',
  ),
);
const version = packageJson.version;
const releaseDir = resolve(rootDir, 'release');
const outputDir = resolve(rootDir, '.output');

function run(script) {
  const isWindows = process.platform === 'win32';
  const command = isWindows ? process.env.ComSpec ?? 'cmd.exe' : 'npm';
  const args = isWindows
    ? ['/d', '/s', '/c', `npm run ${script}`]
    : ['run', script];
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${script} 执行失败，退出码：${result.status ?? '未知'}`);
  }
}

run('zip');
run('zip:edge');
run('pack:crx');

mkdirSync(releaseDir, { recursive: true });
const currentArtifacts = new Set([
  `bookmark-manager-v${version}.zip`,
  `bookmark-manager-v${version}-edge.zip`,
  `bookmark-manager-v${version}.crx`,
]);
for (const name of readdirSync(releaseDir)) {
  if (
    /^bookmark-manager-v\d+\.\d+\.\d+(?:-edge)?\.(?:zip|crx)$/.test(name) &&
    !currentArtifacts.has(name)
  ) {
    rmSync(resolve(releaseDir, name), { force: true });
  }
}

const artifacts = [
  [
    resolve(outputDir, `bookmark-manager-extension-${version}-chrome.zip`),
    resolve(releaseDir, `bookmark-manager-v${version}.zip`),
  ],
  [
    resolve(outputDir, `bookmark-manager-extension-${version}-edge.zip`),
    resolve(releaseDir, `bookmark-manager-v${version}-edge.zip`),
  ],
  [
    resolve(releaseDir, `bookmark-manager-v${version}.crx`),
    resolve(releaseDir, `bookmark-manager-v${version}.crx`),
  ],
];

for (const [source, destination] of artifacts) {
  if (!existsSync(source)) {
    throw new Error(`缺少发布产物：${source}`);
  }
  if (source !== destination) {
    copyFileSync(source, destination);
  }
}

console.log(`已整理 v${version} 发布产物到 ${releaseDir}`);
