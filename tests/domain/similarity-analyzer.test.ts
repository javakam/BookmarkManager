import { describe, expect, it } from 'vitest';

import type { BookmarkRecord } from '../../src/domain/bookmarks';
import {
  analyzeSimilarBookmarks,
  normalizeSimilarityTitle,
} from '../../src/domain/similarity-analyzer';

function bookmark(
  id: string,
  title: string,
  url: string,
  parentId = 'folder',
): BookmarkRecord {
  return {
    id,
    parentId,
    index: 0,
    title,
    url,
    path: ['Bookmarks Bar', parentId],
    depth: 2,
    isFolder: false,
    isRoot: false,
    isUnmodifiable: false,
    isBookmarkBar: true,
    folderType: 'unknown',
  };
}

describe('similarity analyzer', () => {
  it('normalizes titles with NFKC, lowercase, collapsed whitespace, and common separators', () => {
    expect(
      normalizeSimilarityTitle('  ＯｐｅｎＡＩ | API -- Reference  '),
    ).toBe('openai api reference');
  });

  it('groups equal non-empty normalized titles with different URLs as one title conflict', () => {
    const analysis = analyzeSimilarBookmarks([
      bookmark('a', 'Project Dashboard', 'https://one.example.test/home'),
      bookmark('b', 'project | dashboard', 'https://two.example.test/home'),
    ]);
    const [group] = analysis.titleConflictGroups;

    expect(group).toMatchObject({
      confidence: 'high',
      reason: 'title-conflict',
      members: [{ id: 'a' }, { id: 'b' }],
    });
    expect(group.evidence.map(({ type }) => type)).toContain('title-conflict');
    expect(group.reason).not.toContain('duplicate');
    expect(analysis.pairs).toEqual([]);
    expect(Object.isFrozen(analysis.titleConflictGroups)).toBe(true);
    expect(Object.isFrozen(group)).toBe(true);
    expect(Object.isFrozen(group.members)).toBe(true);
    expect(group).not.toHaveProperty('selected');
  });

  it('finds near titles with explainable title evidence', () => {
    const [pair] = analyzeSimilarBookmarks([
      bookmark(
        'api-docs',
        'OpenAI API Reference',
        'https://docs.example.test/reference',
      ),
      bookmark(
        'api-guide',
        'OpenAI API Reference Guide',
        'https://guide.example.test/api',
      ),
    ]).pairs;

    expect(pair.reason).toBe('title-similarity');
    expect(pair.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'title', score: expect.any(Number) }),
      ]),
    );
    expect(pair.score).toBeGreaterThanOrEqual(0.68);
    expect(pair.score).toBeLessThanOrEqual(1);
  });

  it('finds highly similar paths on the same host without relying on titles', () => {
    const [pair] = analyzeSimilarBookmarks([
      bookmark(
        'start',
        'Alpha',
        'https://docs.example.test/guides/getting-started',
      ),
      bookmark(
        'start-guide',
        'Omega',
        'https://docs.example.test/guides/getting-started-guide',
      ),
    ]).pairs;

    expect(pair.reason).toBe('host-path-similarity');
    expect(pair.evidence.map(({ type }) => type)).toContain('host-path');
  });

  it('excludes bookmarks with the exact same complete URL', () => {
    expect(
      analyzeSimilarBookmarks([
        bookmark('a', 'First title', 'https://same.example.test/path?q=1#x'),
        bookmark('b', 'Second title', 'https://same.example.test/path?q=1#x'),
      ]).pairs,
    ).toEqual([]);
  });

  it('never treats empty titles as title similarity evidence', () => {
    const analysis = analyzeSimilarBookmarks([
      bookmark('a', '', 'https://one.example.test/alpha'),
      bookmark('b', '   ', 'https://two.example.test/beta'),
    ]);

    expect(analysis.pairs).toEqual([]);
  });

  it('can match empty titles by same-host path evidence without title evidence', () => {
    const [pair] = analyzeSimilarBookmarks([
      bookmark(
        'empty-a',
        '',
        'https://docs.example.test/guides/getting-started',
        'folder-a',
      ),
      bookmark(
        'empty-b',
        '   ',
        'https://docs.example.test/guides/getting-started-guide',
        'folder-b',
      ),
    ]).pairs;

    const evidenceTypes = pair.evidence.map(({ type }) => type);
    expect(pair.reason).toBe('host-path-similarity');
    expect(evidenceTypes).toContain('host-path');
    expect(evidenceTypes).not.toContain('title');
    expect(evidenceTypes).not.toContain('title-conflict');
  });

  it('adds folder context only as supporting evidence for a metadata match', () => {
    const [pair] = analyzeSimilarBookmarks([
      bookmark(
        'context-a',
        'API Reference',
        'https://docs.example.test/guides/api-reference',
        'shared-folder',
      ),
      bookmark(
        'context-b',
        'API Reference Guide',
        'https://docs.example.test/guides/api-reference-guide',
        'shared-folder',
      ),
    ]).pairs;

    const evidenceTypes = pair.evidence.map(({ type }) => type);
    expect(evidenceTypes).toEqual(
      expect.arrayContaining(['title', 'host-path', 'folder-context']),
    );
    expect(pair.reason).toBe('metadata-similarity');
  });

  it('does not report bookmarks based only on shared folder context', () => {
    const analysis = analyzeSimilarBookmarks([
      bookmark('a', 'Quarterly Finance', 'https://finance.example.test/report'),
      bookmark('b', 'Cooking Recipes', 'https://food.example.test/kitchen'),
    ]);

    expect(analysis.pairs).toEqual([]);
  });

  it('deduplicates and orders pairs stably regardless of input order', () => {
    const records = [
      bookmark('z', 'API Reference Guide', 'https://z.example.test/api'),
      bookmark('a', 'API Reference', 'https://a.example.test/api'),
      bookmark('m', 'Unrelated', 'https://m.example.test/other'),
    ];
    const forward = analyzeSimilarBookmarks(records).pairs;
    const reversed = analyzeSimilarBookmarks([...records].reverse()).pairs;

    expect(forward.map(({ id }) => id)).toEqual(reversed.map(({ id }) => id));
    expect(forward.length).toBeGreaterThan(0);
    expect(new Set(forward.map(({ id }) => id)).size).toBe(forward.length);
    expect(forward[0].members.map(({ id }) => id)).toEqual(['a', 'z']);
  });

  it('returns deeply immutable pairs with no preselection state', () => {
    const analysis = analyzeSimilarBookmarks([
      bookmark('a', 'Project Portal', 'https://one.example.test/home'),
      bookmark(
        'b',
        'Project Portal Guide',
        'https://two.example.test/guide',
      ),
    ]);
    const [pair] = analysis.pairs;

    expect(Object.isFrozen(analysis)).toBe(true);
    expect(Object.isFrozen(analysis.pairs)).toBe(true);
    expect(Object.isFrozen(pair)).toBe(true);
    expect(Object.isFrozen(pair.members)).toBe(true);
    expect(Object.isFrozen(pair.members[0])).toBe(true);
    expect(Object.isFrozen(pair.members[0].path)).toBe(true);
    expect(Object.isFrozen(pair.evidence)).toBe(true);
    expect(pair).not.toHaveProperty('selected');
    expect(pair).not.toHaveProperty('delete');
    expect(pair.members[0]).not.toHaveProperty('selected');
  });

  it('aggregates a dense 5000-member title conflict before approximate blocking', () => {
    const records = Array.from({ length: 5_000 }, (_, index) =>
      bookmark(
        `conflict-${index.toString().padStart(4, '0')}`,
        index % 2 === 0 ? 'Dense | Reference' : 'dense-reference',
        `https://conflict.example.test/${index}`,
      ),
    );

    const analysis = analyzeSimilarBookmarks(records);
    const [group] = analysis.titleConflictGroups;

    expect(analysis.titleConflictGroups).toHaveLength(1);
    expect(group.members).toHaveLength(5_000);
    expect(group.members[0].id).toBe('conflict-0000');
    expect(group.members.at(-1)?.id).toBe('conflict-4999');
    expect(group.evidence.map(({ type }) => type)).toContain('title-conflict');
    expect(analysis.candidateComparisons).toBe(0);
    expect(analysis.pairs).toEqual([]);
    expect(analysis.truncated).toBe(false);
    expect(Object.isFrozen(group.members[0].path)).toBe(true);
  });

  it('limits dense approximate results by score-ranked top-K and a global cap', () => {
    const records = Array.from({ length: 2_000 }, (_, index) => {
      const suffix = index.toString(36).padStart(3, '0');
      return bookmark(
        `dense-${index.toString().padStart(4, '0')}`,
        `Dense API Reference ${suffix}`,
        `https://dense.example.test/reference/${suffix}`,
      );
    });

    const analysis = analyzeSimilarBookmarks(records);
    const pairCounts = new Map<string, number>();
    for (const { members } of analysis.pairs) {
      for (const { id } of members) {
        pairCounts.set(id, (pairCounts.get(id) ?? 0) + 1);
      }
    }

    expect(analysis.titleConflictGroups).toEqual([]);
    expect(analysis.candidateComparisons).toBeLessThanOrEqual(
      (records.length * 8) / 2,
    );
    expect(Math.max(...pairCounts.values())).toBeLessThanOrEqual(8);
    expect(analysis.pairs.length).toBeLessThanOrEqual(5_000);
    expect(analysis.truncated).toBe(true);
  });

  it('keeps the strongest preliminary match instead of truncating by ID order', () => {
    const records = [
      bookmark(
        'central',
        'abcdefghij reference',
        'https://rank.example.test/docs/abcdefghij',
      ),
      bookmark(
        'zz-best',
        'abcdefghijk reference',
        'https://rank.example.test/docs/abcdefghijk',
      ),
      ...Array.from({ length: 12 }, (_, index) =>
        bookmark(
          `aa-${index.toString().padStart(2, '0')}`,
          `abcdefghi${index} reference notes`,
          `https://rank.example.test/docs/abcdefghi${index}-notes`,
        ),
      ),
    ];

    const analysis = analyzeSimilarBookmarks(records);
    const centralPairs = analysis.pairs.filter(({ members }) =>
      members.some(({ id }) => id === 'central'),
    );

    expect(centralPairs.length).toBeGreaterThan(0);
    expect(centralPairs.length).toBeLessThanOrEqual(8);
    expect(
      centralPairs.some(({ members }) =>
        members.some(({ id }) => id === 'zz-best'),
      ),
    ).toBe(true);
  });

  it('bounds candidate comparisons for 5000 bookmarks instead of scanning all pairs', () => {
    const records = Array.from({ length: 5_000 }, (_, index) => {
      const hash = Math.imul(index + 1, 2_654_435_761)
        .toString(16)
        .slice(-8);
      return bookmark(
        `node-${index.toString().padStart(4, '0')}`,
        `entry ${hash}`,
        `https://large.example.test/${hash}`,
      );
    });

    const analysis = analyzeSimilarBookmarks(records);

    expect(analysis.candidateComparisons).toBeGreaterThan(0);
    expect(analysis.candidateComparisons).toBeLessThan(records.length * 80);
  });
});
