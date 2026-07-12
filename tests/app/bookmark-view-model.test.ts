import { describe, expect, it } from 'vitest';

import {
  createBookmarkViewModel,
  getBookmarkDisplayInfo,
} from '../../src/app/bookmark-view-model';
import type { BookmarkRecord } from '../../src/domain/bookmarks';
import { flattenBookmarkTree } from '../../src/domain/tree';
import {
  BOOKMARK_IDS,
  bookmarkTreeFixture,
} from '../../src/test/fixtures/bookmark-tree';

function folder(
  id: string,
  parentId: string | undefined,
  index: number,
  title: string,
  overrides: Partial<BookmarkRecord> = {},
): BookmarkRecord {
  return {
    id,
    parentId,
    index,
    title,
    path: [],
    depth: parentId === undefined ? 0 : 1,
    isFolder: true,
    isRoot: parentId === undefined,
    isUnmodifiable: false,
    isBookmarkBar: false,
    folderType: 'unknown',
    ...overrides,
  };
}

describe('createBookmarkViewModel', () => {
  it('hides the empty Chromium root and defaults to the bookmarks bar', () => {
    const model = createBookmarkViewModel(
      flattenBookmarkTree(bookmarkTreeFixture),
    );

    expect(model.topLevelFolders.map(({ id }) => id)).toEqual([
      BOOKMARK_IDS.bookmarkBar,
      BOOKMARK_IDS.other,
      BOOKMARK_IDS.managed,
      BOOKMARK_IDS.mobile,
    ]);
    expect(model.searchableRecords.some(({ id }) => id === BOOKMARK_IDS.root)).toBe(
      false,
    );
    expect(model.defaultFolderId).toBe(BOOKMARK_IDS.bookmarkBar);
  });

  it('keeps direct children in browser index order and uses ID as the only tie-breaker', () => {
    const records = [
      folder('root', undefined, 0, ''),
      folder('parent', 'root', 0, 'Parent'),
      folder('late', 'parent', 5, 'A'),
      folder('tie-z', 'parent', 1, 'First by input'),
      folder('tie-a', 'parent', 1, 'Second by input'),
      folder('early', 'parent', 0, 'Z'),
    ];

    const model = createBookmarkViewModel(records);

    expect(model.childrenByParentId.get('parent')?.map(({ id }) => id)).toEqual([
      'early',
      'tie-a',
      'tie-z',
      'late',
    ]);
  });

  it('builds same-title breadcrumbs and folder fallback by ID', () => {
    const records = [
      folder('root', undefined, 0, ''),
      folder('bar', 'root', 0, '书签栏', {
        folderType: 'bookmarks-bar',
        isBookmarkBar: true,
      }),
      folder('same-a', 'bar', 0, '同名目录'),
      folder('same-b', 'same-a', 0, '同名目录'),
    ];
    const model = createBookmarkViewModel(records);

    expect(model.getBreadcrumbs('same-b').map(({ id }) => id)).toEqual([
      'bar',
      'same-a',
      'same-b',
    ]);
    expect(model.resolveFolderId('missing')).toBe('bar');
    expect(model.resolveFolderId('same-b')).toBe('same-b');
  });

  it('collects the entire folder subtree without including the scope folder', () => {
    const records = [
      folder('root', undefined, 0, ''),
      folder('bar', 'root', 0, '书签栏', { folderType: 'bookmarks-bar' }),
      folder('nested', 'bar', 0, 'Nested'),
      {
        ...folder('leaf', 'nested', 0, 'Leaf'),
        isFolder: false,
        url: 'https://example.test',
      },
    ];

    expect(
      [...createBookmarkViewModel(records).getDescendantIds('bar')],
    ).toEqual(['nested', 'leaf']);
  });

  it('collects a wide folder subtree without quadratic head removals', () => {
    const width = 100_000;
    const records = [
      folder('root', undefined, 0, ''),
      folder('bar', 'root', 0, '书签栏', { folderType: 'bookmarks-bar' }),
      ...Array.from({ length: width }, (_, index) => ({
        ...folder(`leaf-${index}`, 'bar', index, `Leaf ${index}`),
        isFolder: false,
        url: `https://leaf-${index}.example.test`,
      })),
    ];
    const model = createBookmarkViewModel(records);

    const startedAt = performance.now();
    const descendantIds = model.getDescendantIds('bar');
    const elapsedMs = performance.now() - startedAt;

    expect(descendantIds.size).toBe(width);
    expect(descendantIds.has('leaf-0')).toBe(true);
    expect(descendantIds.has(`leaf-${width - 1}`)).toBe(true);
    expect(elapsedMs).toBeLessThan(100);
  });
});

describe('getBookmarkDisplayInfo', () => {
  it('uses a host only as an empty-title leaf fallback and never mutates title', () => {
    const leaf = {
      ...folder('leaf', 'bar', 0, ''),
      isFolder: false,
      url: 'https://favicon-only.example:8443/path',
    };
    const unnamedFolder = folder('folder', 'bar', 1, '');

    expect(getBookmarkDisplayInfo(leaf)).toEqual({
      displayTitle: 'favicon-only.example:8443',
      host: 'favicon-only.example:8443',
      isIconOnly: true,
    });
    expect(getBookmarkDisplayInfo(unnamedFolder)).toEqual({
      displayTitle: '未命名文件夹',
      host: '',
      isIconOnly: false,
    });
    expect([leaf.title, unnamedFolder.title]).toEqual(['', '']);
  });
});
