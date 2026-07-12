import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test('构建产物包含 MV3 Manifest 和管理器入口', () => {
  const manifestPath = resolve('.output/chrome-mv3/manifest.json');
  const managerPath = resolve('.output/chrome-mv3/manager.html');

  expect(existsSync(manifestPath)).toBe(true);
  expect(existsSync(managerPath)).toBe(true);

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    manifest_version?: number;
  };
  const managerHtml = readFileSync(managerPath, 'utf8');

  expect(manifest.manifest_version).toBe(3);
  expect(managerHtml).toContain('id="root"');
});
