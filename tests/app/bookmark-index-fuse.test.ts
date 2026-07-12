import { beforeEach, describe, expect, it, vi } from 'vitest';

const fuseMock = vi.hoisted(() => ({
  construct: vi.fn((_docs: unknown, _options?: unknown) => undefined),
  search: vi.fn((_query: unknown) => []),
  setCollection: vi.fn((_docs: unknown) => undefined),
}));

vi.mock('fuse.js', () => ({
  default: class FuseMock {
    constructor(docs: unknown, options?: unknown) {
      fuseMock.construct(docs, options);
    }

    search(query: unknown): unknown[] {
      return fuseMock.search(query);
    }

    setCollection(docs: unknown): void {
      fuseMock.setCollection(docs);
    }
  },
}));

import { BookmarkIndex } from '../../src/app/bookmark-index';
import type { BookmarkRecord } from '../../src/domain/bookmarks';

function record(id: string, title: string): BookmarkRecord {
  return {
    id,
    parentId: 'parent',
    index: 0,
    title,
    url: `https://${id}.example.test/`,
    path: ['Bookmarks Bar'],
    depth: 1,
    isFolder: false,
    isRoot: false,
    isUnmodifiable: false,
    isBookmarkBar: true,
    folderType: 'unknown',
  };
}

describe('BookmarkIndex Fuse lifecycle', () => {
  beforeEach(() => {
    fuseMock.construct.mockClear();
    fuseMock.search.mockClear();
    fuseMock.setCollection.mockClear();
  });

  it('keeps one Fuse instance across queries and refreshes its collection after mutations', () => {
    const index = new BookmarkIndex([record('first', 'Exact')]);

    index.search('exact', { kind: 'all' }, 1);
    index.search('missing');
    index.search('another missing');

    expect(fuseMock.construct).toHaveBeenCalledTimes(1);
    expect(fuseMock.setCollection).toHaveBeenCalledTimes(1);

    index.upsert(record('second', 'Second'));
    index.remove('second');
    index.refresh([record('refreshed', 'Refreshed')]);

    expect(fuseMock.construct).toHaveBeenCalledTimes(1);
    expect(fuseMock.setCollection).toHaveBeenCalledTimes(4);
  });

  it('only invokes fuzzy search for multi-character queries with insufficient direct results', () => {
    const index = new BookmarkIndex([
      record('exact', 'Exact'),
      record('emoji', '🧪'),
    ]);
    fuseMock.search.mockClear();

    index.search('🧫');
    index.search('exact', { kind: 'all' }, 1);

    expect(fuseMock.search).not.toHaveBeenCalled();

    index.search('typo');

    expect(fuseMock.search).toHaveBeenCalledTimes(1);
    expect(fuseMock.search).toHaveBeenCalledWith('typo');
  });
});
