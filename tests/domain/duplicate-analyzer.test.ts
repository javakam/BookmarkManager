import { describe, expect, it } from 'vitest';

import type { BookmarkRecord } from '../../src/domain/bookmarks';
import * as duplicateAnalyzer from '../../src/domain/duplicate-analyzer';
import { normalizeUrlCandidates } from '../../src/domain/url-normalize';

const { analyzeDuplicates } = duplicateAnalyzer;

function bookmark(
  id: string,
  url: string,
  parentId = 'folder',
  title = id,
): BookmarkRecord {
  return {
    id,
    parentId,
    index: 0,
    title,
    url,
    path: [parentId],
    depth: 1,
    isFolder: false,
    isRoot: false,
    isUnmodifiable: false,
    isBookmarkBar: false,
    folderType: 'unknown',
  };
}

function folder(id: string, parentId?: string): BookmarkRecord {
  return {
    id,
    parentId,
    index: 0,
    title: id,
    path: parentId ? [parentId] : [],
    depth: parentId ? 1 : 0,
    isFolder: true,
    isRoot: parentId === undefined,
    isUnmodifiable: false,
    isBookmarkBar: false,
    folderType: 'unknown',
  };
}

function mirrorRecords(
  sharedCount: number,
  leftOnlyCount: number,
  rightOnlyCount: number,
): BookmarkRecord[] {
  const records: BookmarkRecord[] = [folder('left'), folder('right')];

  for (let index = 0; index < sharedCount; index += 1) {
    const url = `https://shared.example.test/${index}`;
    records.push(
      bookmark(`left-shared-${index}`, url, 'left'),
      bookmark(`right-shared-${index}`, url, 'right'),
    );
  }
  for (let index = 0; index < leftOnlyCount; index += 1) {
    records.push(
      bookmark(
        `left-only-${index}`,
        `https://left.example.test/${index}`,
        'left',
      ),
    );
  }
  for (let index = 0; index < rightOnlyCount; index += 1) {
    records.push(
      bookmark(
        `right-only-${index}`,
        `https://right.example.test/${index}`,
        'right',
      ),
    );
  }

  return records;
}

function identicalSiblingMirrorRecords(folderCount: number): BookmarkRecord[] {
  const records: BookmarkRecord[] = [folder('root')];
  const urls = Array.from(
    { length: 5 },
    (_, index) => `https://identical.example.test/${index}`,
  );

  for (let index = 0; index < folderCount; index += 1) {
    const folderId = `mirror-${index.toString().padStart(3, '0')}`;
    records.push(folder(folderId, 'root'));
    urls.forEach((url, urlIndex) => {
      records.push(bookmark(`${folderId}-leaf-${urlIndex}`, url, folderId));
    });
  }

  return records;
}

function unrelatedIdenticalPairRecords(pairCount: number): BookmarkRecord[] {
  const records: BookmarkRecord[] = [];

  for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
    const pairId = pairIndex.toString().padStart(4, '0');
    const leftId = `pair-${pairId}-left`;
    const rightId = `pair-${pairId}-right`;
    records.push(folder(leftId), folder(rightId));
    for (let urlIndex = 0; urlIndex < 5; urlIndex += 1) {
      const url = `https://identical-pair.example.test/${pairId}/${urlIndex}`;
      records.push(
        bookmark(`${leftId}-leaf-${urlIndex}`, url, leftId),
        bookmark(`${rightId}-leaf-${urlIndex}`, url, rightId),
      );
    }
  }

  return records;
}

function denseNonIdenticalMirrorRecords(): BookmarkRecord[] {
  const records: BookmarkRecord[] = [folder('root')];
  const cliqueCount = 56;
  const foldersPerClique = 10;
  const sharedUrlsPerClique = 8;

  for (let clique = 0; clique < cliqueCount; clique += 1) {
    for (let member = 0; member < foldersPerClique; member += 1) {
      const folderId = `dense-${clique.toString().padStart(2, '0')}-${member}`;
      records.push(folder(folderId, 'root'));
      for (let urlIndex = 0; urlIndex < sharedUrlsPerClique; urlIndex += 1) {
        records.push(
          bookmark(
            `${folderId}-shared-${urlIndex}`,
            `https://dense.example.test/${clique}/shared/${urlIndex}`,
            folderId,
          ),
        );
      }
      records.push(
        bookmark(
          `${folderId}-unique`,
          `https://dense.example.test/${clique}/unique/${member}`,
          folderId,
        ),
      );
    }
  }

  return records;
}

describe('duplicate analyzer', () => {
  it('separates same-folder and multi-location exact URL groups while preserving query and fragment identity', () => {
    const sameUrl = 'https://example.test/page?mode=full#details';
    const crossUrl = 'https://example.test/other?mode=full#details';
    const analysis = analyzeDuplicates([
      bookmark('same-a', sameUrl, 'folder-a'),
      bookmark('same-b', sameUrl, 'folder-a'),
      bookmark('cross-a', crossUrl, 'folder-a'),
      bookmark('cross-b', crossUrl, 'folder-b'),
    ]);

    expect(
      analysis.groups.map(({ classification, reason, members }) => ({
        classification,
        reason,
        ids: members.map(({ id }) => id),
      })),
    ).toEqual([
      {
        classification: 'exact',
        reason: 'multi-location',
        ids: ['cross-a', 'cross-b'],
      },
      {
        classification: 'exact',
        reason: 'same-folder',
        ids: ['same-a', 'same-b'],
      },
    ]);
    expect(
      analysis.groups[1].evidence.find(({ type }) => type === 'exact-url')
        ?.detail,
    ).toBe(sameUrl);
  });

  it('normalizes only conservative URL differences and exposes every change', () => {
    const raw =
      'https://WWW.Example.COM:443/docs/?utm_source=newsletter&fbclid=abc&keep=1#section';
    const normalized = normalizeUrlCandidates(raw);

    expect(normalized?.conservativeKey).toBe(
      'https://example.com/docs?keep=1#section',
    );
    expect(normalized?.conservativeChanges.map(({ type }) => type)).toEqual([
      'host-lowercased',
      'www-removed',
      'default-port-removed',
      'trailing-slash-removed',
      'tracking-parameter-removed',
      'tracking-parameter-removed',
    ]);

    const analysis = analyzeDuplicates([
      bookmark('changed', raw),
      bookmark('canonical', 'https://example.com/docs?keep=1#section'),
    ]);
    const [group] = analysis.groups;

    expect(group).toMatchObject({
      classification: 'normalized-candidate',
      confidence: 'high',
      reason: 'conservative-normalization',
    });
    expect(
      group.evidence.flatMap(({ changes = [] }) =>
        changes.map(({ type }) => type),
      ),
    ).toEqual(expect.arrayContaining(['www-removed', 'default-port-removed']));
  });

  it('uses query and fragment removal only for loose manual candidates', () => {
    const analysis = analyzeDuplicates([
      bookmark(
        'edition-a',
        'https://example.test/article?edition=one#introduction',
      ),
      bookmark(
        'edition-b',
        'https://example.test/article?edition=two#appendix',
      ),
    ]);
    const [group] = analysis.groups;

    expect(group).toMatchObject({
      classification: 'loose-candidate',
      confidence: 'possible',
      reason: 'query-or-fragment-variation',
    });
    expect(
      group.evidence.flatMap(({ changes = [] }) =>
        changes.map(({ type }) => type),
      ),
    ).toEqual(expect.arrayContaining(['query-removed', 'fragment-removed']));
  });

  it('reports each bookmark in only the strongest matching level', () => {
    const analysis = analyzeDuplicates([
      bookmark('exact-a', 'https://exact.test/page?utm_source=mail'),
      bookmark('exact-b', 'https://exact.test/page?utm_source=mail'),
      bookmark('exact-variant', 'https://exact.test/page'),
      bookmark(
        'normalized-a',
        'https://www.normalized.test/docs/?utm_campaign=spring',
      ),
      bookmark('normalized-b', 'https://normalized.test/docs'),
      bookmark('loose-a', 'https://loose.test/item?view=a#top'),
      bookmark('loose-b', 'https://loose.test/item?view=b#bottom'),
    ]);

    expect(analysis.groups.map(({ classification }) => classification)).toEqual([
      'exact',
      'normalized-candidate',
      'loose-candidate',
    ]);
    const reportedIds = analysis.groups.flatMap(({ members }) =>
      members.map(({ id }) => id),
    );
    expect(new Set(reportedIds).size).toBe(reportedIds.length);
    expect(reportedIds).not.toContain('exact-variant');
  });

  it('keeps invalid and non-http URLs eligible for exact groups but never normalizes them', () => {
    const analysis = analyzeDuplicates([
      bookmark('file-a', 'file:///C:/notes/index.html'),
      bookmark('file-b', 'file:///C:/notes/index.html'),
      bookmark('file-query-a', 'file:///C:/notes/index.html?one'),
      bookmark('file-query-b', 'file:///C:/notes/index.html?two'),
      bookmark('invalid-a', 'not a valid URL'),
      bookmark('invalid-b', 'not a valid URL'),
      bookmark('invalid-other', 'not a valid URL?variant'),
    ]);

    expect(analysis.groups).toHaveLength(2);
    expect(analysis.groups.every(({ classification }) => classification === 'exact')).toBe(
      true,
    );
    expect(normalizeUrlCandidates('file:///C:/notes/index.html')).toBeUndefined();
    expect(normalizeUrlCandidates('not a valid URL')).toBeUndefined();
  });

  it('returns deeply immutable groups without selection or deletion state', () => {
    const analysis = analyzeDuplicates([
      bookmark('a', 'https://immutable.test/path'),
      bookmark('b', 'https://immutable.test/path'),
    ]);
    const [group] = analysis.groups;

    expect(Object.isFrozen(analysis)).toBe(true);
    expect(Object.isFrozen(analysis.groups)).toBe(true);
    expect(Object.isFrozen(group)).toBe(true);
    expect(Object.isFrozen(group.members)).toBe(true);
    expect(Object.isFrozen(group.members[0])).toBe(true);
    expect(Object.isFrozen(group.members[0].path)).toBe(true);
    expect(Object.isFrozen(group.evidence)).toBe(true);
    expect(group).not.toHaveProperty('selected');
    expect(group).not.toHaveProperty('delete');
    expect(group.members[0]).not.toHaveProperty('selected');
    expect(group.members[0]).not.toHaveProperty('delete');
  });
});

describe('mirror folder analysis', () => {
  it(
    'compresses 500 identical sibling folders into one deeply immutable suggestion',
    () => {
      const analysis = analyzeDuplicates(identicalSiblingMirrorRecords(500));

      expect(analysis.mirrorFolders).toHaveLength(1);
      const [suggestion] = analysis.mirrorFolders;
      expect(suggestion.folders).toHaveLength(500);
      expect(suggestion.folders.map(({ id }) => id)).toEqual(
        Array.from(
          { length: 500 },
          (_, index) => `mirror-${index.toString().padStart(3, '0')}`,
        ),
      );
      expect(suggestion.shared).toEqual(
        Array.from(
          { length: 5 },
          (_, index) => `https://identical.example.test/${index}`,
        ),
      );
      expect(suggestion.leftOnly).toEqual([]);
      expect(suggestion.rightOnly).toEqual([]);
      expect(suggestion.evidence[0]).toMatchObject({
        sharedCount: 5,
        unionCount: 5,
        jaccard: 1,
      });
      expect(analysis.mirrorCandidatePairs).toBe(0);
      expect(analysis.mirrorSharedUpdates).toBe(0);
      expect(analysis.mirrorTruncated).toBe(false);
      expect(Object.isFrozen(analysis)).toBe(true);
      expect(Object.isFrozen(analysis.mirrorFolders)).toBe(true);
      expect(Object.isFrozen(suggestion)).toBe(true);
      expect(Object.isFrozen(suggestion.folders)).toBe(true);
      expect(Object.isFrozen(suggestion.folders[0])).toBe(true);
      expect(Object.isFrozen(suggestion.folders[0].path)).toBe(true);
      expect(Object.isFrozen(suggestion.shared)).toBe(true);
      expect(Object.isFrozen(suggestion.leftOnly)).toBe(true);
      expect(Object.isFrozen(suggestion.rightOnly)).toBe(true);
      expect(Object.isFrozen(suggestion.evidence)).toBe(true);
      expect(Object.isFrozen(suggestion.evidence[0])).toBe(true);
    },
    30_000,
  );

  it('keeps exactly two identical folders as a ranked pair', () => {
    const analysis = analyzeDuplicates(mirrorRecords(5, 0, 0));

    expect(analysis.mirrorFolders).toHaveLength(1);
    expect(analysis.mirrorFolders[0].folders.map(({ id }) => id)).toEqual([
      'left',
      'right',
    ]);
    expect(analysis.mirrorFolders[0].evidence[0]).toMatchObject({
      sharedCount: 5,
      unionCount: 5,
      jaccard: 1,
    });
    expect(analysis.mirrorCandidatePairs).toBe(1);
    expect(analysis.mirrorSharedUpdates).toBe(5);
    expect(analysis.mirrorTruncated).toBe(false);
  });

  it('aggregates at least three most-specific identical folders', () => {
    const records: BookmarkRecord[] = [
      folder('ancestor'),
      folder('descendant', 'ancestor'),
      folder('unrelated-a'),
      folder('unrelated-b'),
    ];
    for (let index = 0; index < 5; index += 1) {
      const url = `https://specific-identical.example.test/${index}`;
      records.push(
        bookmark(`descendant-leaf-${index}`, url, 'descendant'),
        bookmark(`unrelated-a-leaf-${index}`, url, 'unrelated-a'),
        bookmark(`unrelated-b-leaf-${index}`, url, 'unrelated-b'),
      );
    }

    const analysis = analyzeDuplicates(records);

    expect(analysis.mirrorFolders).toHaveLength(1);
    expect(analysis.mirrorFolders[0].folders.map(({ id }) => id)).toEqual([
      'descendant',
      'unrelated-a',
      'unrelated-b',
    ]);
    expect(analysis.mirrorFolders[0].evidence[0].jaccard).toBe(1);
    expect(analysis.mirrorCandidatePairs).toBe(0);
    expect(analysis.mirrorSharedUpdates).toBe(0);
    expect(analysis.mirrorTruncated).toBe(false);
  });

  it('compares an identical group as one unit and flattens its folders', () => {
    const groupIds = ['group-a', 'group-b', 'group-c'];
    const records: BookmarkRecord[] = [
      ...groupIds.map((id) => folder(id)),
      folder('similar'),
    ];
    for (let index = 0; index < 9; index += 1) {
      const url = `https://group-unit.example.test/${index}`;
      groupIds.forEach((folderId) => {
        records.push(bookmark(`${folderId}-leaf-${index}`, url, folderId));
      });
      records.push(bookmark(`similar-leaf-${index}`, url, 'similar'));
    }
    records.push(
      bookmark(
        'similar-only',
        'https://group-unit.example.test/similar-only',
        'similar',
      ),
    );

    const analysis = analyzeDuplicates(records);
    const pairSuggestion = analysis.mirrorFolders.find(
      ({ folders }) => folders.length === 4,
    );

    expect(pairSuggestion?.folders.map(({ id }) => id)).toEqual([
      'group-a',
      'group-b',
      'group-c',
      'similar',
    ]);
    expect(pairSuggestion?.evidence[0]).toMatchObject({
      sharedCount: 9,
      unionCount: 10,
      jaccard: 0.9,
    });
    expect(analysis.mirrorCandidatePairs).toBe(1);
    expect(analysis.mirrorSharedUpdates).toBe(9);
  });

  it(
    'rate-limits unrelated pairs of exactly two identical folders',
    () => {
      const pairCount = duplicateAnalyzer.MIRROR_MAX_SUGGESTIONS + 1;
      const analysis = analyzeDuplicates(
        unrelatedIdenticalPairRecords(pairCount),
      );

      expect(analysis.mirrorFolders).toHaveLength(
        duplicateAnalyzer.MIRROR_MAX_SUGGESTIONS,
      );
      expect(
        analysis.mirrorFolders.every(({ folders }) => folders.length === 2),
      ).toBe(true);
      expect(analysis.mirrorCandidatePairs).toBe(pairCount);
      expect(analysis.mirrorSharedUpdates).toBe(pairCount * 5);
      expect(analysis.mirrorTruncated).toBe(true);
    },
    30_000,
  );

  it(
    'rate-limits dense non-identical mirror pairs and reports truncation',
    () => {
      const analysis = analyzeDuplicates(denseNonIdenticalMirrorRecords());
      const suggestionsPerFolder = new Map<string, number>();
      for (const suggestion of analysis.mirrorFolders) {
        for (const { id } of suggestion.folders) {
          suggestionsPerFolder.set(id, (suggestionsPerFolder.get(id) ?? 0) + 1);
        }
      }

      expect(
        [...suggestionsPerFolder.values()].every((count) => count <= 8),
      ).toBe(true);
      expect(analysis.mirrorFolders.length).toBeLessThanOrEqual(2_000);
      expect(analysis.mirrorCandidatePairs).toBe(2_520);
      expect(analysis.mirrorTruncated).toBe(true);
    },
    30_000,
  );

  it('exports the mirror suggestion limits', () => {
    expect(duplicateAnalyzer).toMatchObject({
      MIRROR_TOP_K: 8,
      MIRROR_MAX_SUGGESTIONS: 2_000,
    });
  });

  it('orders non-identical mirror suggestions by Jaccard before stable ids', () => {
    const records: BookmarkRecord[] = [
      folder('a-low-left'),
      folder('a-low-right'),
      folder('z-high-left'),
      folder('z-high-right'),
    ];
    for (let index = 0; index < 9; index += 1) {
      const url = `https://high-rank.example.test/${index}`;
      records.push(
        bookmark(`z-high-left-shared-${index}`, url, 'z-high-left'),
        bookmark(`z-high-right-shared-${index}`, url, 'z-high-right'),
      );
    }
    records.push(
      bookmark(
        'z-high-left-only',
        'https://high-rank.example.test/left-only',
        'z-high-left',
      ),
    );
    for (let index = 0; index < 8; index += 1) {
      const url = `https://low-rank.example.test/${index}`;
      records.push(
        bookmark(`a-low-left-shared-${index}`, url, 'a-low-left'),
        bookmark(`a-low-right-shared-${index}`, url, 'a-low-right'),
      );
    }
    records.push(
      bookmark(
        'a-low-left-only',
        'https://low-rank.example.test/left-only',
        'a-low-left',
      ),
      bookmark(
        'a-low-right-only',
        'https://low-rank.example.test/right-only',
        'a-low-right',
      ),
    );

    const analysis = analyzeDuplicates(records);

    expect(
      analysis.mirrorFolders.map(({ folders, evidence }) => ({
        folderIds: folders.map(({ id }) => id),
        jaccard: evidence[0].jaccard,
      })),
    ).toEqual([
      {
        folderIds: ['z-high-left', 'z-high-right'],
        jaccard: 0.9,
      },
      {
        folderIds: ['a-low-left', 'a-low-right'],
        jaccard: 0.8,
      },
    ]);
  });

  it('suggests stable folder pairs at five or more shared leaves and Jaccard 0.8', () => {
    const records = mirrorRecords(8, 1, 1);
    const forward = analyzeDuplicates(records).mirrorFolders;
    const reversed = analyzeDuplicates([...records].reverse()).mirrorFolders;

    expect(forward).toHaveLength(1);
    expect(forward[0]).toMatchObject({
      confidence: 'high',
      reason: 'mirror-folder-overlap',
      shared: Array.from(
        { length: 8 },
        (_, index) => `https://shared.example.test/${index}`,
      ),
      leftOnly: ['https://left.example.test/0'],
      rightOnly: ['https://right.example.test/0'],
    });
    expect(forward[0].folders.map(({ id }) => id)).toEqual(['left', 'right']);
    expect(forward[0].evidence[0]).toMatchObject({
      type: 'mirror-overlap',
      sharedCount: 8,
      unionCount: 10,
      jaccard: 0.8,
    });
    expect(reversed.map(({ id }) => id)).toEqual(forward.map(({ id }) => id));
  });

  it('uses every descendant leaf when computing a folder subtree', () => {
    const records = mirrorRecords(7, 0, 0);
    records.push(folder('left-child', 'left'), folder('right-child', 'right'));
    records.push(
      bookmark('left-nested', 'https://nested.example.test/value', 'left-child'),
      bookmark(
        'right-nested',
        'https://nested.example.test/value',
        'right-child',
      ),
    );

    const mirror = analyzeDuplicates(records).mirrorFolders.find(
      ({ folders }) => folders[0].id === 'left' && folders[1].id === 'right',
    );

    expect(mirror?.shared).toContain('https://nested.example.test/value');
    expect(mirror?.evidence[0].jaccard).toBe(1);
  });

  it('does not suggest folders with fewer than five common leaves', () => {
    expect(analyzeDuplicates(mirrorRecords(4, 0, 0)).mirrorFolders).toEqual([]);
  });

  it('does not suggest folders below the Jaccard threshold', () => {
    expect(analyzeDuplicates(mirrorRecords(5, 2, 2)).mirrorFolders).toEqual([]);
  });

  it('excludes ancestor and descendant folder pairs', () => {
    const records: BookmarkRecord[] = [folder('parent'), folder('child', 'parent')];
    for (let index = 0; index < 5; index += 1) {
      records.push(
        bookmark(
          `leaf-${index}`,
          `https://ancestor.example.test/${index}`,
          'child',
        ),
      );
    }

    expect(analyzeDuplicates(records).mirrorFolders).toEqual([]);
  });

  it('avoids all folder-pair candidates for a 5000-node star with unique URLs', () => {
    const records: BookmarkRecord[] = [folder('root')];
    const childFolderCount = 2_499;
    for (let index = 0; index < childFolderCount; index += 1) {
      const folderId = `folder-${index}`;
      records.push(folder(folderId, 'root'));
      records.push(
        bookmark(
          `leaf-${index}`,
          `https://unique.example.test/${index}`,
          folderId,
        ),
      );
    }
    records.push(
      bookmark(
        'extra-leaf',
        'https://unique.example.test/extra',
        'folder-0',
      ),
    );

    const analysis = analyzeDuplicates(records);

    expect(records).toHaveLength(5_000);
    expect(analysis.mirrorFolders).toEqual([]);
    expect(analysis.mirrorCandidatePairs).toBe(0);
  });

  it('does not index sub-five URL sets along a 750-level folder chain', () => {
    const depth = 750;
    const records: BookmarkRecord[] = [];
    for (let index = 0; index < depth; index += 1) {
      const id = `chain-${index.toString().padStart(3, '0')}`;
      records.push(
        folder(
          id,
          index === 0
            ? undefined
            : `chain-${(index - 1).toString().padStart(3, '0')}`,
        ),
      );
    }
    records.push(
      bookmark(
        'chain-leaf',
        'https://single.example.test/only',
        'chain-749',
      ),
    );

    const analysis = analyzeDuplicates(records);

    expect(records).toHaveLength(751);
    expect(analysis.mirrorIndexedFolders).toBe(0);
    expect(analysis.mirrorSharedUpdates).toBe(0);
    expect(analysis.mirrorCandidatePairs).toBe(0);
    expect(analysis.mirrorFolders).toEqual([]);
  });
});
