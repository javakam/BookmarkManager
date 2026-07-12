import { useCallback, useEffect, useRef, useState } from 'react';

import type { BookmarkRecord } from '../domain/bookmarks';
import { flattenBookmarkTree } from '../domain/tree';
import type {
  BookmarkRepository,
  BookmarkRepositoryChange,
} from '../platform/bookmark-repository';

export interface BookmarkDataState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly records: readonly BookmarkRecord[];
  readonly revision: number;
  readonly error?: string;
  readonly lastUpdatedAt?: number;
  readonly isImporting: boolean;
  readonly refresh: () => Promise<void>;
}

interface BookmarkSnapshot {
  readonly status: BookmarkDataState['status'];
  readonly records: readonly BookmarkRecord[];
  readonly revision: number;
  readonly error?: string;
  readonly lastUpdatedAt?: number;
  readonly isImporting: boolean;
}

const INITIAL_SNAPSHOT: BookmarkSnapshot = {
  status: 'loading',
  records: [],
  revision: 0,
  isImporting: false,
};

const REFRESH_DEBOUNCE_MS = 200;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '读取书签失败';
}

export function useBookmarks(
  repository: BookmarkRepository,
): BookmarkDataState {
  const [snapshot, setSnapshot] = useState<BookmarkSnapshot>(INITIAL_SNAPSHOT);
  const requestSequence = useRef(0);
  const inFlight = useRef<Promise<void> | undefined>(undefined);
  const inFlightRequestId = useRef<number | undefined>(undefined);
  const dirty = useRef(false);
  const isImporting = useRef(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const forceAfterFlight = useRef(false);
  const isDisposed = useRef(true);
  const refreshAction = useRef<() => Promise<void>>(async () => {});

  const refresh = useCallback(() => refreshAction.current(), []);

  useEffect(() => {
    let isActive = true;
    isDisposed.current = false;
    inFlight.current = undefined;
    inFlightRequestId.current = undefined;
    dirty.current = false;
    isImporting.current = false;
    forceAfterFlight.current = false;
    setSnapshot((current) => ({
      ...current,
      isImporting: false,
    }));

    const clearRefreshTimer = () => {
      if (refreshTimer.current !== undefined) {
        clearTimeout(refreshTimer.current);
        refreshTimer.current = undefined;
      }
    };

    const scheduleRefresh = () => {
      if (!isActive || isDisposed.current || isImporting.current) {
        return;
      }

      dirty.current = true;
      clearRefreshTimer();
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = undefined;
        if (!isActive || isDisposed.current || isImporting.current) {
          return;
        }
        if (inFlight.current !== undefined) {
          return;
        }

        dirty.current = false;
        void startRead();
      }, REFRESH_DEBOUNCE_MS);
    };

    const startRead = (): Promise<void> => {
      const requestId = ++requestSequence.current;
      setSnapshot((current) => ({
        ...current,
        status: 'loading',
        error: undefined,
      }));

      const read = (async () => {
        try {
          const records = flattenBookmarkTree(await repository.getTree());
          if (
            !isActive ||
            isDisposed.current ||
            isImporting.current ||
            requestId !== requestSequence.current
          ) {
            return;
          }
          setSnapshot((current) => ({
            status: 'ready',
            records,
            revision: current.revision + 1,
            lastUpdatedAt: Date.now(),
            isImporting: false,
          }));
        } catch (error) {
          if (
            !isActive ||
            isDisposed.current ||
            requestId !== requestSequence.current
          ) {
            return;
          }
          setSnapshot((current) => ({
            ...current,
            status: 'error',
            error: errorMessage(error),
          }));
        }
      })();

      inFlight.current = read;
      inFlightRequestId.current = requestId;
      void read.finally(() => {
        if (inFlightRequestId.current !== requestId) {
          return;
        }
        inFlight.current = undefined;
        inFlightRequestId.current = undefined;
        if (!isActive || isDisposed.current || isImporting.current) {
          return;
        }
        if (forceAfterFlight.current) {
          forceAfterFlight.current = false;
          clearRefreshTimer();
          dirty.current = false;
          void startRead();
          return;
        }
        if (dirty.current && refreshTimer.current === undefined) {
          scheduleRefresh();
        }
      });

      return read;
    };

    const forceRefresh = (): Promise<void> => {
      if (!isActive || isDisposed.current || isImporting.current) {
        return Promise.resolve();
      }

      clearRefreshTimer();
      dirty.current = false;
      const currentRead = inFlight.current;
      if (currentRead !== undefined) {
        forceAfterFlight.current = true;
        return currentRead.then(() => inFlight.current);
      }
      return startRead();
    };

    const handleRepositoryChange = (
      change?: BookmarkRepositoryChange,
    ) => {
      if (change === 'import-began') {
        clearRefreshTimer();
        dirty.current = false;
        forceAfterFlight.current = false;
        isImporting.current = true;
        requestSequence.current += 1;
        setSnapshot((current) => ({
          ...current,
          isImporting: true,
        }));
        return;
      }
      if (change === 'import-ended') {
        isImporting.current = false;
        setSnapshot((current) => ({
          ...current,
          isImporting: false,
        }));
        void forceRefresh();
        return;
      }
      scheduleRefresh();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        scheduleRefresh();
      }
    };

    const unsubscribe = repository.onChanged(handleRepositoryChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', scheduleRefresh);
    refreshAction.current = forceRefresh;
    void forceRefresh();

    return () => {
      isActive = false;
      isDisposed.current = true;
      requestSequence.current += 1;
      clearRefreshTimer();
      dirty.current = false;
      isImporting.current = false;
      forceAfterFlight.current = false;
      inFlight.current = undefined;
      inFlightRequestId.current = undefined;
      if (refreshAction.current === forceRefresh) {
        refreshAction.current = async () => {};
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', scheduleRefresh);
      unsubscribe();
    };
  }, [repository]);

  return { ...snapshot, refresh };
}
