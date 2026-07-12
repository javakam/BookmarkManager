import type { BookmarkRecord } from './bookmarks';
import {
  normalizeUrlCandidates,
  type NormalizedUrlCandidates,
  type UrlChange,
} from './url-normalize';

export const MIRROR_TOP_K = 8;
export const MIRROR_MAX_SUGGESTIONS = 2_000;

export type DuplicateClassification =
  | 'exact'
  | 'normalized-candidate'
  | 'loose-candidate';

export type DuplicateConfidence = 'certain' | 'high' | 'possible';

export type DuplicateReason =
  | 'same-folder'
  | 'multi-location'
  | 'conservative-normalization'
  | 'query-or-fragment-variation';

export type DuplicateEvidenceType =
  | 'exact-url'
  | 'location'
  | 'normalization-change'
  | 'query-fragment-removed';

export interface DuplicateEvidence {
  readonly type: DuplicateEvidenceType;
  readonly detail: string;
  readonly memberId?: string;
  readonly changes?: readonly UrlChange[];
}

export interface DuplicateGroup {
  readonly id: string;
  readonly classification: DuplicateClassification;
  readonly confidence: DuplicateConfidence;
  readonly reason: DuplicateReason;
  readonly evidence: readonly DuplicateEvidence[];
  readonly members: readonly BookmarkRecord[];
}

export interface MirrorFolderEvidence {
  readonly type: 'mirror-overlap';
  readonly detail: string;
  readonly sharedCount: number;
  readonly unionCount: number;
  readonly jaccard: number;
}

export interface MirrorFolderSuggestion {
  readonly id: string;
  readonly confidence: 'high';
  readonly reason: 'mirror-folder-overlap';
  readonly folders: readonly BookmarkRecord[];
  readonly shared: readonly string[];
  readonly leftOnly: readonly string[];
  readonly rightOnly: readonly string[];
  readonly evidence: readonly MirrorFolderEvidence[];
}

export interface DuplicateAnalysis {
  readonly groups: readonly DuplicateGroup[];
  readonly mirrorFolders: readonly MirrorFolderSuggestion[];
  readonly mirrorCandidatePairs: number;
  readonly mirrorIndexedFolders: number;
  readonly mirrorSharedUpdates: number;
  readonly mirrorTruncated: boolean;
}

function compareIds(
  left: Pick<BookmarkRecord, 'id'>,
  right: Pick<BookmarkRecord, 'id'>,
): number {
  return left.id.localeCompare(right.id);
}

function snapshotRecord(record: BookmarkRecord): BookmarkRecord {
  return Object.freeze({
    ...record,
    path: Object.freeze([...record.path]),
  });
}

function stableId(prefix: string, members: readonly BookmarkRecord[]): string {
  return `${prefix}:${members
    .map(({ id }) => encodeURIComponent(id))
    .sort()
    .join(',')}`;
}

function groupRecords<T>(
  records: readonly BookmarkRecord[],
  keyFor: (record: BookmarkRecord) => T | undefined,
): Map<T, BookmarkRecord[]> {
  const groups = new Map<T, BookmarkRecord[]>();
  for (const record of records) {
    const key = keyFor(record);
    if (key === undefined) {
      continue;
    }
    const group = groups.get(key);
    if (group) {
      group.push(record);
    } else {
      groups.set(key, [record]);
    }
  }
  return groups;
}

function freezeEvidence(
  evidence: DuplicateEvidence,
): DuplicateEvidence {
  return Object.freeze({
    ...evidence,
    changes: evidence.changes
      ? Object.freeze([...evidence.changes])
      : undefined,
  });
}

function createDuplicateGroup(
  classification: DuplicateClassification,
  confidence: DuplicateConfidence,
  reason: DuplicateReason,
  records: readonly BookmarkRecord[],
  evidence: readonly DuplicateEvidence[],
): DuplicateGroup {
  const members = Object.freeze(
    [...records].sort(compareIds).map(snapshotRecord),
  );
  return Object.freeze({
    id: stableId(`duplicate:${classification}`, members),
    classification,
    confidence,
    reason,
    evidence: Object.freeze(evidence.map(freezeEvidence)),
    members,
  });
}

function exactGroups(
  records: readonly BookmarkRecord[],
  claimedIds: Set<string>,
): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const byUrl = groupRecords(records, ({ isFolder, url }) =>
    !isFolder && url !== undefined ? url : undefined,
  );

  for (const [url, members] of byUrl) {
    if (members.length < 2) {
      continue;
    }
    members.forEach(({ id }) => claimedIds.add(id));
    const parentIds = new Set(members.map(({ parentId }) => parentId));
    const reason: DuplicateReason =
      parentIds.size === 1 ? 'same-folder' : 'multi-location';
    groups.push(
      createDuplicateGroup('exact', 'certain', reason, members, [
        { type: 'exact-url', detail: url },
        {
          type: 'location',
          detail:
            reason === 'same-folder'
              ? 'All copies are in the same folder.'
              : 'Copies are stored in multiple folders.',
        },
      ]),
    );
  }

  return groups;
}

function normalizationEvidence(
  type: 'normalization-change' | 'query-fragment-removed',
  records: readonly BookmarkRecord[],
  normalized: ReadonlyMap<BookmarkRecord, NormalizedUrlCandidates>,
  changesFor: (candidate: NormalizedUrlCandidates) => readonly UrlChange[],
): DuplicateEvidence[] {
  return [...records].sort(compareIds).map((record) => {
    const changes = normalized.get(record)
      ? changesFor(normalized.get(record) as NormalizedUrlCandidates)
      : [];
    return {
      type,
      memberId: record.id,
      detail: changes.length
        ? changes.map((change) => change.type).join(', ')
        : 'No change on the canonical member.',
      changes,
    };
  });
}

function candidateGroups(
  records: readonly BookmarkRecord[],
  claimedIds: Set<string>,
): DuplicateGroup[] {
  const normalized = new Map<BookmarkRecord, NormalizedUrlCandidates>();
  for (const record of records) {
    if (claimedIds.has(record.id) || record.isFolder || record.url === undefined) {
      continue;
    }
    const candidate = normalizeUrlCandidates(record.url);
    if (candidate) {
      normalized.set(record, candidate);
    }
  }

  const groups: DuplicateGroup[] = [];
  const conservativeBuckets = groupRecords(
    [...normalized.keys()],
    (record) => normalized.get(record)?.conservativeKey,
  );
  for (const members of conservativeBuckets.values()) {
    if (
      members.length < 2 ||
      new Set(members.map(({ url }) => url)).size < 2 ||
      !members.some(
        (record) =>
          (normalized.get(record)?.conservativeChanges.length ?? 0) > 0,
      )
    ) {
      continue;
    }
    members.forEach(({ id }) => claimedIds.add(id));
    groups.push(
      createDuplicateGroup(
        'normalized-candidate',
        'high',
        'conservative-normalization',
        members,
        normalizationEvidence(
          'normalization-change',
          members,
          normalized,
          ({ conservativeChanges }) => conservativeChanges,
        ),
      ),
    );
  }

  const looseRecords = [...normalized.keys()].filter(
    ({ id }) => !claimedIds.has(id),
  );
  const looseBuckets = groupRecords(
    looseRecords,
    (record) => normalized.get(record)?.looseKey,
  );
  for (const members of looseBuckets.values()) {
    if (
      members.length < 2 ||
      new Set(members.map(({ url }) => url)).size < 2 ||
      !members.some(
        (record) => (normalized.get(record)?.looseChanges.length ?? 0) > 0,
      )
    ) {
      continue;
    }
    members.forEach(({ id }) => claimedIds.add(id));
    groups.push(
      createDuplicateGroup(
        'loose-candidate',
        'possible',
        'query-or-fragment-variation',
        members,
        normalizationEvidence(
          'query-fragment-removed',
          members,
          normalized,
          ({ looseChanges }) => looseChanges,
        ),
      ),
    );
  }

  return groups;
}

interface FolderInterval {
  readonly tin: number;
  tout: number;
}

function folderIntervals(
  folders: readonly BookmarkRecord[],
): ReadonlyMap<string, FolderInterval> {
  const folderIds = new Set(folders.map(({ id }) => id));
  const children = new Map<string, string[]>(
    folders.map(({ id }) => [id, []]),
  );
  const roots: string[] = [];
  for (const folder of folders) {
    if (folder.parentId !== undefined && folderIds.has(folder.parentId)) {
      children.get(folder.parentId)?.push(folder.id);
    } else {
      roots.push(folder.id);
    }
  }
  roots.sort();
  children.forEach((ids) => ids.sort());

  const intervals = new Map<string, FolderInterval>();
  const visited = new Set<string>();
  let time = 0;

  function visit(startId: string): void {
    const stack: { readonly id: string; readonly exiting: boolean }[] = [
      { id: startId, exiting: false },
    ];
    while (stack.length > 0) {
      const current = stack.pop() as {
        readonly id: string;
        readonly exiting: boolean;
      };
      if (current.exiting) {
        const interval = intervals.get(current.id);
        if (interval) {
          interval.tout = time;
          time += 1;
        }
        continue;
      }
      if (visited.has(current.id)) {
        continue;
      }
      visited.add(current.id);
      intervals.set(current.id, { tin: time, tout: -1 });
      time += 1;
      stack.push({ id: current.id, exiting: true });
      const childIds = children.get(current.id) ?? [];
      for (let index = childIds.length - 1; index >= 0; index -= 1) {
        stack.push({ id: childIds[index], exiting: false });
      }
    }
  }

  roots.forEach(visit);
  folders.map(({ id }) => id).sort().forEach(visit);
  return intervals;
}

function isAncestor(
  ancestorId: string,
  descendantId: string,
  intervals: ReadonlyMap<string, FolderInterval>,
): boolean {
  const ancestor = intervals.get(ancestorId);
  const descendant = intervals.get(descendantId);
  return Boolean(
    ancestor &&
      descendant &&
      ancestorId !== descendantId &&
      ancestor.tin <= descendant.tin &&
      descendant.tout <= ancestor.tout,
  );
}

function createMirrorFolderSuggestion(
  folders: readonly BookmarkRecord[],
  shared: readonly string[],
  leftOnly: readonly string[],
  rightOnly: readonly string[],
  sharedCount: number,
  unionCount: number,
  jaccard: number,
): MirrorFolderSuggestion {
  const folderSnapshots = Object.freeze(folders.map(snapshotRecord));
  const evidence = Object.freeze([
    Object.freeze({
      type: 'mirror-overlap' as const,
      detail: `${sharedCount} of ${unionCount} exact URLs are shared.`,
      sharedCount,
      unionCount,
      jaccard,
    }),
  ]);

  return Object.freeze({
    id: stableId('mirror', folderSnapshots),
    confidence: 'high' as const,
    reason: 'mirror-folder-overlap' as const,
    folders: folderSnapshots,
    shared: Object.freeze([...shared]),
    leftOnly: Object.freeze([...leftOnly]),
    rightOnly: Object.freeze([...rightOnly]),
    evidence,
  });
}

interface MirrorComparisonUnit {
  readonly id: string;
  readonly folders: readonly BookmarkRecord[];
  readonly urls: ReadonlySet<string>;
}

function mostSpecificFolders(
  folders: readonly BookmarkRecord[],
  intervals: ReadonlyMap<string, FolderInterval>,
): BookmarkRecord[] {
  const traversalOrder = [...folders].sort((left, right) => {
    const leftTin = intervals.get(left.id)?.tin ?? Number.MAX_SAFE_INTEGER;
    const rightTin = intervals.get(right.id)?.tin ?? Number.MAX_SAFE_INTEGER;
    return leftTin - rightTin || left.id.localeCompare(right.id);
  });

  // Same-signature descendants are contiguous in DFS order.
  return traversalOrder
    .filter((folder, index) => {
      const nextFolder = traversalOrder[index + 1];
      return (
        nextFolder === undefined ||
        !isAncestor(folder.id, nextFolder.id, intervals)
      );
    })
    .sort(compareIds);
}

function createMirrorComparisonUnit(
  folders: readonly BookmarkRecord[],
  urls: readonly string[],
): MirrorComparisonUnit {
  const sortedFolders = [...folders].sort(compareIds);
  return {
    id: stableId('mirror-unit', sortedFolders),
    folders: sortedFolders,
    urls: new Set(urls),
  };
}

function comparisonUnitsHaveAncestorRelation(
  left: MirrorComparisonUnit,
  right: MirrorComparisonUnit,
  intervals: ReadonlyMap<string, FolderInterval>,
): boolean {
  return left.folders.some((leftFolder) =>
    right.folders.some(
      (rightFolder) =>
        isAncestor(leftFolder.id, rightFolder.id, intervals) ||
        isAncestor(rightFolder.id, leftFolder.id, intervals),
    ),
  );
}

interface MirrorPairCandidate {
  readonly id: string;
  readonly leftUnit: MirrorComparisonUnit;
  readonly rightUnit: MirrorComparisonUnit;
  readonly folders: readonly BookmarkRecord[];
  readonly sharedCount: number;
  readonly unionCount: number;
  readonly jaccard: number;
}

function mirrorFolderSuggestions(
  records: readonly BookmarkRecord[],
): {
  readonly suggestions: MirrorFolderSuggestion[];
  readonly candidatePairs: number;
  readonly indexedFolders: number;
  readonly sharedUpdates: number;
  readonly truncated: boolean;
} {
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const folders = records.filter(({ isFolder }) => isFolder).sort(compareIds);
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  const intervals = folderIntervals(folders);
  const urlsByFolder = new Map<string, Set<string>>(
    folders.map(({ id }) => [id, new Set<string>()]),
  );

  for (const record of records) {
    if (record.isFolder || record.url === undefined) {
      continue;
    }
    const visited = new Set<string>();
    let parentId = record.parentId;
    while (parentId !== undefined && !visited.has(parentId)) {
      visited.add(parentId);
      urlsByFolder.get(parentId)?.add(record.url);
      parentId = recordsById.get(parentId)?.parentId;
    }
  }

  const identicalFoldersBySignature = new Map<
    string,
    { readonly urls: readonly string[]; readonly folderIds: string[] }
  >();
  let indexedFolders = 0;
  for (const [folderId, urls] of urlsByFolder) {
    if (urls.size < 5) {
      continue;
    }
    indexedFolders += 1;
    const sortedUrls = [...urls].sort();
    const signature = JSON.stringify(sortedUrls);
    const identicalFolders = identicalFoldersBySignature.get(signature);
    if (identicalFolders) {
      identicalFolders.folderIds.push(folderId);
    } else {
      identicalFoldersBySignature.set(signature, {
        urls: sortedUrls,
        folderIds: [folderId],
      });
    }
  }

  const comparisonUnits: MirrorComparisonUnit[] = [];
  const identicalSuggestions: MirrorFolderSuggestion[] = [];
  for (const { urls, folderIds } of identicalFoldersBySignature.values()) {
    const signatureFolders = folderIds.map(
      (folderId) => foldersById.get(folderId) as BookmarkRecord,
    );
    const specificFolders = mostSpecificFolders(signatureFolders, intervals);
    if (specificFolders.length >= 3) {
      comparisonUnits.push(createMirrorComparisonUnit(specificFolders, urls));
      identicalSuggestions.push(
        createMirrorFolderSuggestion(
          specificFolders,
          urls,
          [],
          [],
          urls.length,
          urls.length,
          1,
        ),
      );
    } else {
      specificFolders.forEach((folder) => {
        comparisonUnits.push(createMirrorComparisonUnit([folder], urls));
      });
    }
  }
  comparisonUnits.sort((left, right) => left.id.localeCompare(right.id));

  const unitIndexesByUrl = new Map<string, number[]>();
  comparisonUnits.forEach((unit, unitIndex) => {
    for (const url of unit.urls) {
      const unitIndexes = unitIndexesByUrl.get(url);
      if (unitIndexes) {
        unitIndexes.push(unitIndex);
      } else {
        unitIndexesByUrl.set(url, [unitIndex]);
      }
    }
  });

  const sharedCounts = new Map<
    string,
    {
      readonly leftUnitIndex: number;
      readonly rightUnitIndex: number;
      count: number;
    }
  >();
  const unitPairHasAncestorRelation = new Map<string, boolean>();
  let sharedUpdates = 0;
  for (const unitIndexes of unitIndexesByUrl.values()) {
    for (let leftIndex = 0; leftIndex < unitIndexes.length; leftIndex += 1) {
      const leftUnitIndex = unitIndexes[leftIndex];
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < unitIndexes.length;
        rightIndex += 1
      ) {
        const rightUnitIndex = unitIndexes[rightIndex];
        const key = `${leftUnitIndex},${rightUnitIndex}`;
        let hasAncestorRelation = unitPairHasAncestorRelation.get(key);
        if (hasAncestorRelation === undefined) {
          hasAncestorRelation = comparisonUnitsHaveAncestorRelation(
            comparisonUnits[leftUnitIndex],
            comparisonUnits[rightUnitIndex],
            intervals,
          );
          unitPairHasAncestorRelation.set(key, hasAncestorRelation);
        }
        if (hasAncestorRelation) {
          continue;
        }
        sharedUpdates += 1;
        const existing = sharedCounts.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          sharedCounts.set(key, {
            leftUnitIndex,
            rightUnitIndex,
            count: 1,
          });
        }
      }
    }
  }

  const candidates = [...sharedCounts.values()].filter(
    ({ count }) => count >= 5,
  );

  const rankedPairCandidates: MirrorPairCandidate[] = [];
  for (const {
    leftUnitIndex,
    rightUnitIndex,
    count: sharedCount,
  } of candidates) {
    const leftUnit = comparisonUnits[leftUnitIndex];
    const rightUnit = comparisonUnits[rightUnitIndex];
    const unionCount = leftUnit.urls.size + rightUnit.urls.size - sharedCount;
    const jaccard = sharedCount / unionCount;
    if (jaccard < 0.8) {
      continue;
    }
    const candidateFolders = [...leftUnit.folders, ...rightUnit.folders].sort(
      compareIds,
    );
    rankedPairCandidates.push({
      id: stableId('mirror', candidateFolders),
      leftUnit,
      rightUnit,
      folders: candidateFolders,
      sharedCount,
      unionCount,
      jaccard,
    });
  }
  rankedPairCandidates.sort(
    (left, right) =>
      right.jaccard - left.jaccard ||
      right.sharedCount - left.sharedCount ||
      left.id.localeCompare(right.id),
  );

  const pairSuggestions: MirrorFolderSuggestion[] = [];
  const suggestionsPerFolder = new Map<string, number>();
  let truncated = false;
  for (const {
    leftUnit,
    rightUnit,
    folders: candidateFolders,
    sharedCount,
    unionCount,
    jaccard,
  } of rankedPairCandidates) {
    if (pairSuggestions.length >= MIRROR_MAX_SUGGESTIONS) {
      truncated = true;
      break;
    }
    if (
      candidateFolders.some(
        ({ id }) => (suggestionsPerFolder.get(id) ?? 0) >= MIRROR_TOP_K,
      )
    ) {
      truncated = true;
      continue;
    }
    const shared = [...leftUnit.urls]
      .filter((url) => rightUnit.urls.has(url))
      .sort();
    const leftOnly = [...leftUnit.urls]
      .filter((url) => !rightUnit.urls.has(url))
      .sort();
    const rightOnly = [...rightUnit.urls]
      .filter((url) => !leftUnit.urls.has(url))
      .sort();
    pairSuggestions.push(
      createMirrorFolderSuggestion(
        candidateFolders,
        shared,
        leftOnly,
        rightOnly,
        sharedCount,
        unionCount,
        jaccard,
      ),
    );
    candidateFolders.forEach(({ id }) => {
      suggestionsPerFolder.set(id, (suggestionsPerFolder.get(id) ?? 0) + 1);
    });
  }

  return {
    suggestions: [
      ...identicalSuggestions.sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
      ...pairSuggestions,
    ],
    candidatePairs: candidates.length,
    indexedFolders,
    sharedUpdates,
    truncated,
  };
}

export function analyzeDuplicates(
  records: readonly BookmarkRecord[],
): DuplicateAnalysis {
  const sortedRecords = [...records].sort(compareIds);
  const claimedIds = new Set<string>();
  const classificationOrder: Readonly<Record<DuplicateClassification, number>> = {
    exact: 0,
    'normalized-candidate': 1,
    'loose-candidate': 2,
  };
  const groups = [
    ...exactGroups(sortedRecords, claimedIds),
    ...candidateGroups(sortedRecords, claimedIds),
  ].sort(
    (left, right) =>
      classificationOrder[left.classification] -
        classificationOrder[right.classification] ||
      left.id.localeCompare(right.id),
  );
  const mirrorAnalysis = mirrorFolderSuggestions(sortedRecords);

  return Object.freeze({
    groups: Object.freeze(groups),
    mirrorFolders: Object.freeze(mirrorAnalysis.suggestions),
    mirrorCandidatePairs: mirrorAnalysis.candidatePairs,
    mirrorIndexedFolders: mirrorAnalysis.indexedFolders,
    mirrorSharedUpdates: mirrorAnalysis.sharedUpdates,
    mirrorTruncated: mirrorAnalysis.truncated,
  });
}
