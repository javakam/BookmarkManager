import { describe, expect, it } from 'vitest';

import type { BookmarkRecord } from '../../src/domain/bookmarks';
import { calculateFolderMove } from '../../src/domain/folder-reorder';

function folder(
  id: string,
  index: number,
  parentId = 'parent',
): BookmarkRecord {
  return {
    id,
    parentId,
    index,
    title: id,
    path: ['书签栏'],
    depth: 2,
    isFolder: true,
    isRoot: false,
    isUnmodifiable: false,
    isBookmarkBar: true,
    folderType: 'unknown',
  };
}

function bookmark(id: string, index: number): BookmarkRecord {
  return {
    ...folder(id, index),
    url: `https://${id}.example.test`,
    isFolder: false,
  };
}

describe('calculateFolderMove', () => {
  it('calculates final indexes against the complete sibling list', () => {
    const siblings = [
      folder('folder-a', 0),
      bookmark('bookmark-x', 1),
      folder('folder-b', 2),
      bookmark('bookmark-y', 3),
      folder('folder-c', 4),
    ];

    expect(calculateFolderMove(siblings, 'folder-c', 'folder-a', 'after')).toEqual({
      parentId: 'parent',
      index: 1,
    });
    expect(calculateFolderMove(siblings, 'folder-a', 'folder-c', 'after')).toEqual({
      parentId: 'parent',
      index: 4,
    });
    expect(calculateFolderMove(siblings, 'folder-b', 'folder-a', 'before')).toEqual({
      parentId: 'parent',
      index: 0,
    });
  });

  it('rejects no-op, cross-parent, and non-folder moves', () => {
    const siblings = [
      folder('folder-a', 0),
      bookmark('bookmark-x', 1),
      folder('folder-b', 2, 'other-parent'),
    ];

    expect(calculateFolderMove(siblings, 'folder-a', 'folder-a', 'after')).toBeUndefined();
    expect(calculateFolderMove(siblings, 'folder-a', 'folder-b', 'after')).toBeUndefined();
    expect(calculateFolderMove(siblings, 'bookmark-x', 'folder-a', 'after')).toBeUndefined();
  });
});
