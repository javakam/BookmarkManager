import { useCallback, useEffect, useRef, useState } from 'react';

import type { BookmarkRecord } from '../domain/bookmarks';
import { flattenBookmarkTree } from '../domain/tree';
import type { BookmarkRepository } from '../platform/bookmark-repository';

export interface BookmarkDataState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly records: readonly BookmarkRecord[];
  readonly revision: number;
  readonly error?: string;
  readonly refresh: () => Promise<void>;
}

interface BookmarkSnapshot {
  readonly status: BookmarkDataState['status'];
  readonly records: readonly BookmarkRecord[];
  readonly revision: number;
  readonly error?: string;
}

const INITIAL_SNAPSHOT: BookmarkSnapshot = {
  status: 'loading',
  records: [],
  revision: 0,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '读取书签失败';
}

export function useBookmarks(
  repository: BookmarkRepository,
): BookmarkDataState {
  const [snapshot, setSnapshot] = useState<BookmarkSnapshot>(INITIAL_SNAPSHOT);
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setSnapshot((current) => ({
      ...current,
      status: 'loading',
      error: undefined,
    }));

    try {
      const records = flattenBookmarkTree(await repository.getTree());
      if (requestId !== requestSequence.current) {
        return;
      }
      setSnapshot((current) => ({
        status: 'ready',
        records,
        revision: current.revision + 1,
      }));
    } catch (error) {
      if (requestId !== requestSequence.current) {
        return;
      }
      setSnapshot((current) => ({
        ...current,
        status: 'error',
        error: errorMessage(error),
      }));
    }
  }, [repository]);

  useEffect(() => {
    void refresh();
    const unsubscribe = repository.onChanged(() => {
      void refresh();
    });

    return () => {
      requestSequence.current += 1;
      unsubscribe();
    };
  }, [refresh, repository]);

  return { ...snapshot, refresh };
}
