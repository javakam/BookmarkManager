import Fuse from 'fuse.js';

import type { BookmarkRecord } from '../domain/bookmarks';
import {
  createSearchEntry,
  createSearchResult,
  matchSearchEntry,
  normalizeSearchText,
  SEARCH_REASON_SCORE,
  type SearchEntry,
  type SearchResult,
  type SearchScope,
} from '../domain/search';

export type { SearchResult, SearchScope } from '../domain/search';

export class BookmarkIndex {
  private entries: SearchEntry[] = [];
  private positions = new Map<string, number>();
  private nextOrder = 0;
  private readonly fuse = new Fuse<SearchEntry>([], {
    includeScore: true,
    ignoreFieldNorm: true,
    ignoreLocation: true,
    keys: [
      { name: 'title', weight: 0.35 },
      { name: 'host', weight: 0.2 },
      { name: 'pinyinFull', weight: 0.15 },
      { name: 'pinyinInitials', weight: 0.1 },
    ],
    minMatchCharLength: 1,
    shouldSort: false,
    threshold: 0.5,
  });

  constructor(nodes: readonly BookmarkRecord[] = []) {
    this.refresh(nodes);
  }

  refresh(nodes: readonly BookmarkRecord[]): void {
    const entries: SearchEntry[] = [];
    const positions = new Map<string, number>();

    for (const node of nodes) {
      const existingPosition = positions.get(node.id);
      if (existingPosition === undefined) {
        const position = entries.length;
        positions.set(node.id, position);
        entries.push(createSearchEntry(node, position));
      } else {
        entries[existingPosition] = createSearchEntry(node, existingPosition);
      }
    }

    this.entries = entries;
    this.positions = positions;
    this.nextOrder = entries.length;
    this.updateFuse();
  }

  upsert(node: BookmarkRecord): void {
    const position = this.positions.get(node.id);
    if (position === undefined) {
      this.positions.set(node.id, this.entries.length);
      this.entries.push(createSearchEntry(node, this.nextOrder));
      this.nextOrder += 1;
    } else {
      const order = this.entries[position].order;
      this.entries[position] = createSearchEntry(node, order);
    }
    this.updateFuse();
  }

  remove(id: string): void {
    const position = this.positions.get(id);
    if (position !== undefined) {
      this.entries.splice(position, 1);
      this.rebuildPositions();
    }
    this.updateFuse();
  }

  search(
    query: string,
    scope: SearchScope = { kind: 'all' },
    limit = 200,
  ): SearchResult[] {
    const normalizedQuery = normalizeSearchText(query);
    const resultLimit = Math.max(0, Math.floor(limit));
    if (!normalizedQuery || resultLimit === 0) {
      return [];
    }

    const matches = new Map<
      string,
      { entry: SearchEntry; result: SearchResult }
    >();
    const isInScope = (entry: SearchEntry): boolean =>
      scope.kind === 'all' || scope.ids.has(entry.node.id);

    for (const entry of this.entries) {
      if (!isInScope(entry)) {
        continue;
      }
      const match = matchSearchEntry(entry, normalizedQuery);
      if (match) {
        matches.set(entry.node.id, {
          entry,
          result: createSearchResult(entry, match),
        });
      }
    }

    if ([...normalizedQuery].length >= 2 && matches.size < resultLimit) {
      for (const fuzzyMatch of this.fuse.search(normalizedQuery)) {
        const entry = fuzzyMatch.item;
        if (!isInScope(entry) || matches.has(entry.node.id)) {
          continue;
        }
        const fuseScore = Math.min(1, Math.max(0, fuzzyMatch.score ?? 1));
        const score = SEARCH_REASON_SCORE.fuzzy - fuseScore;
        matches.set(entry.node.id, {
          entry,
          result: createSearchResult(entry, {
            score,
            reasons: ['fuzzy'],
          }),
        });
      }
    }

    return [...matches.values()]
      .sort(
        (left, right) =>
          right.result.score - left.result.score ||
          left.entry.order - right.entry.order,
      )
      .slice(0, resultLimit)
      .map(({ result }) => result);
  }

  private rebuildPositions(): void {
    this.positions = new Map(
      this.entries.map((entry, position) => [entry.node.id, position]),
    );
  }

  private updateFuse(): void {
    this.fuse.setCollection(this.entries);
  }
}
