import { describe, expect, it } from 'vitest';

import { flattenBookmarkTree } from '../../src/domain/tree';
import {
  BOOKMARK_IDS,
  bookmarkTreeFixture,
} from '../../src/test/fixtures/bookmark-tree';

describe('flattenBookmarkTree', () => {
  it('returns no records for an empty browser tree', () => {
    expect(flattenBookmarkTree([])).toEqual([]);
  });

  it('preserves depth-first tree order and falls back to array positions for missing indexes', () => {
    const records = flattenBookmarkTree(bookmarkTreeFixture);

    expect(records.map((record) => record.id)).toEqual([
      BOOKMARK_IDS.root,
      BOOKMARK_IDS.bookmarkBar,
      BOOKMARK_IDS.emptyTitle,
      BOOKMARK_IDS.workspace,
      BOOKMARK_IDS.engineering,
      BOOKMARK_IDS.reference,
      BOOKMARK_IDS.local,
      BOOKMARK_IDS.other,
      BOOKMARK_IDS.file,
      BOOKMARK_IDS.managed,
      BOOKMARK_IDS.managedChild,
      BOOKMARK_IDS.managedLeaf,
      BOOKMARK_IDS.mobile,
    ]);

    const indexes = Object.fromEntries(
      records.map(({ id, index }) => [id, index]),
    );
    expect(indexes).toMatchObject({
      [BOOKMARK_IDS.root]: 0,
      [BOOKMARK_IDS.workspace]: 1,
      [BOOKMARK_IDS.reference]: 0,
      [BOOKMARK_IDS.other]: 1,
      [BOOKMARK_IDS.file]: 0,
    });
  });

  it('keeps every domain field, original empty titles, special URLs, paths, and depths', () => {
    const records = flattenBookmarkTree(bookmarkTreeFixture);
    const byId = new Map(records.map((record) => [record.id, record]));

    expect(byId.get(BOOKMARK_IDS.root)).toEqual({
      id: BOOKMARK_IDS.root,
      parentId: undefined,
      index: 0,
      title: '',
      url: undefined,
      path: [],
      depth: 0,
      isFolder: true,
      isRoot: true,
      isUnmodifiable: false,
      isBookmarkBar: false,
      folderType: 'unknown',
      dateAdded: undefined,
    });

    expect(byId.get(BOOKMARK_IDS.emptyTitle)).toMatchObject({
      parentId: BOOKMARK_IDS.bookmarkBar,
      title: '',
      url: 'https://favicon-only.example/path',
      path: ['', 'Bookmarks Bar'],
      depth: 2,
      isFolder: false,
      isRoot: false,
      folderType: 'unknown',
      dateAdded: 1_700_000_000_000,
    });

    expect(byId.get(BOOKMARK_IDS.workspace)?.path).toEqual([
      '',
      'Bookmarks Bar',
    ]);
    expect(byId.get(BOOKMARK_IDS.local)).toMatchObject({
      url: 'http://localhost:4173/dashboard',
      path: [
        '',
        'Bookmarks Bar',
        'Workspace',
        'Engineering',
        'Reference',
      ],
      depth: 5,
    });
    expect(byId.get(BOOKMARK_IDS.file)).toMatchObject({
      url: 'file:///C:/Users/example/notes.html',
      path: ['', 'Other Bookmarks'],
      depth: 2,
    });
  });

  it('classifies folders from falsy URLs and normalizes absent folder types to unknown', () => {
    const [record] = flattenBookmarkTree([
      { id: 'blank-url-node', title: '', url: '' },
    ]);

    expect(record).toMatchObject({
      isFolder: true,
      isRoot: true,
      folderType: 'unknown',
      title: '',
      url: '',
    });
  });

  it('marks the bookmark bar by folder type and propagates the flag to every descendant', () => {
    const records = flattenBookmarkTree(bookmarkTreeFixture);
    const byId = new Map(records.map((record) => [record.id, record]));

    for (const id of [
      BOOKMARK_IDS.bookmarkBar,
      BOOKMARK_IDS.emptyTitle,
      BOOKMARK_IDS.workspace,
      BOOKMARK_IDS.engineering,
      BOOKMARK_IDS.reference,
      BOOKMARK_IDS.local,
    ]) {
      expect(byId.get(id)?.isBookmarkBar, id).toBe(true);
    }

    expect(byId.get(BOOKMARK_IDS.other)?.isBookmarkBar).toBe(false);
    expect(byId.get(BOOKMARK_IDS.mobile)?.folderType).toBe('mobile');
  });

  it('propagates an unmodifiable ancestor through folders and leaves', () => {
    const records = flattenBookmarkTree(bookmarkTreeFixture);
    const byId = new Map(records.map((record) => [record.id, record]));

    expect(byId.get(BOOKMARK_IDS.managed)).toMatchObject({
      isUnmodifiable: true,
      folderType: 'managed',
    });
    expect(byId.get(BOOKMARK_IDS.managedChild)?.isUnmodifiable).toBe(true);
    expect(byId.get(BOOKMARK_IDS.managedLeaf)?.isUnmodifiable).toBe(true);
    expect(byId.get(BOOKMARK_IDS.file)?.isUnmodifiable).toBe(false);
  });
});
