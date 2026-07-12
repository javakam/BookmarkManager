import { describe, expect, it } from 'vitest';

import { BookmarkIndex } from '../../src/app/bookmark-index';
import type { BookmarkRecord } from '../../src/domain/bookmarks';

function record(
  id: string,
  title: string,
  overrides: Partial<BookmarkRecord> = {},
): BookmarkRecord {
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
    ...overrides,
  };
}

describe('BookmarkIndex', () => {
  it('returns no results for an empty or whitespace-only query', () => {
    const index = new BookmarkIndex([record('one', 'One')]);

    expect(index.search('')).toEqual([]);
    expect(index.search('  \u3000 ')).toEqual([]);
  });

  it('ranks exact, prefix, domain, pinyin, path, URL, then fuzzy matches', () => {
    const index = new BookmarkIndex([
      record('exact', 'zhong'),
      record('prefix', 'zhonghua'),
      record('domain', 'Portal', {
        url: 'https://zhong.example.test/home',
      }),
      record('pinyin', '中文'),
      record('path', 'Handbook', { path: ['Team', 'zhong docs'] }),
      record('url', 'Article', {
        url: 'https://example.test/articles/zhong',
      }),
      record('fuzzy', 'zhang'),
    ]);

    const results = index.search('zhong');

    expect(results.map(({ node }) => node.id)).toEqual([
      'exact',
      'prefix',
      'domain',
      'pinyin',
      'path',
      'url',
      'fuzzy',
    ]);
    expect(results.map(({ reasons }) => reasons[0])).toEqual([
      'title-exact',
      'title-prefix',
      'domain',
      'pinyin',
      'path',
      'url',
      'fuzzy',
    ]);
    expect(results.map(({ score }) => score)).toEqual(
      [...results].map(({ score }) => score).sort((a, b) => b - a),
    );
  });

  it('supports full pinyin and pinyin-initial queries', () => {
    const index = new BookmarkIndex([record('cn', '中文文档')]);

    expect(index.search('zhongwen')[0]?.node.id).toBe('cn');
    expect(index.search('zwwd')[0]?.node.id).toBe('cn');
    expect(index.search('zwwd')[0]?.reasons[0]).toBe('pinyin');
  });

  it('disables fuzzy matching for one-character queries', () => {
    const index = new BookmarkIndex([
      record('gamma', 'Gamma'),
      record('emoji', '🧪', { url: 'https://site.invalid/' }),
    ]);

    expect(index.search('q')).toEqual([]);
    expect(index.search('🧫')).toEqual([]);
  });

  it('uses fuzzy matching for a two-character typo', () => {
    const index = new BookmarkIndex([record('google', '谷歌')]);

    expect(index.search('谷哥')).toEqual([
      expect.objectContaining({
        node: expect.objectContaining({ id: 'google' }),
        reasons: ['fuzzy'],
      }),
    ]);
  });

  it('applies ID scopes and result limits', () => {
    const index = new BookmarkIndex([
      record('first', 'Docs'),
      record('second', 'Docs'),
      record('third', 'Docs'),
    ]);

    expect(
      index
        .search('docs', { kind: 'ids', ids: new Set(['second', 'third']) })
        .map(({ node }) => node.id),
    ).toEqual(['second', 'third']);
    expect(index.search('docs', { kind: 'all' }, 1)[0]?.node.id).toBe(
      'first',
    );
    expect(index.search('docs', { kind: 'all' }, 0)).toEqual([]);
  });

  it('keeps equal-score results in refresh tree order', () => {
    const index = new BookmarkIndex([
      record('tree-first', 'Same', { index: 9 }),
      record('tree-second', 'Same', { index: 0 }),
    ]);

    expect(index.search('same').map(({ node }) => node.id)).toEqual([
      'tree-first',
      'tree-second',
    ]);
  });

  it('keeps bookmarks with the same URL but different paths separate', () => {
    const index = new BookmarkIndex([
      record('copy-a', 'Shared', {
        url: 'https://same.example.test/page',
        path: ['A'],
      }),
      record('copy-b', 'Shared', {
        url: 'https://same.example.test/page',
        path: ['B'],
      }),
    ]);

    expect(index.search('shared').map(({ node }) => node.id)).toEqual([
      'copy-a',
      'copy-b',
    ]);
  });

  it('preserves empty titles and supplies display fallbacks without writing back', () => {
    const hostNode = record('host', '', {
      url: 'https://fallback.example.test/path',
    });
    const invalidNode = record('invalid', '', { url: 'invalid raw URL' });
    const iconNode = record('icon', '', {
      url: undefined,
      path: ['Icon'],
      isFolder: true,
    });
    const index = new BookmarkIndex([hostNode, invalidNode, iconNode]);

    expect(index.search('fallback')[0]?.displayTitle).toBe(
      'fallback.example.test',
    );
    expect(index.search('raw url')[0]?.displayTitle).toBe('invalid raw URL');
    expect(index.search('icon')[0]?.displayTitle).toBe('仅图标显示');
    expect([hostNode.title, invalidNode.title, iconNode.title]).toEqual([
      '',
      '',
      '',
    ]);
  });

  it('refreshes, upserts by ID without duplicates, and removes incrementally', () => {
    const index = new BookmarkIndex([record('old', 'Old')]);

    index.refresh([record('fresh', 'Fresh')]);
    expect(index.search('old')).toEqual([]);
    expect(index.search('fresh')[0]?.node.id).toBe('fresh');

    index.upsert(
      record('fresh', 'Updated', { url: 'https://site.invalid/' }),
    );
    index.upsert(
      record('fresh', 'Updated Again', { url: 'https://site.invalid/' }),
    );
    expect(index.search('fresh')).toEqual([]);
    expect(index.search('updated again').map(({ node }) => node.id)).toEqual([
      'fresh',
    ]);

    index.upsert(record('added', 'Added'));
    expect(index.search('added')[0]?.node.id).toBe('added');

    index.remove('fresh');
    expect(index.search('updated again')).toEqual([]);
    expect(index.search('added')[0]?.node.id).toBe('added');
  });

  it('keeps one record per ID during refresh and lets the later record win', () => {
    const index = new BookmarkIndex();

    index.refresh([
      record('duplicate-id', 'Q original'),
      record('duplicate-id', 'Z replacement'),
    ]);

    expect(index.search('q')).toEqual([]);
    expect(index.search('z')).toEqual([
      expect.objectContaining({
        node: expect.objectContaining({
          id: 'duplicate-id',
          title: 'Z replacement',
        }),
      }),
    ]);
  });

  it('copies source records and paths when building the index', () => {
    const sourcePath = ['Original Folder'];
    const source = record('snapshot-id', 'Snapshot Title', {
      path: sourcePath,
    });
    const index = new BookmarkIndex([source]);

    (source as { id: string }).id = 'mutated-id';
    (source as { title: string }).title = 'Mutated Title';
    sourcePath.push('Injected Folder');

    const result = index.search('snapshot title', { kind: 'all' }, 1)[0];
    expect(result?.node).toMatchObject({
      id: 'snapshot-id',
      title: 'Snapshot Title',
      path: ['Original Folder'],
    });

    index.remove('snapshot-id');
    expect(index.search('snapshot title')).toEqual([]);
  });

  it('freezes returned records and paths so attempted changes cannot corrupt the index', () => {
    const index = new BookmarkIndex([
      record('locked-id', 'Locked Title', { path: ['Locked Folder'] }),
    ]);
    const result = index.search('locked title', { kind: 'all' }, 1)[0];

    expect(Object.isFrozen(result?.node)).toBe(true);
    expect(Object.isFrozen(result?.node.path)).toBe(true);
    expect(() => {
      (result?.node as { id: string }).id = 'tampered-id';
    }).toThrow(TypeError);
    expect(() => {
      (result?.node.path as string[]).push('Injected Folder');
    }).toThrow(TypeError);

    expect(index.search('locked title', { kind: 'all' }, 1)[0]?.node.id).toBe(
      'locked-id',
    );
    index.remove('locked-id');
    expect(index.search('locked title')).toEqual([]);
  });
});
