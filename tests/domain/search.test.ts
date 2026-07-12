import { describe, expect, it } from 'vitest';

import type { BookmarkRecord } from '../../src/domain/bookmarks';
import {
  createSearchEntry,
  createSearchResult,
  matchSearchEntry,
  normalizeSearchText,
} from '../../src/domain/search';

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

describe('search domain', () => {
  it('normalizes queries with NFKC, lowercase, and collapsed whitespace', () => {
    expect(normalizeSearchText('  ＧｉｔＨｕｂ\u3000  Docs  ')).toBe(
      'github docs',
    );
  });

  it('indexes title, host, URL, path segments, and the full folder path', () => {
    const entry = createSearchEntry(
      record('fields', 'Reference', {
        url: 'https://Developer.Example.test/guide/start?mode=fast',
        path: ['Bookmarks Bar', 'Team Docs'],
      }),
      0,
    );

    expect(matchSearchEntry(entry, 'reference')?.reasons[0]).toBe(
      'title-exact',
    );
    expect(matchSearchEntry(entry, 'developer.example')?.reasons[0]).toBe(
      'domain',
    );
    expect(matchSearchEntry(entry, 'guide/start')?.reasons[0]).toBe('url');
    expect(matchSearchEntry(entry, 'team docs')?.reasons[0]).toBe('path');
    expect(matchSearchEntry(entry, 'bookmarks bar team')?.reasons[0]).toBe(
      'path',
    );
  });

  it('indexes Chinese full pinyin and initials without changing the title', () => {
    const node = record('pinyin', '中文文档');
    const entry = createSearchEntry(node, 0);

    expect(matchSearchEntry(entry, 'zhongwen')?.reasons[0]).toBe('pinyin');
    expect(matchSearchEntry(entry, 'zwwd')?.reasons[0]).toBe('pinyin');
    expect(node.title).toBe('中文文档');
  });

  it('uses the strict reason priority for direct matches', () => {
    const query = 'zhong';
    const matches = [
      createSearchEntry(record('exact', 'zhong'), 0),
      createSearchEntry(record('prefix', 'zhonghua'), 1),
      createSearchEntry(
        record('domain', 'Portal', {
          url: 'https://zhong.example.test/home',
        }),
        2,
      ),
      createSearchEntry(record('pinyin-priority', '中文'), 3),
      createSearchEntry(
        record('path', 'Handbook', { path: ['Team', 'zhong docs'] }),
        4,
      ),
      createSearchEntry(
        record('url', 'Article', {
          url: 'https://example.test/articles/zhong',
        }),
        5,
      ),
    ].map((entry) => matchSearchEntry(entry, query));

    expect(matches.map((match) => match?.reasons[0])).toEqual([
      'title-exact',
      'title-prefix',
      'domain',
      'pinyin',
      'path',
      'url',
    ]);
    expect(matches.map((match) => match?.score)).toEqual(
      [...matches]
        .map((match) => match?.score)
        .sort((left, right) => (right ?? 0) - (left ?? 0)),
    );
  });

  it('does not throw for invalid URLs and keeps them searchable as raw URLs', () => {
    const entry = createSearchEntry(
      record('invalid', '', { url: 'not a valid URL/Section Name' }),
      0,
    );

    expect(entry.host).toBe('');
    expect(matchSearchEntry(entry, 'section name')?.reasons[0]).toBe('url');
    expect(createSearchResult(entry, { score: 200, reasons: ['url'] })).toEqual(
      expect.objectContaining({
        node: expect.objectContaining({ title: '' }),
        displayTitle: 'not a valid URL/Section Name',
      }),
    );
  });

  it('indexes both encoded and decoded URL representations', () => {
    const entry = createSearchEntry(
      record('encoded', 'Encoded', {
        url: 'https://example.test/%E6%B5%8B%E8%AF%95',
      }),
      0,
    );

    expect(matchSearchEntry(entry, '%e6%b5%8b%e8%af%95')?.reasons[0]).toBe(
      'url',
    );
    expect(matchSearchEntry(entry, '测试')?.reasons[0]).toBe('url');
  });

  it('decodes safe URL portions without throwing on malformed percent escapes', () => {
    const entry = createSearchEntry(
      record('partially-encoded', 'Partially Encoded', {
        url: 'https://example.test/%E6%B5%8B%E8%AF%95%ZZ%20safe%',
      }),
      0,
    );

    expect(matchSearchEntry(entry, '测试%zz safe%')?.reasons[0]).toBe('url');
  });

  it('searches an IDN by its Unicode alias but displays its ASCII host', () => {
    const entry = createSearchEntry(
      record('idn', '', { url: 'https://测试.example/guide' }),
      0,
    );

    expect(entry.host).toBe('xn--0zwm56d.example');
    expect(matchSearchEntry(entry, '测试.example')?.reasons[0]).toBe(
      'domain',
    );
    expect(
      createSearchResult(entry, { score: 500, reasons: ['domain'] })
        .displayTitle,
    ).toBe('xn--0zwm56d.example');
  });

  it('does not display a confusable IDN as decoded Unicode', () => {
    const entry = createSearchEntry(
      record('confusable-idn', '', {
        url: 'https://xn--80ak6aa92e.com/login',
      }),
      0,
    );

    expect(matchSearchEntry(entry, 'аррӏе.com')?.reasons[0]).toBe('domain');
    expect(entry.host).toBe('xn--80ak6aa92e.com');
    expect(
      createSearchResult(entry, { score: 500, reasons: ['domain'] })
        .displayTitle,
    ).toBe('xn--80ak6aa92e.com');
  });

  it('indexes an explicit URL port as part of the host', () => {
    const entry = createSearchEntry(
      record('local', 'Local Dashboard', {
        url: 'http://localhost:4173/dashboard',
      }),
      0,
    );

    expect(entry.host).toBe('localhost:4173');
    expect(matchSearchEntry(entry, 'localhost:4173')?.reasons[0]).toBe(
      'domain',
    );
  });

  it('uses host, then URL, then an icon-only label for empty display titles', () => {
    const hostEntry = createSearchEntry(
      record('host-fallback', '', {
        url: 'https://docs.example.test/guide',
      }),
      0,
    );
    const urlEntry = createSearchEntry(
      record('url-fallback', '', { url: 'custom value' }),
      1,
    );
    const iconOnlyEntry = createSearchEntry(
      record('icon-only', '', { url: undefined, isFolder: true }),
      2,
    );

    expect(
      createSearchResult(hostEntry, {
        score: 500,
        reasons: ['domain'],
      }).displayTitle,
    ).toBe('docs.example.test');
    expect(
      createSearchResult(urlEntry, { score: 200, reasons: ['url'] })
        .displayTitle,
    ).toBe('custom value');
    expect(
      createSearchResult(iconOnlyEntry, { score: 0, reasons: [] })
        .displayTitle,
    ).toBe('仅图标显示');
    expect(hostEntry.node.title).toBe('');
  });
});
