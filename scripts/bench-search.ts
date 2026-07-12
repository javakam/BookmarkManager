import { performance } from 'node:perf_hooks';

import { BookmarkIndex } from '../src/app/bookmark-index';
import type { BookmarkRecord } from '../src/domain/bookmarks';

const RECORD_COUNT = 5_000;
const MAX_P95_MS = 100;
const MIN_SAMPLE_COUNT = 200;
const WARMUP_ROUNDS = 5;
const MEASURED_ROUNDS = 12;
const topics = [
  'TypeScript',
  'React',
  'Postgres',
  'Testing',
  'Performance',
  'Design Systems',
  'Web Extensions',
  'Security',
] as const;

function createRecord(index: number): BookmarkRecord {
  const topic = topics[index % topics.length];
  const title =
    index % 97 === 0 ? `中文文档 ${index}` : `${topic} Reference ${index}`;

  return {
    id: `bookmark-${index}`,
    parentId: `folder-${index % 50}`,
    index,
    title,
    url: `https://docs-${index % 100}.example.test/${topic
      .toLowerCase()
      .replace(/\s+/gu, '-')}/item-${index}?source=benchmark`,
    path: [
      'Bookmarks Bar',
      `Team ${index % 25}`,
      `${topic} Collection`,
    ],
    depth: 3,
    isFolder: false,
    isRoot: false,
    isUnmodifiable: false,
    isBookmarkBar: true,
    folderType: 'unknown',
    dateAdded: 1_700_000_000_000 + index,
  };
}

const queryPool = [
  'typescript reference 0',
  'react reference',
  'docs-42.example.test',
  'item-4999',
  'team 7',
  'performance collection',
  'web extensions',
  'security reference',
  'zhongwen',
  'zwwd',
  '中文',
  'typescipt',
  'postgrs',
  'desgn systems',
  'benchmark',
  'source=benchmark',
  'docs-3',
  'team 24 testing',
  'reference 4096',
  'item-2500',
] as const;

function createDeterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function createQuerySamples(rounds: number, seed: number): string[] {
  const random = createDeterministicRandom(seed);
  const samples: string[] = [];

  for (let round = 0; round < rounds; round += 1) {
    const rotation = [...queryPool];
    for (let index = rotation.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      const value = rotation[index];
      rotation[index] = rotation[swapIndex];
      rotation[swapIndex] = value;
    }
    samples.push(...rotation);
  }

  return samples;
}

const records = Array.from({ length: RECORD_COUNT }, (_, index) =>
  createRecord(index),
);
const bookmarkIndex = new BookmarkIndex(records);
const warmupQueries = createQuerySamples(WARMUP_ROUNDS, 0x5eed1234);
const measuredQueries = createQuerySamples(MEASURED_ROUNDS, 0xc0de2026);

if (measuredQueries.length < MIN_SAMPLE_COUNT) {
  throw new Error(
    `search benchmark requires at least ${MIN_SAMPLE_COUNT} measured samples`,
  );
}

for (const query of warmupQueries) {
  bookmarkIndex.search(query);
}

const samples = measuredQueries.map((query) => {
  const startedAt = performance.now();
  bookmarkIndex.search(query);
  return { query, duration: performance.now() - startedAt };
});
const sortedDurations = samples
  .map(({ duration }) => duration)
  .sort((left, right) => left - right);
const percentileIndex = Math.ceil(sortedDurations.length * 0.95) - 1;
const p95 = sortedDurations[percentileIndex];
const max = sortedDurations[sortedDurations.length - 1];

console.log(
  `search benchmark: records=${RECORD_COUNT}, warmup=${warmupQueries.length}, samples=${samples.length}, p95=${p95.toFixed(3)}ms, max=${max.toFixed(3)}ms`,
);

if (!Number.isFinite(p95) || p95 <= 0 || p95 >= MAX_P95_MS) {
  const slowest = [...samples]
    .sort((left, right) => right.duration - left.duration)
    .slice(0, 5)
    .map(({ query, duration }) => `${query}=${duration.toFixed(3)}ms`)
    .join(', ');
  console.error(
    `search benchmark failed: expected 0 < p95 < ${MAX_P95_MS}ms; slowest: ${slowest}`,
  );
  process.exitCode = 1;
}
