import { describe, expect, it } from 'vitest';

import type { BookmarkRecord } from '../../src/domain/bookmarks';
import {
  calculateBookmarkMove,
  calculateFolderMove,
} from '../../src/domain/folder-reorder';

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
      index: 5,
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

describe('calculateBookmarkMove', () => {
  it('calculates link order with folders and links in one sibling list', () => {
    const siblings = [
      bookmark('bookmark-a', 0),
      folder('folder-b', 1),
      bookmark('bookmark-c', 2),
    ];

    expect(
      calculateBookmarkMove(siblings, 'bookmark-c', 'bookmark-a', 'before'),
    ).toEqual({
      parentId: 'parent',
      index: 0,
    });
    expect(
      calculateBookmarkMove(siblings, 'bookmark-a', 'folder-b', 'after'),
    ).toEqual({
      parentId: 'parent',
      index: 2,
    });
  });

  it('rejects no-op and cross-parent drops for any node type', () => {
    const siblings = [
      bookmark('bookmark-a', 0),
      folder('folder-b', 1, 'other-parent'),
    ];

    expect(
      calculateBookmarkMove(siblings, 'bookmark-a', 'bookmark-a', 'after'),
    ).toBeUndefined();
    expect(
      calculateBookmarkMove(siblings, 'bookmark-a', 'folder-b', 'after'),
    ).toBeUndefined();
  });

  it('rejects drops that keep a node in its current position', () => {
    const siblings = [
      bookmark('bookmark-a', 0),
      folder('folder-b', 1),
      bookmark('bookmark-c', 2),
    ];

    expect(
      calculateBookmarkMove(siblings, 'bookmark-a', 'folder-b', 'before'),
    ).toBeUndefined();
    expect(
      calculateBookmarkMove(siblings, 'bookmark-c', 'folder-b', 'after'),
    ).toBeUndefined();
  });
});
