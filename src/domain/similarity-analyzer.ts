import type { BookmarkRecord } from './bookmarks';

export type SimilarityEvidenceType =
  | 'title'
  | 'host-path'
  | 'folder-context'
  | 'title-conflict';

export interface SimilarityEvidence {
  readonly type: SimilarityEvidenceType;
  readonly detail: string;
  readonly score: number;
}

export interface SimilarityPair {
  readonly id: string;
  readonly confidence: 'high' | 'possible';
  readonly score: number;
  readonly reason:
    | 'title-similarity'
    | 'host-path-similarity'
    | 'metadata-similarity';
  readonly evidence: readonly SimilarityEvidence[];
  readonly members: readonly [BookmarkRecord, BookmarkRecord];
}

export interface TitleConflictGroup {
  readonly id: string;
  readonly confidence: 'high';
  readonly reason: 'title-conflict';
  readonly evidence: readonly SimilarityEvidence[];
  readonly members: readonly BookmarkRecord[];
}

export interface SimilarityAnalysis {
  readonly titleConflictGroups: readonly TitleConflictGroup[];
  readonly pairs: readonly SimilarityPair[];
  readonly candidateComparisons: number;
  readonly truncated: boolean;
}

interface PreparedBookmark {
  readonly record: BookmarkRecord;
  readonly title: string;
  readonly titleCompact: string;
  readonly titleBigrams: ReadonlySet<string>;
  readonly host: string;
  readonly path: string;
  readonly pathBigrams: ReadonlySet<string>;
  readonly blocks: readonly string[];
}

interface ScoredCandidate {
  readonly key: string;
  readonly left: PreparedBookmark;
  readonly right: PreparedBookmark;
  readonly titleScore: number;
  readonly hostPathScore: number;
  readonly preliminaryScore: number;
}

const MAX_BLOCK_SIZE_FOR_ALL_PAIRS = 64;
const LARGE_BLOCK_NEIGHBORS = 8;
export const SIMILARITY_TOP_K = 8;
export const SIMILARITY_MAX_PAIRS = 5_000;

function comparePrepared(
  left: PreparedBookmark,
  right: PreparedBookmark,
): number {
  return left.record.id.localeCompare(right.record.id);
}

function snapshotRecord(record: BookmarkRecord): BookmarkRecord {
  return Object.freeze({
    ...record,
    path: Object.freeze([...record.path]),
  });
}

function compact(value: string): string {
  return value.replace(/\s+/gu, '');
}

function bigrams(value: string): Set<string> {
  const characters = Array.from(value);
  const result = new Set<string>();
  for (let index = 0; index < characters.length - 1; index += 1) {
    result.add(`${characters[index]}${characters[index + 1]}`);
  }
  return result;
}

function dice(
  left: string,
  right: string,
  leftBigrams: ReadonlySet<string> = bigrams(left),
  rightBigrams: ReadonlySet<string> = bigrams(right),
): number {
  if (!left || !right) {
    return 0;
  }
  if (left === right) {
    return 1;
  }
  if (leftBigrams.size === 0 || rightBigrams.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const value of leftBigrams) {
    if (rightBigrams.has(value)) {
      shared += 1;
    }
  }
  return (2 * shared) / (leftBigrams.size + rightBigrams.size);
}

function parseHttpMetadata(
  rawUrl: string,
): { readonly host: string; readonly path: string } | undefined {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }
    let path = parsed.pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
      // Keep the encoded path when a malformed escape cannot be decoded.
    }
    return {
      host: parsed.host.toLowerCase(),
      path: compact(
        normalizeSimilarityTitle(path.replace(/^\/+|\/+$/gu, '')),
      ),
    };
  } catch {
    return undefined;
  }
}

function prepareBookmark(record: BookmarkRecord): PreparedBookmark {
  const title = normalizeSimilarityTitle(record.title);
  const titleCompact = compact(title);
  const titleBigrams = bigrams(titleCompact);
  const urlMetadata = parseHttpMetadata(record.url ?? '');
  const pathBigrams = bigrams(urlMetadata?.path ?? '');
  const blocks = new Set<string>();

  if (title) {
    const titleTokens = title.split(' ').filter(Boolean);
    for (const token of titleTokens) {
      if (token) {
        blocks.add(`title-token:${token}`);
      }
    }
    if (titleTokens.length === 1) {
      for (const value of titleBigrams) {
        blocks.add(`title-bigram:${value}`);
      }
    }
  }

  if (urlMetadata?.host) {
    blocks.add(`host:${urlMetadata.host}`);
  }

  return {
    record,
    title,
    titleCompact,
    titleBigrams,
    host: urlMetadata?.host ?? '',
    path: urlMetadata?.path ?? '',
    pathBigrams,
    blocks: [...blocks],
  };
}

function pairKey(left: PreparedBookmark, right: PreparedBookmark): string {
  const ids = [left.record.id, right.record.id].sort();
  return `${encodeURIComponent(ids[0])},${encodeURIComponent(ids[1])}`;
}

function preliminaryCandidate(
  left: PreparedBookmark,
  right: PreparedBookmark,
): ScoredCandidate | undefined {
  if (left.record.url === right.record.url) {
    return undefined;
  }
  const titleScore = dice(
    left.titleCompact,
    right.titleCompact,
    left.titleBigrams,
    right.titleBigrams,
  );
  const hostPathScore =
    left.host.length > 0 &&
    left.host === right.host &&
    left.path.length > 0 &&
    right.path.length > 0
      ? dice(left.path, right.path, left.pathBigrams, right.pathBigrams)
      : 0;
  const titleMatch = titleScore >= 0.68;
  const hostPathMatch = hostPathScore >= 0.72;
  if (!titleMatch && !hostPathMatch) {
    return undefined;
  }
  return {
    key: pairKey(left, right),
    left,
    right,
    titleScore,
    hostPathScore,
    preliminaryScore: Math.max(
      titleMatch ? titleScore : 0,
      hostPathMatch ? hostPathScore * 0.95 : 0,
    ),
  };
}

function candidatePairs(
  records: readonly BookmarkRecord[],
): {
  readonly candidates: readonly ScoredCandidate[];
  readonly truncated: boolean;
} {
  const prepared = records.map(prepareBookmark).sort(comparePrepared);
  const blocks = new Map<string, PreparedBookmark[]>();
  for (const bookmark of prepared) {
    for (const block of bookmark.blocks) {
      const members = blocks.get(block);
      if (members) {
        members.push(bookmark);
      } else {
        blocks.set(block, [bookmark]);
      }
    }
  }

  const orderedBlocks = [...blocks.entries()]
    .filter(([, members]) => members.length > 1)
    .sort(
      ([leftKey, leftMembers], [rightKey, rightMembers]) =>
        leftMembers.length - rightMembers.length ||
        leftKey.localeCompare(rightKey),
    );
  const rawCandidates = new Map<
    string,
    readonly [PreparedBookmark, PreparedBookmark]
  >();

  function addRawCandidate(
    left: PreparedBookmark,
    right: PreparedBookmark,
  ): void {
    if (left.record.id === right.record.id) {
      return;
    }
    const ordered: [PreparedBookmark, PreparedBookmark] =
      comparePrepared(left, right) <= 0 ? [left, right] : [right, left];
    const key = pairKey(ordered[0], ordered[1]);
    if (rawCandidates.has(key)) {
      return;
    }
    rawCandidates.set(key, Object.freeze(ordered));
  }

  for (const [block, blockMembers] of orderedBlocks) {
    const isTitleBlock = block.startsWith('title-');
    const members = [...blockMembers].sort((left, right) => {
      const leftValue = isTitleBlock ? left.titleCompact : left.path;
      const rightValue = isTitleBlock ? right.titleCompact : right.path;
      return leftValue.localeCompare(rightValue) || comparePrepared(left, right);
    });
    if (members.length <= MAX_BLOCK_SIZE_FOR_ALL_PAIRS) {
      for (let leftIndex = 0; leftIndex < members.length; leftIndex += 1) {
        for (
          let rightIndex = leftIndex + 1;
          rightIndex < members.length;
          rightIndex += 1
        ) {
          addRawCandidate(members[leftIndex], members[rightIndex]);
        }
      }
    } else {
      for (let leftIndex = 0; leftIndex < members.length; leftIndex += 1) {
        const end = Math.min(
          members.length,
          leftIndex + LARGE_BLOCK_NEIGHBORS + 1,
        );
        for (let rightIndex = leftIndex + 1; rightIndex < end; rightIndex += 1) {
          addRawCandidate(members[leftIndex], members[rightIndex]);
        }
      }
    }
  }

  const scoredCandidates = [...rawCandidates.values()]
    .map(([left, right]) => preliminaryCandidate(left, right))
    .filter(
      (candidate): candidate is ScoredCandidate => candidate !== undefined,
    )
    .sort(
      (left, right) =>
        right.preliminaryScore - left.preliminaryScore ||
        left.key.localeCompare(right.key),
    );
  const counts = new Map<string, number>();
  const selected: ScoredCandidate[] = [];
  let truncated = false;
  for (const candidate of scoredCandidates) {
    const leftId = candidate.left.record.id;
    const rightId = candidate.right.record.id;
    const leftCount = counts.get(leftId) ?? 0;
    const rightCount = counts.get(rightId) ?? 0;
    if (leftCount >= SIMILARITY_TOP_K || rightCount >= SIMILARITY_TOP_K) {
      truncated = true;
      continue;
    }
    selected.push(candidate);
    counts.set(leftId, leftCount + 1);
    counts.set(rightId, rightCount + 1);
  }

  return { candidates: selected, truncated };
}

function folderContextScore(
  left: BookmarkRecord,
  right: BookmarkRecord,
): number {
  if (left.parentId !== undefined && left.parentId === right.parentId) {
    return 1;
  }
  const leftFolders = new Set(
    left.path.map(normalizeSimilarityTitle).filter(Boolean),
  );
  const rightFolders = new Set(
    right.path.map(normalizeSimilarityTitle).filter(Boolean),
  );
  const union = new Set([...leftFolders, ...rightFolders]);
  if (union.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const value of leftFolders) {
    if (rightFolders.has(value)) {
      shared += 1;
    }
  }
  return shared / union.size;
}

function freezeEvidence(evidence: SimilarityEvidence): SimilarityEvidence {
  return Object.freeze(evidence);
}

function bookmarkRecords(
  records: readonly BookmarkRecord[],
): BookmarkRecord[] {
  const unique = new Map<string, BookmarkRecord>();
  for (const record of [...records].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    if (!record.isFolder && record.url !== undefined && !unique.has(record.id)) {
      unique.set(record.id, record);
    }
  }
  return [...unique.values()];
}

function titleConflictAnalysis(records: readonly BookmarkRecord[]): {
  readonly groups: TitleConflictGroup[];
  readonly memberIds: ReadonlySet<string>;
} {
  const recordsByTitle = new Map<string, BookmarkRecord[]>();
  for (const record of records) {
    const title = normalizeSimilarityTitle(record.title);
    if (!title) {
      continue;
    }
    const members = recordsByTitle.get(title);
    if (members) {
      members.push(record);
    } else {
      recordsByTitle.set(title, [record]);
    }
  }

  const memberIds = new Set<string>();
  const groups: TitleConflictGroup[] = [];
  for (const [title, recordsWithTitle] of recordsByTitle) {
    if (
      recordsWithTitle.length < 2 ||
      new Set(recordsWithTitle.map(({ url }) => url)).size < 2
    ) {
      continue;
    }
    recordsWithTitle.forEach(({ id }) => memberIds.add(id));
    const members = Object.freeze(
      [...recordsWithTitle]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(snapshotRecord),
    );
    groups.push(
      Object.freeze({
        id: `title-conflict:${encodeURIComponent(title)}`,
        confidence: 'high' as const,
        reason: 'title-conflict' as const,
        evidence: Object.freeze([
          freezeEvidence({
            type: 'title-conflict',
            detail: `${members.length} bookmarks share the normalized title while complete URLs differ.`,
            score: 1,
          }),
        ]),
        members,
      }),
    );
  }

  groups.sort((left, right) => left.id.localeCompare(right.id));
  return { groups, memberIds };
}

function createPair(
  candidate: ScoredCandidate,
): SimilarityPair | undefined {
  const { left, right, titleScore, hostPathScore } = candidate;
  if (left.record.url === right.record.url) {
    return undefined;
  }

  const hasTitleEvidence = titleScore >= 0.68;
  const hasHostPathEvidence = hostPathScore >= 0.72;
  if (!hasTitleEvidence && !hasHostPathEvidence) {
    return undefined;
  }

  const evidence: SimilarityEvidence[] = [];
  if (hasTitleEvidence) {
    evidence.push({
      type: 'title',
      detail: 'Normalized title character bigrams overlap.',
      score: titleScore,
    });
  }
  if (hasHostPathEvidence) {
    evidence.push({
      type: 'host-path',
      detail: 'Hosts match and normalized URL paths are highly similar.',
      score: hostPathScore,
    });
  }

  const contextScore = folderContextScore(left.record, right.record);
  if (contextScore > 0) {
    evidence.push({
      type: 'folder-context',
      detail: 'Folder paths provide supporting context only.',
      score: contextScore,
    });
  }

  const primaryScore = Math.max(
    hasTitleEvidence ? titleScore : 0,
    hasHostPathEvidence ? hostPathScore * 0.95 : 0,
  );
  const score = Math.min(
    1,
    Math.round((primaryScore + contextScore * 0.02) * 10_000) / 10_000,
  );
  const reason = hasTitleEvidence && hasHostPathEvidence
    ? 'metadata-similarity'
    : hasTitleEvidence
      ? 'title-similarity'
      : 'host-path-similarity';
  const ordered = [left.record, right.record].sort((first, second) =>
    first.id.localeCompare(second.id),
  );
  const members = Object.freeze([
    snapshotRecord(ordered[0]),
    snapshotRecord(ordered[1]),
  ]) as readonly [BookmarkRecord, BookmarkRecord];

  return Object.freeze({
    id: `similar:${members
      .map(({ id }) => encodeURIComponent(id))
      .join(',')}`,
    confidence: score >= 0.85 ? 'high' : 'possible',
    score,
    reason,
    evidence: Object.freeze(evidence.map(freezeEvidence)),
    members,
  });
}

export function normalizeSimilarityTitle(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s|｜:：\/\\_\-‐‑‒–—―·•・(){}\[\]<>《》【】「」『』]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function analyzeSimilarBookmarks(
  records: readonly BookmarkRecord[],
): SimilarityAnalysis {
  const bookmarks = bookmarkRecords(records);
  const conflicts = titleConflictAnalysis(bookmarks);
  const candidateAnalysis = candidatePairs(
    bookmarks.filter(({ id }) => !conflicts.memberIds.has(id)),
  );
  const rankedPairs = candidateAnalysis.candidates
    .map(createPair)
    .filter((pair): pair is SimilarityPair => pair !== undefined)
    .sort(
      (left, right) => right.score - left.score || left.id.localeCompare(right.id),
    );
  const truncatedByGlobalLimit = rankedPairs.length > SIMILARITY_MAX_PAIRS;
  const pairs = rankedPairs
    .slice(0, SIMILARITY_MAX_PAIRS)
    .sort((left, right) => left.id.localeCompare(right.id));

  return Object.freeze({
    titleConflictGroups: Object.freeze(conflicts.groups),
    pairs: Object.freeze(pairs),
    candidateComparisons: candidateAnalysis.candidates.length,
    truncated: candidateAnalysis.truncated || truncatedByGlobalLimit,
  });
}
