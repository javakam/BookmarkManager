import { performance } from 'node:perf_hooks';

import type { BookmarkRecord } from '../src/domain/bookmarks';
import { analyzeDuplicates } from '../src/domain/duplicate-analyzer';
import {
  analyzeSimilarBookmarks,
  SIMILARITY_MAX_PAIRS,
} from '../src/domain/similarity-analyzer';

const FOLDER_COUNT = 1_000;
const BOOKMARKS_PER_FOLDER = 6;
const MAX_DURATION_MS = 1_500;
const MAX_RETAINED_HEAP_MB = 32;

function folder(index: number): BookmarkRecord {
  return {
    id: `folder-${index}`,
    parentId: 'root',
    index,
    title: `Folder ${index}`,
    path: ['Bookmarks Bar'],
    depth: 1,
    isFolder: true,
    isRoot: false,
    isUnmodifiable: false,
    isBookmarkBar: true,
    folderType: 'unknown',
  };
}

function bookmark(folderIndex: number, itemIndex: number): BookmarkRecord {
  const urlIndex =
    (folderIndex * 3 + itemIndex) %
    (FOLDER_COUNT * Math.floor(BOOKMARKS_PER_FOLDER / 2));
  return {
    id: `bookmark-${folderIndex}-${itemIndex}`,
    parentId: `folder-${folderIndex}`,
    index: itemIndex,
    title: `Resource ${urlIndex}`,
    url: `https://resources.example.test/item/${urlIndex}`,
    path: ['Bookmarks Bar', `Folder ${folderIndex}`],
    depth: 2,
    isFolder: false,
    isRoot: false,
    isUnmodifiable: false,
    isBookmarkBar: true,
    folderType: 'unknown',
  };
}

globalThis.gc?.();
const records: BookmarkRecord[] = [
  {
    id: 'root',
    index: 0,
    title: '',
    path: [],
    depth: 0,
    isFolder: true,
    isRoot: true,
    isUnmodifiable: false,
    isBookmarkBar: false,
    folderType: 'unknown',
  },
  ...Array.from({ length: FOLDER_COUNT }, (_, index) => folder(index)),
];
for (let folderIndex = 0; folderIndex < FOLDER_COUNT; folderIndex += 1) {
  for (let itemIndex = 0; itemIndex < BOOKMARKS_PER_FOLDER; itemIndex += 1) {
    records.push(bookmark(folderIndex, itemIndex));
  }
}

globalThis.gc?.();
const heapBefore = process.memoryUsage().heapUsed;
const startedAt = performance.now();
const duplicates = analyzeDuplicates(records);
const similar = analyzeSimilarBookmarks(records);
const duration = performance.now() - startedAt;
globalThis.gc?.();
const retainedHeapMb = Math.max(
  0,
  (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024,
);
const similarityResultCount =
  similar.titleConflictGroups.length + similar.pairs.length;

console.log(
  `organize benchmark: records=${records.length}, duration=${duration.toFixed(1)}ms, retainedHeap=${retainedHeapMb.toFixed(1)}MB, duplicateGroups=${duplicates.groups.length}, similarityResults=${similarityResultCount}`,
);

if (!Number.isFinite(duration) || duration <= 0 || duration >= MAX_DURATION_MS) {
  console.error(
    `organize benchmark failed: expected 0 < duration < ${MAX_DURATION_MS}ms`,
  );
  process.exitCode = 1;
}

if (!Number.isFinite(retainedHeapMb) || retainedHeapMb >= MAX_RETAINED_HEAP_MB) {
  console.error(
    `organize benchmark failed: expected retained heap < ${MAX_RETAINED_HEAP_MB}MB`,
  );
  process.exitCode = 1;
}

if (similar.pairs.length > SIMILARITY_MAX_PAIRS || !similar.truncated) {
  console.error('organize benchmark failed: similarity result bounds regressed');
  process.exitCode = 1;
}
