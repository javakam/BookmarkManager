// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SearchResult } from '../../src/app/bookmark-index';
import type { OrganizeAnalyzers } from '../../src/app/use-organize-analysis';
import { ManagerApp } from '../../src/ui/manager/ManagerApp';
import { SearchResults } from '../../src/ui/manager/SearchResults';
import type { BrowserBookmarkNode } from '../../src/domain/bookmarks';
import type {
  BookmarkRepository,
  BookmarkRepositoryChange,
} from '../../src/platform/bookmark-repository';
import {
  createBrowserManagerSettingsRepository,
  type ManagerSettingsRepository,
  type ManagerSettingsStorageArea,
} from '../../src/platform/manager-settings-repository';

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function managerTree(): BrowserBookmarkNode[] {
  return [
    {
      id: 'root',
      title: '',
      children: [
        {
          id: 'bar',
          parentId: 'root',
          index: 0,
          title: '书签栏',
          folderType: 'bookmarks-bar',
          children: [
            {
              id: 'zeta',
              parentId: 'bar',
              index: 0,
              title: 'Zeta',
              url: 'https://zeta.example.test',
            },
            {
              id: 'icon-only',
              parentId: 'bar',
              index: 1,
              title: '',
              url: 'https://favicon-only.example:8443/path',
            },
            {
              id: 'folder-a',
              parentId: 'bar',
              index: 2,
              title: 'Folder A',
              children: [
                {
                  id: 'copy-a',
                  parentId: 'folder-a',
                  index: 0,
                  title: 'Shared',
                  url: 'https://same.example.test/page',
                },
                {
                  id: 'unnamed-folder',
                  parentId: 'folder-a',
                  index: 1,
                  title: '',
                  children: [],
                },
              ],
            },
          ],
        },
        {
          id: 'other',
          parentId: 'root',
          index: 1,
          title: '其他书签',
          folderType: 'other',
          children: [
            {
              id: 'folder-b',
              parentId: 'other',
              index: 0,
              title: 'Folder B',
              children: [
                {
                  id: 'copy-b',
                  parentId: 'folder-b',
                  index: 0,
                  title: 'Shared',
                  url: 'https://same.example.test/page',
                },
              ],
            },
          ],
        },
      ],
    },
  ];
}

function sameTitleTree(): BrowserBookmarkNode[] {
  return [
    {
      id: 'root',
      title: '',
      children: [
        {
          id: 'bar',
          parentId: 'root',
          index: 0,
          title: '书签栏',
          folderType: 'bookmarks-bar',
          children: [
            {
              id: 'same-a',
              parentId: 'bar',
              index: 0,
              title: '同名目录',
              children: [
                {
                  id: 'same-b',
                  parentId: 'same-a',
                  index: 0,
                  title: '同名目录',
                  children: [
                    {
                      id: 'deep-leaf',
                      parentId: 'same-b',
                      index: 0,
                      title: '深层内容',
                      url: 'https://deep.example.test',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ];
}

function managedFolderTree(): BrowserBookmarkNode[] {
  return [
    {
      id: 'root',
      title: '',
      children: [
        {
          id: 'bar',
          parentId: 'root',
          index: 0,
          title: '书签栏',
          folderType: 'bookmarks-bar',
          children: [],
        },
        {
          id: 'managed',
          parentId: 'root',
          index: 1,
          title: '受管书签',
          folderType: 'managed',
          unmodifiable: 'managed',
          children: [
            {
              id: 'managed-child',
              parentId: 'managed',
              index: 0,
              title: '受管子目录',
              children: [],
            },
          ],
        },
      ],
    },
  ];
}

function pagedBookmarkTree(): BrowserBookmarkNode[] {
  const leaves = (parentId: string, prefix: string): BrowserBookmarkNode[] =>
    Array.from({ length: 101 }, (_, index) => ({
      id: `${parentId}-leaf-${index + 1}`,
      parentId,
      index,
      title: `${prefix} ${index + 1}`,
      url: `https://${parentId}-leaf-${index + 1}.example.test`,
    }));

  return [
    {
      id: 'root',
      title: '',
      children: [
        {
          id: 'bar',
          parentId: 'root',
          index: 0,
          title: '书签栏',
          folderType: 'bookmarks-bar',
          children: leaves('bar', 'Bar Leaf'),
        },
        {
          id: 'other',
          parentId: 'root',
          index: 1,
          title: '其他书签',
          folderType: 'other',
          children: leaves('other', 'Other Leaf'),
        },
      ],
    },
  ];
}

function repositoryStub(
  getTree: BookmarkRepository['getTree'],
): BookmarkRepository & { emitChanged: () => void } {
  let listener:
    | ((change: BookmarkRepositoryChange) => void)
    | undefined;
  return {
    getTree,
    createBookmark: vi.fn(),
    createFolder: vi.fn(),
    update: vi.fn(),
    move: vi.fn(),
    remove: vi.fn(),
    onChanged(nextListener) {
      listener = nextListener;
      return () => {
        listener = undefined;
      };
    },
    emitChanged() {
      listener?.('changed');
    },
  };
}

class SettingsStorageAreaStub implements ManagerSettingsStorageArea {
  private readonly values: Record<string, unknown> = {};

  async get(key: string): Promise<Record<string, unknown>> {
    return Object.hasOwn(this.values, key) ? { [key]: this.values[key] } : {};
  }

  async set(values: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, values);
  }
}

async function renderReady(
  tree = managerTree(),
  openUrl = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined),
  settingsRepository?: ManagerSettingsRepository,
) {
  const repository = repositoryStub(vi.fn().mockResolvedValue(tree));
  render(
    <ManagerApp
      openUrl={openUrl}
      repository={repository}
      settingsRepository={settingsRepository}
    />,
  );
  await screen.findByRole('heading', { name: '书签栏' });
  return { repository, openUrl };
}

describe('ManagerApp browse shell', () => {
  it('shows loading, a read error, and a working retry action', async () => {
    const first = deferred<BrowserBookmarkNode[]>();
    const second = deferred<BrowserBookmarkNode[]>();
    const repository = repositoryStub(
      vi
        .fn<BookmarkRepository['getTree']>()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
    );
    render(<ManagerApp repository={repository} openUrl={vi.fn()} />);

    expect(screen.getByText('正在读取书签...')).toBeTruthy();
    await act(async () => first.reject(new Error('读取被拒绝')));
    expect(await screen.findByText('读取被拒绝')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await act(async () => second.resolve(managerTree()));
    expect(await screen.findByRole('heading', { name: '书签栏' })).toBeTruthy();
  });

  it('starts in the bookmarks bar, hides its synthetic root, and keeps index order', async () => {
    await renderReady();

    const currentList = screen.getByRole('list', { name: '当前文件夹内容' });
    expect(
      within(currentList)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual([
      expect.stringContaining('Zeta'),
      expect.stringContaining('favicon-only.example:8443'),
      expect.stringContaining('Folder A'),
    ]);
    const sidebar = screen.getByRole('navigation', { name: '主导航' });
    expect(within(sidebar).getByText('浏览')).toBeTruthy();
    expect(within(sidebar).queryByText('Zeta')).toBeNull();
  });

  it('renders each folder count separately from its accessible name', async () => {
    await renderReady();
    const sidebar = screen.getByRole('navigation', { name: '主导航' });
    const folderName = within(sidebar).getByRole('button', { name: '书签栏' });
    const row = folderName.closest('.folder-tree__row') as HTMLElement;
    const count = within(row).getByLabelText('直属 2，合计 3');

    expect(folderName.textContent).toBe('书签栏');
    expect(folderName.contains(count)).toBe(false);
    expect(count.textContent).toBe('2 / 3');
    expect(count.getAttribute('title')).toBe('直属 2，合计 3');
  });

  it('pages wide folders, resets on navigation, and lazy-loads favicons', async () => {
    await renderReady(pagedBookmarkTree());
    const currentList = screen.getByRole('list', { name: '当前文件夹内容' });

    expect(screen.getByText('101 项')).toBeTruthy();
    expect(currentList.querySelectorAll('.bookmark-row')).toHaveLength(100);
    expect(within(currentList).getByText('Bar Leaf 100')).toBeTruthy();
    expect(within(currentList).queryByText('Bar Leaf 101')).toBeNull();
    const firstFavicon = within(currentList).getByLabelText('Bar Leaf 1 网站图标');
    expect(firstFavicon.getAttribute('loading')).toBe('lazy');
    expect(firstFavicon.getAttribute('decoding')).toBe('async');

    fireEvent.click(screen.getByRole('button', { name: '显示更多' }));
    expect(currentList.querySelectorAll('.bookmark-row')).toHaveLength(101);
    expect(within(currentList).getByText('Bar Leaf 101')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '显示更多' })).toBeNull();

    const sidebar = screen.getByRole('navigation', { name: '主导航' });
    fireEvent.click(within(sidebar).getByRole('button', { name: '其他书签' }));
    await screen.findByRole('heading', { name: '其他书签' });
    const nextList = screen.getByRole('list', { name: '当前文件夹内容' });
    expect(nextList.querySelectorAll('.bookmark-row')).toHaveLength(100);
    expect(within(nextList).queryByText('Other Leaf 101')).toBeNull();
    expect(screen.getByRole('button', { name: '显示更多' })).toBeTruthy();
  });

  it('gives the global searchbox an explicit accessible name', async () => {
    await renderReady();

    expect(screen.getByRole('searchbox', { name: '搜索书签' })).toBeTruthy();
  });

  it('gives all three sidebar view buttons explicit accessible labels', async () => {
    await renderReady();
    const sidebar = screen.getByRole('navigation', { name: '主导航' });

    expect(
      within(sidebar).getByRole('button', { name: '浏览' }).getAttribute('aria-label'),
    ).toBe('浏览');
    expect(
      within(sidebar).getByRole('button', { name: '整理' }).getAttribute('aria-label'),
    ).toBe('整理');
    expect(
      within(sidebar).getByRole('button', { name: '设置' }).getAttribute('aria-label'),
    ).toBe('设置');
  });

  it('uses ordinary nested lists instead of an incomplete ARIA tree widget', async () => {
    await renderReady();
    const sidebar = screen.getByRole('navigation', { name: '主导航' });

    expect(within(sidebar).getByRole('list', { name: '书签目录' })).toBeTruthy();
    expect(within(sidebar).queryByRole('tree')).toBeNull();
    expect(within(sidebar).queryAllByRole('treeitem')).toHaveLength(0);
  });

  it('navigates same-title folders and breadcrumbs by node ID', async () => {
    await renderReady(sameTitleTree());

    fireEvent.click(screen.getByRole('button', { name: '进入文件夹 同名目录' }));
    fireEvent.click(screen.getByRole('button', { name: '进入文件夹 同名目录' }));
    expect(screen.getByText('深层内容')).toBeTruthy();

    const breadcrumbs = screen.getByRole('navigation', { name: '当前路径' });
    fireEvent.click(
      within(breadcrumbs).getAllByRole('button', { name: '返回 同名目录' })[0],
    );
    expect(screen.getByRole('button', { name: '进入文件夹 同名目录' })).toBeTruthy();
    expect(screen.queryByText('深层内容')).toBeNull();
  });

  it('uses an empty-title host without changing the fixture and falls back from favicon', async () => {
    const tree = managerTree();
    const emptyTitleNode = tree[0]?.children?.[0]?.children?.[1];
    await renderReady(tree);

    expect(screen.getByText('favicon-only.example:8443')).toBeTruthy();
    expect(screen.getByText('仅图标显示')).toBeTruthy();
    const favicon = screen.getByLabelText(
      'favicon-only.example:8443 网站图标',
    );
    expect(favicon.getAttribute('src')).toContain(
      '/_favicon/?pageUrl=https%3A%2F%2Ffavicon-only.example%3A8443%2Fpath&size=32',
    );
    fireEvent.error(favicon);
    expect(
      screen.getByLabelText('favicon-only.example:8443 默认网站图标'),
    ).toBeTruthy();
    expect(emptyTitleNode?.title).toBe('');
    expect(
      screen.getByRole('button', {
        name: '打开 favicon-only.example:8443（仅图标显示）',
      }),
    ).toBeTruthy();
  });

  it('shows accessible readonly markers for a managed folder and its inherited child', async () => {
    await renderReady(managedFolderTree());
    const sidebar = screen.getByRole('navigation', { name: '主导航' });

    expect(within(sidebar).getByLabelText('受管书签 只读')).toBeTruthy();
    fireEvent.click(within(sidebar).getByRole('button', { name: '受管书签' }));

    const managedHeading = await screen.findByRole('heading', { name: '受管书签' });
    expect(
      within(managedHeading.closest('.content-heading') as HTMLElement).getByLabelText(
        '受管书签 只读',
      ),
    ).toBeTruthy();
    expect(within(sidebar).getByLabelText('受管子目录 只读')).toBeTruthy();

    fireEvent.click(within(sidebar).getByRole('button', { name: '受管子目录' }));
    const childHeading = await screen.findByRole('heading', { name: '受管子目录' });
    expect(
      within(childHeading.closest('.content-heading') as HTMLElement).getByLabelText(
        '受管子目录 只读',
      ),
    ).toBeTruthy();
  });
});

describe('ManagerApp settings', () => {
  it('loads a hidden-count preference and persists a toggle through the storage adapter', async () => {
    const storage = new SettingsStorageAreaStub();
    const settingsRepository = createBrowserManagerSettingsRepository(storage);
    await settingsRepository.save({ showFolderCounts: false });

    await renderReady(managerTree(), undefined, settingsRepository);
    const sidebar = screen.getByRole('navigation', { name: '主导航' });
    expect(sidebar.querySelector('.folder-tree__count')).toBeNull();

    fireEvent.click(within(sidebar).getByRole('button', { name: '设置' }));
    const toggle = await screen.findByRole('checkbox', {
      name: '显示目录书签数量',
    });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);

    await waitFor(async () => {
      await expect(settingsRepository.load()).resolves.toEqual({
        showFolderCounts: true,
      });
    });
    fireEvent.click(within(sidebar).getByRole('button', { name: '浏览' }));
    expect(
      await within(sidebar).findByLabelText('直属 2，合计 3'),
    ).toBeTruthy();
  });

  it('shows native source, automatic state, last refresh, and a shared manual refresh without analysis', async () => {
    const getTree = vi
      .fn<BookmarkRepository['getTree']>()
      .mockResolvedValue(managerTree());
    const repository = repositoryStub(getTree);
    const duplicateAnalyzer = vi.fn<OrganizeAnalyzers['duplicateAnalyzer']>();
    const similarityAnalyzer = vi.fn<OrganizeAnalyzers['similarityAnalyzer']>();
    render(
      <ManagerApp
        openUrl={vi.fn()}
        organizeAnalyzers={{ duplicateAnalyzer, similarityAnalyzer }}
        repository={repository}
      />,
    );
    await screen.findByRole('heading', { name: '书签栏' });

    const sidebar = screen.getByRole('navigation', { name: '主导航' });
    fireEvent.click(within(sidebar).getByRole('button', { name: '设置' }));
    const settings = await screen.findByRole('region', { name: '设置' });
    expect(within(settings).getByText('当前浏览器原生书签')).toBeTruthy();
    expect(within(settings).getByText('自动更新')).toBeTruthy();
    expect(within(settings).getByText('已开启')).toBeTruthy();
    expect(within(settings).queryByText('尚未更新')).toBeNull();
    expect(settings.querySelector('time[datetime]')).toBeTruthy();

    fireEvent.click(
      within(settings).getByRole('button', { name: '立即刷新书签' }),
    );
    await waitFor(() => expect(getTree).toHaveBeenCalledTimes(2));
    expect(duplicateAnalyzer).not.toHaveBeenCalled();
    expect(similarityAnalyzer).not.toHaveBeenCalled();
  });
});

describe('ManagerApp search', () => {
  it('uses the real index for Chinese reasons, scope, duplicate URLs, zero results, and Escape', async () => {
    await renderReady();
    const search = screen.getByPlaceholderText(
      '搜索书签、网址、域名或文件夹',
    ) as HTMLInputElement;

    fireEvent.change(search, { target: { value: 'shared' } });
    expect(await screen.findAllByText('Shared')).toHaveLength(2);
    expect(screen.getAllByText('标题完全匹配')).toHaveLength(2);
    expect(screen.getByText('书签栏 / Folder A')).toBeTruthy();
    expect(screen.getByText('其他书签 / Folder B')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '当前文件夹' }));
    expect(await screen.findAllByText('Shared')).toHaveLength(1);
    expect(screen.queryByText('其他书签 / Folder B')).toBeNull();

    fireEvent.change(search, { target: { value: 'definitely-no-result' } });
    expect(await screen.findByText('没有找到匹配的书签')).toBeTruthy();
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(search.value).toBe('');
    expect(screen.getByRole('list', { name: '当前文件夹内容' })).toBeTruthy();
  });

  it('renders an empty-title folder result as an unnamed folder, not an icon-only bookmark', async () => {
    await renderReady();
    const search = screen.getByPlaceholderText('搜索书签、网址、域名或文件夹');

    fireEvent.change(search, { target: { value: 'folder a' } });

    expect(await screen.findByText('未命名文件夹')).toBeTruthy();
    expect(screen.queryByText('仅图标显示')).toBeNull();
  });

  it('keeps search state after opening and locates an exact result in its parent', async () => {
    const openUrl = vi
      .fn<(url: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    await renderReady(managerTree(), openUrl);
    const search = screen.getByPlaceholderText(
      '搜索书签、网址、域名或文件夹',
    ) as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'shared' } });
    await screen.findAllByText('Shared');

    fireEvent.click(screen.getAllByRole('button', { name: '打开 Shared' })[1]);
    await waitFor(() =>
      expect(openUrl).toHaveBeenCalledWith('https://same.example.test/page'),
    );
    expect(search.value).toBe('shared');
    expect(screen.getAllByText('Shared')).toHaveLength(2);

    fireEvent.click(screen.getAllByRole('button', { name: '定位 Shared' })[1]);
    expect(search.value).toBe('');
    expect(await screen.findByRole('heading', { name: 'Folder B' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('已定位 Shared');
  });

  it('shows a concise in-page error when opening a new tab fails', async () => {
    const openUrl = vi
      .fn<(url: string) => Promise<void>>()
      .mockRejectedValue(new Error('blocked'));
    await renderReady(managerTree(), openUrl);
    const search = screen.getByPlaceholderText('搜索书签、网址、域名或文件夹');
    fireEvent.change(search, { target: { value: 'zeta' } });
    await screen.findByText('Zeta');

    fireEvent.click(screen.getByRole('button', { name: '打开 Zeta' }));

    expect(await screen.findByText('无法打开新标签页')).toBeTruthy();
  });
});

describe('SearchResults match reasons', () => {
  it('shows the first two reasons plus a complete remainder badge', () => {
    const result = (
      id: string,
      reasons: SearchResult['reasons'],
    ): SearchResult => ({
      node: {
        id,
        parentId: 'bar',
        index: 0,
        title: id,
        url: `https://${id}.example.test`,
        path: ['书签栏'],
        depth: 2,
        isFolder: false,
        isRoot: false,
        isUnmodifiable: false,
        isBookmarkBar: true,
        folderType: 'unknown',
      },
      displayTitle: id,
      reasons,
      score: 700,
    });
    render(
      <SearchResults
        onEnterFolder={vi.fn()}
        onLocate={vi.fn()}
        onOpen={vi.fn()}
        results={[
          result('four-reasons', ['title-exact', 'domain', 'path', 'url']),
          result('two-reasons', ['pinyin', 'fuzzy']),
        ]}
      />,
    );

    const [fourReasonRow, twoReasonRow] = screen.getAllByRole('listitem');
    expect(within(fourReasonRow).getByText('标题完全匹配')).toBeTruthy();
    expect(within(fourReasonRow).getByText('域名匹配')).toBeTruthy();
    expect(within(fourReasonRow).getByText('另有 2 项')).toBeTruthy();
    expect(within(fourReasonRow).queryByText('文件夹路径匹配')).toBeNull();
    expect(within(fourReasonRow).queryByText('网址匹配')).toBeNull();
    expect(within(twoReasonRow).getByText('拼音匹配')).toBeTruthy();
    expect(within(twoReasonRow).getByText('近似匹配')).toBeTruthy();
    expect(within(twoReasonRow).queryByText(/另有/)).toBeNull();
  });
});
