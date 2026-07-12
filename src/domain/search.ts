import { toUnicode } from 'punycode/punycode.es6.js';

import type { BookmarkRecord } from './bookmarks';
import { getPinyinForms } from './pinyin';

export type SearchReason =
  | 'title-exact'
  | 'title-prefix'
  | 'domain'
  | 'path'
  | 'url'
  | 'pinyin'
  | 'fuzzy';

export type SearchScope =
  | { kind: 'all' }
  | { kind: 'ids'; ids: ReadonlySet<string> };

export interface SearchEntry {
  node: BookmarkRecord;
  order: number;
  host: string;
  hostAliases: string[];
  title: string;
  url: string;
  decodedUrl: string;
  pathSegments: string[];
  fullPath: string;
  pinyinFull: string[];
  pinyinInitials: string[];
}

export interface SearchMatch {
  score: number;
  reasons: SearchReason[];
}

export interface SearchResult extends SearchMatch {
  node: BookmarkRecord;
  displayTitle: string;
}

export const SEARCH_REASON_SCORE: Readonly<Record<SearchReason, number>> = {
  'title-exact': 700,
  'title-prefix': 600,
  domain: 500,
  pinyin: 400,
  path: 300,
  url: 200,
  fuzzy: 100,
};

export function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

function extractHost(url: string): { display: string; aliases: string[] } {
  if (!url) {
    return { display: '', aliases: [] };
  }

  try {
    const parsedUrl = new URL(url);
    const asciiHost = normalizeSearchText(parsedUrl.host);
    const unicodeHostname = toUnicode(parsedUrl.hostname);
    const unicodeHost = normalizeSearchText(
      parsedUrl.port ? `${unicodeHostname}:${parsedUrl.port}` : unicodeHostname,
    );
    const aliases = [...new Set([unicodeHost, asciiHost])].filter(Boolean);
    return { display: asciiHost, aliases };
  } catch {
    return { display: '', aliases: [] };
  }
}

function decodeUrlForSearch(url: string): string {
  return url.replace(/(?:%[0-9a-f]{2})+/giu, (encodedRun) => {
    try {
      return decodeURIComponent(encodedRun);
    } catch {
      return encodedRun;
    }
  });
}

function uniquePinyinTerms(values: readonly string[]): {
  full: string[];
  initials: string[];
} {
  const full = new Set<string>();
  const initials = new Set<string>();

  for (const value of values) {
    const forms = getPinyinForms(value);
    if (forms.full) {
      full.add(forms.full);
    }
    if (forms.initials) {
      initials.add(forms.initials);
    }
  }

  return { full: [...full], initials: [...initials] };
}

function snapshotBookmarkRecord(node: BookmarkRecord): BookmarkRecord {
  const path = Object.freeze([...node.path]);
  return Object.freeze({ ...node, path });
}

export function createSearchEntry(
  node: BookmarkRecord,
  order: number,
): SearchEntry {
  const snapshot = snapshotBookmarkRecord(node);
  const rawUrl = snapshot.url ?? '';
  const host = extractHost(rawUrl);
  const pathSegments = snapshot.path.map(normalizeSearchText);
  const fullPath = normalizeSearchText(snapshot.path.join(' '));
  const pinyinTerms = uniquePinyinTerms([
    snapshot.title,
    ...snapshot.path,
    snapshot.path.join(' '),
  ]);

  return {
    node: snapshot,
    order,
    host: host.display,
    hostAliases: host.aliases,
    title: normalizeSearchText(snapshot.title),
    url: normalizeSearchText(rawUrl),
    decodedUrl: normalizeSearchText(decodeUrlForSearch(rawUrl)),
    pathSegments,
    fullPath,
    pinyinFull: pinyinTerms.full,
    pinyinInitials: pinyinTerms.initials,
  };
}

export function matchSearchEntry(
  entry: SearchEntry,
  query: string,
): SearchMatch | undefined {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return undefined;
  }

  const reasons: SearchReason[] = [];
  if (entry.title === normalizedQuery) {
    reasons.push('title-exact');
  } else if (entry.title.startsWith(normalizedQuery)) {
    reasons.push('title-prefix');
  }

  if (entry.hostAliases.some((host) => host.includes(normalizedQuery))) {
    reasons.push('domain');
  }

  const compactQuery = normalizedQuery.replace(/\s+/gu, '');
  if (
    entry.pinyinFull.some((value) => value.startsWith(compactQuery)) ||
    entry.pinyinInitials.some((value) => value.startsWith(compactQuery))
  ) {
    reasons.push('pinyin');
  }

  if (
    entry.fullPath.includes(normalizedQuery) ||
    entry.pathSegments.some((segment) => segment.includes(normalizedQuery))
  ) {
    reasons.push('path');
  }

  if (
    entry.url.includes(normalizedQuery) ||
    entry.decodedUrl.includes(normalizedQuery)
  ) {
    reasons.push('url');
  }

  if (reasons.length === 0) {
    return undefined;
  }

  reasons.sort(
    (left, right) => SEARCH_REASON_SCORE[right] - SEARCH_REASON_SCORE[left],
  );
  return { score: SEARCH_REASON_SCORE[reasons[0]], reasons };
}

function displayTitle(entry: SearchEntry): string {
  if (entry.node.title.trim()) {
    return entry.node.title;
  }
  if (entry.host) {
    return entry.host;
  }
  if (entry.node.url) {
    return entry.node.url;
  }
  return '仅图标显示';
}

export function createSearchResult(
  entry: SearchEntry,
  match: SearchMatch,
): SearchResult {
  return { node: entry.node, displayTitle: displayTitle(entry), ...match };
}
