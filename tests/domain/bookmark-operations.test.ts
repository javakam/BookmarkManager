import { describe, expect, it } from 'vitest';

import type { BookmarkRecord } from '../../src/domain/bookmarks';
import {
  compareBookmarkFingerprint,
  createBookmarkFingerprint,
  sortRecordsInBrowserOrder,
  validateMoveTarget,
} from '../../src/domain/bookmark-operations';

function record(
  id: string,
  overrides: Partial<BookmarkRecord> = {},
): BookmarkRecord {
  return {
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
    ...overrides,
  };
}

describe('bookmark operation fingerprints', () => {
  it('detects title, url, parent, and index changes as conflicts', () => {
    const original = createBookmarkFingerprint(record('bookmark'));

    expect(
      compareBookmarkFingerprint(original, createBookmarkFingerprint(record('bookmark'))),
    ).toBe(true);
    expect(
      compareBookmarkFingerprint(
        original,
        createBookmarkFingerprint(record('bookmark', { title: 'changed' })),
      ),
    ).toBe(false);
    expect(
      compareBookmarkFingerprint(
        original,
        createBookmarkFingerprint(record('bookmark', { url: 'https://changed.example.test' })),
      ),
    ).toBe(false);
    expect(
      compareBookmarkFingerprint(
        original,
        createBookmarkFingerprint(record('bookmark', { parentId: 'other' })),
      ),
    ).toBe(false);
    expect(
      compareBookmarkFingerprint(
        original,
        createBookmarkFingerprint(record('bookmark', { index: 1 })),
      ),
    ).toBe(false);
  });
});

describe('validateMoveTarget', () => {
  const root = record('root', {
    parentId: undefined,
    index: 0,
    title: '',
    url: undefined,
    isFolder: true,
    isRoot: true,
    depth: 0,
  });
  const bar = record('bar', {
    parentId: 'root',
    index: 0,
    title: '书签栏',
    url: undefined,
    isFolder: true,
    depth: 1,
  });
  const folder = record('folder', {
    index: 0,
    title: 'Folder',
    url: undefined,
    isFolder: true,
  });
  const child = record('child', {
    parentId: 'folder',
    index: 0,
    title: 'Child',
    url: undefined,
    isFolder: true,
    depth: 3,
  });
  const managed = record('managed', {
    parentId: 'bar',
    index: 1,
    url: undefined,
    isFolder: true,
    isUnmodifiable: true,
  });

  it('rejects roots, managed nodes, and moving a folder into itself or a descendant', () => {
    const records = [root, bar, folder, child, managed];

    expect(validateMoveTarget(records, root, 'bar')).toEqual({
      valid: false,
      reason: '根目录不能移动',
    });
    expect(validateMoveTarget(records, managed, 'bar')).toEqual({
      valid: false,
      reason: '只读书签不能修改',
    });
    expect(validateMoveTarget(records, folder, 'folder')).toEqual({
      valid: false,
      reason: '不能移动到自身或子文件夹',
    });
    expect(validateMoveTarget(records, folder, 'child')).toEqual({
      valid: false,
      reason: '不能移动到自身或子文件夹',
    });
  });

  it('accepts a writable bookmark moving into a writable folder', () => {
    expect(validateMoveTarget([root, bar, record('bookmark')], record('bookmark'), 'bar')).toEqual({
      valid: true,
    });
  });
});

describe('sortRecordsInBrowserOrder', () => {
  it('orders batch items by their current browser order', () => {
    const records = [
      record('second', { index: 2 }),
      record('first', { index: 0 }),
      record('nested', { parentId: 'folder', index: 0, path: ['书签栏', 'Folder'] }),
    ];

    expect(sortRecordsInBrowserOrder(records).map(({ id }) => id)).toEqual([
      'first',
      'second',
      'nested',
    ]);
  });
});
