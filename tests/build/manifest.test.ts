import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type BuiltManifest = {
  manifest_version?: number;
  name?: string;
  description?: string;
  version?: string;
  permissions?: string[];
  optional_host_permissions?: string[];
  action?: {
    default_title?: string;
  };
};

describe('Chrome MV3 构建产物', () => {
  it('生成管理器版 Manifest 且不接管新标签页', () => {
    const manifestPath = resolve('.output/chrome-mv3/manifest.json');

    expect(
      existsSync(manifestPath),
      '构建产物不存在，请先运行 npm run build',
    ).toBe(true);

    const manifest = JSON.parse(
      readFileSync(manifestPath, 'utf8'),
    ) as BuiltManifest;

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe('书签工作台');
    expect(manifest.description).toBe('本地优先的浏览器原生书签管理器');
    expect(manifest.version).toBe('1.0.1');
    expect(manifest.permissions).toEqual([
      'bookmarks',
      'storage',
      'activeTab',
      'favicon',
    ]);
    expect(manifest.optional_host_permissions).toEqual([
      'http://*/*',
      'https://*/*',
    ]);
    expect(manifest.action?.default_title).toBe('打开书签工作台');
    expect(manifest).not.toHaveProperty('chrome_url_overrides');
  });

  it('在 background 中注册扩展安装监听', () => {
    const backgroundPath = resolve('.output/chrome-mv3/background.js');

    expect(
      existsSync(backgroundPath),
      'background 构建产物不存在，请先运行 npm run build',
    ).toBe(true);

    expect(readFileSync(backgroundPath, 'utf8')).toContain(
      'onInstalled.addListener',
    );
  });
});
