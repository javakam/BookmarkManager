import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

interface IsolatedExtension {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly profile: string;
  readonly folderId: string;
  readonly folderTitle: string;
  readonly longUrl: string;
}

async function launchIsolatedExtension(): Promise<IsolatedExtension> {
  const extensionPath = resolve('.output/chrome-mv3');
  const profile = mkdtempSync(join(tmpdir(), 'bookmark-manager-e2e-'));
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker', {
      timeout: 20_000,
    });
  }
  const extensionId = new URL(serviceWorker.url()).host;
  const page = await context.newPage();
  const folderTitle = `v1.0.5 E2E ${Date.now()}`;
  const longUrl =
    'https://native.example.test/a/very/long/path/that/must/remain/visible?alpha=123456789&beta=中文参数#section-with-a-long-fragment';
  // Bookmark APIs are only exposed to extension contexts. Create test data in
  // the loaded MV3 service worker before navigating the UI page.
  const created = await serviceWorker.evaluate(async ({ folderTitle, longUrl }) => {
    const api = (globalThis as typeof globalThis & { chrome: any }).chrome;
    const roots = await api.bookmarks.getTree();
    const bookmarkBar = roots[0]?.children?.find(
      (node: { folderType?: string }) => node.folderType === 'bookmarks-bar',
    );
    if (!bookmarkBar) {
      throw new Error('隔离配置中没有书签栏');
    }
    const folder = await api.bookmarks.create({
      parentId: bookmarkBar.id,
      title: folderTitle,
    });
    const bookmark = await api.bookmarks.create({
      parentId: folder.id,
      title: '长网址书签',
      url: longUrl,
    });
    await api.bookmarks.create({
      parentId: folder.id,
      title: '',
      url: 'https://native.example.test/icon-only',
    });
    return { folderId: folder.id as string, longUrl: bookmark.url ?? longUrl };
  }, { folderTitle, longUrl });
  await page.goto(`chrome-extension://${extensionId}/manager.html`);
  await expect(page.getByRole('heading', { name: '书签栏' })).toBeVisible();
  return { context, page, profile, folderId: created.folderId, folderTitle, longUrl: created.longUrl };
}

async function removeIsolatedFolder(page: Page, folderId: string) {
  await page.evaluate(async (id) => {
    const api = (globalThis as typeof globalThis & { chrome: any }).chrome;
    try {
      await api.bookmarks.removeTree(id);
    } catch {
      // The UI deletion flow may already have removed the temporary folder.
    }
  }, folderId);
}

async function setPageZoom(page: Page, zoomFactor: number) {
  await page.evaluate(async (factor) => {
    const api = (globalThis as typeof globalThis & { chrome: any }).chrome;
    const tab = await api.tabs.getCurrent();
    if (tab?.id === undefined) {
      throw new Error('无法取得隔离扩展页签');
    }
    await api.tabs.setZoom(tab.id, factor);
  }, zoomFactor);
}

test.describe('真实 Chromium 扩展回归', () => {
  test('重复打开弹窗时复用已有工作台页签', async () => {
    const isolated = await launchIsolatedExtension();
    const managerLocation = new URL(isolated.page.url());
    const extensionOrigin = `${managerLocation.protocol}//${managerLocation.host}`;
    const managerUrl = isolated.page.url();
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const popup = await isolated.context.newPage();
        await popup.goto(`${extensionOrigin}/popup.html`);
        await popup.getByRole('button', { name: '打开书签工作台' }).click();
        await expect
          .poll(
            () =>
              isolated.context
                .pages()
                .filter((page) => page.url() === managerUrl).length,
          )
          .toBe(1);
        if (!popup.isClosed()) {
          await popup.close();
        }
      }
    } finally {
      await removeIsolatedFolder(isolated.page, isolated.folderId);
      await isolated.context.close();
      rmSync(isolated.profile, { recursive: true, force: true });
    }
  });

  test('读取原生书签并完成搜索、定位返回、编辑和永久删除', async () => {
    const isolated = await launchIsolatedExtension();
    const consoleErrors: string[] = [];
    isolated.page.on('pageerror', (error) => consoleErrors.push(error.message));
    isolated.page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });

    try {
      await expect(
        isolated.page.getByText('v1.0.5', { exact: true }),
      ).toBeVisible();
      await expect(
        isolated.page.getByRole('button', { name: '折叠 书签栏' }),
      ).toHaveAttribute('aria-expanded', 'true');

      await isolated.page
        .getByRole('button', { name: isolated.folderTitle, exact: true })
        .click();
      await expect(isolated.page.getByText(isolated.longUrl, { exact: true })).toBeVisible();

      await isolated.page.getByRole('button', { name: '编辑 长网址书签' }).click();
      const editor = isolated.page.getByRole('dialog', { name: '编辑书签' });
      await expect(editor.getByRole('textbox', { name: '网址' })).toHaveValue(
        isolated.longUrl,
      );
      await editor.getByRole('button', { name: '预览' }).click();
      await isolated.page.getByRole('button', { name: '确认保存' }).click();
      await expect(isolated.page.getByRole('status', { name: '操作提示' })).toBeVisible();

      const externalTitle = '外部新增书签';
      await isolated.page.evaluate(async ({ folderId, externalTitle }) => {
        const api = (globalThis as typeof globalThis & { chrome: any }).chrome;
        await api.bookmarks.create({
          parentId: folderId,
          title: externalTitle,
          url: 'https://native.example.test/external',
        });
      }, { folderId: isolated.folderId, externalTitle });
      await expect(isolated.page.getByText(externalTitle)).toBeVisible();

      const search = isolated.page.getByRole('searchbox', { name: '搜索书签' });
      await search.fill('外部新增书签');
      await expect(isolated.page.getByRole('button', { name: '定位 外部新增书签' })).toBeVisible();
      await isolated.page.getByRole('button', { name: '定位 外部新增书签' }).click();
      await expect(isolated.page.getByRole('button', { name: '返回搜索结果' })).toBeVisible();
      await isolated.page.getByRole('button', { name: '返回搜索结果' }).click();
      await expect(search).toHaveValue('外部新增书签');

      const resultRow = isolated.page
        .getByText('外部新增书签', { exact: true })
        .first();
      await resultRow.click({ button: 'right' });
      await expect(isolated.page.getByRole('menu')).toBeVisible();
      await isolated.page.getByRole('menu').press('Escape');
      await expect(isolated.page.getByRole('menu')).toHaveCount(0);
      await expect(search).toHaveValue('外部新增书签');

      await isolated.page.getByRole('button', { name: '清空搜索' }).click();
      await isolated.page.getByRole('button', { name: '返回 书签栏' }).click();
      await isolated.page.getByRole('button', { name: `删除 ${isolated.folderTitle}` }).click();
      await expect(isolated.page.getByRole('dialog', { name: '确认删除' })).toBeVisible();
      await expect(isolated.page.getByText('删除后无法恢复')).toBeVisible();
      await isolated.page.getByRole('button', { name: '确认删除' }).click();
      await expect(isolated.page.getByText(isolated.folderTitle)).toHaveCount(0);

      expect(consoleErrors).toEqual([]);
    } finally {
      await removeIsolatedFolder(isolated.page, isolated.folderId);
      await isolated.context.close();
      rmSync(isolated.profile, { recursive: true, force: true });
    }
  });

  test('主题持久化且指定视口没有横向溢出', async () => {
    const isolated = await launchIsolatedExtension();
    try {
      const sizes = [
        [1280, 720],
        [1366, 768],
        [1440, 900],
        [1920, 1080],
      ] as const;
      await isolated.page
        .getByRole('button', { name: isolated.folderTitle, exact: true })
        .click();
      const longUrl = isolated.page.getByText(isolated.longUrl, { exact: true });
      for (const zoomFactor of [1, 1.25, 1.5]) {
        await setPageZoom(isolated.page, zoomFactor);
        for (const [width, height] of sizes) {
          await isolated.page.setViewportSize({ width, height });
          await expect(longUrl).toBeVisible();
          const overflow = await isolated.page.evaluate(() => ({
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: document.documentElement.clientWidth,
            mainWidth: document.querySelector('.app-main')?.scrollWidth ?? 0,
            mainClientWidth: document.querySelector('.app-main')?.clientWidth ?? 0,
          }));
          expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
          expect(overflow.mainWidth).toBeLessThanOrEqual(overflow.mainClientWidth);
          expect((await isolated.page.screenshot()).byteLength).toBeGreaterThan(0);
        }
      }

      await isolated.page.getByRole('button', { name: '设置' }).click();
      const themes = [
        ['浅色', 'light'],
        ['深色', 'dark'],
        ['暖红深色', 'warm-red-dark'],
        ['雾蓝', 'slate'],
        ['暖红', 'warm-red'],
      ] as const;
      for (const [label, value] of themes) {
        const option = isolated.page.getByRole('radio', {
          name: label,
          exact: true,
        });
        await option.click();
        await expect(option).toBeChecked();
        await expect(
          isolated.page.locator('.theme-option--selected'),
        ).toHaveCount(1);
        await expect(isolated.page.locator('.manager-app')).toHaveAttribute(
          'data-theme',
          value,
        );
      }
      await isolated.page.emulateMedia({ colorScheme: 'dark' });
      await isolated.page
        .getByRole('radio', { name: '跟随系统', exact: true })
        .click();
      await expect(isolated.page.locator('.manager-app')).toHaveCSS(
        '--color-workspace',
        '#202825',
      );
      await isolated.page
        .getByRole('radio', { name: '暖红', exact: true })
        .click();
      await expect(isolated.page.locator('.manager-app')).toHaveCSS(
        '--color-workspace',
        '#fff4f1',
      );
      for (const zoomFactor of [1, 1.25, 1.5]) {
        await setPageZoom(isolated.page, zoomFactor);
        for (const [width, height] of sizes) {
          await isolated.page.setViewportSize({ width, height });
          await expect(
            isolated.page.getByRole('radio', { name: '暖红', exact: true }),
          ).toBeVisible();
          const overflow = await isolated.page.evaluate(() => {
            const options = document.querySelector('.theme-options');
            return {
              documentWidth: document.documentElement.scrollWidth,
              viewportWidth: document.documentElement.clientWidth,
              optionsWidth: options?.scrollWidth ?? 0,
              optionsClientWidth: options?.clientWidth ?? 0,
            };
          });
          expect(overflow.documentWidth).toBeLessThanOrEqual(
            overflow.viewportWidth,
          );
          expect(overflow.optionsWidth).toBeLessThanOrEqual(
            overflow.optionsClientWidth,
          );
        }
      }
      await setPageZoom(isolated.page, 1);
      expect((await isolated.page.screenshot()).byteLength).toBeGreaterThan(0);
      await isolated.page.reload();
      await expect(isolated.page.locator('.manager-app')).toHaveAttribute(
        'data-theme',
        'warm-red',
      );
    } finally {
      await removeIsolatedFolder(isolated.page, isolated.folderId);
      await isolated.context.close();
      rmSync(isolated.profile, { recursive: true, force: true });
    }
  });
});
