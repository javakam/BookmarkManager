import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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
const extensionDir = resolve(rootDir, '.output', 'chrome-mv3');
const signingKeyPath = resolve(
  rootDir,
  '.signing',
  'bookmark-manager.pem',
);
const releaseDir = resolve(rootDir, 'release');
const crxPath = `${extensionDir}.crx`;
const releasePath = resolve(
  releaseDir,
  `bookmark-manager-v${version}.crx`,
);

const chromeCandidates = [
  process.env.BOOKMARK_MANAGER_CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  join(homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean);
const chromePath = chromeCandidates.find((candidate) => existsSync(candidate));

if (!existsSync(extensionDir)) {
  throw new Error('找不到 .output/chrome-mv3，请先运行 npm run build');
}
const builtManifest = JSON.parse(
  readFileSync(resolve(extensionDir, 'manifest.json'), 'utf8'),
);
if (builtManifest.version !== version) {
  throw new Error(
    `Chrome 构建版本为 ${builtManifest.version}，当前项目版本为 ${version}，请先重新构建`,
  );
}
if (!existsSync(signingKeyPath)) {
  throw new Error('找不到 Chrome CRX 签名配置');
}
if (!chromePath) {
  throw new Error('找不到 Google Chrome，请设置 BOOKMARK_MANAGER_CHROME_PATH');
}

mkdirSync(releaseDir, { recursive: true });
rmSync(crxPath, { force: true });

const profileDir = resolve(
  tmpdir(),
  `bookmark-manager-crx-${process.pid}-${Date.now()}`,
);
mkdirSync(profileDir, { recursive: true });

try {
  const result = spawnSync(
    chromePath,
    [
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profileDir}`,
      `--pack-extension=${extensionDir}`,
      `--pack-extension-key=${signingKeyPath}`,
    ],
    {
      stdio: 'inherit',
      windowsHide: true,
    },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Chrome CRX 打包失败，退出码：${result.status ?? '未知'}`);
  }
  if (!existsSync(crxPath)) {
    throw new Error('Chrome 未生成 CRX 文件');
  }

  const { copyFileSync } = await import('node:fs');
  copyFileSync(crxPath, releasePath);
  console.log(`已生成 ${releasePath}`);
} finally {
  rmSync(profileDir, { recursive: true, force: true });
}
