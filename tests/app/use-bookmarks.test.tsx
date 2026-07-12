// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBookmarks } from '../../src/app/use-bookmarks';
import type { BrowserBookmarkNode } from '../../src/domain/bookmarks';
import type {
  BookmarkRepository,
  BookmarkRepositoryChange,
} from '../../src/platform/bookmark-repository';

afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function tree(title: string): BrowserBookmarkNode[] {
  return [
    {
      id: 'root',
      title: '',
      children: [
        {
          id: 'bar',
          parentId: 'root',
          index: 0,
          title,
          folderType: 'bookmarks-bar',
          children: [],
        },
      ],
    },
  ];
}

function repositoryStub(
  getTree: BookmarkRepository['getTree'],
): BookmarkRepository & {
  emitChanged: (change?: BookmarkRepositoryChange) => void;
  listenerCount: () => number;
} {
  let listener:
    | ((change: BookmarkRepositoryChange) => void)
    | undefined;
  return {
    getTree,
    createBookmark: vi.fn(),
    createFolder: vi.fn(),
    update: vi.fn(),
    move: vi.fn(),
    remove: vi.fn(),
    onChanged(nextListener) {
      listener = nextListener;
      return () => {
        listener = undefined;
      };
    },
    emitChanged(change = 'changed') {
      listener?.(change);
    },
    listenerCount() {
      return listener === undefined ? 0 : 1;
    },
  };
}

describe('useBookmarks', () => {
  it('loads a flattened snapshot and increments its revision', async () => {
    const repository = repositoryStub(vi.fn().mockResolvedValue(tree('书签栏')));
    const { result } = renderHook(() => useBookmarks(repository));

    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.records.map(({ id }) => id)).toEqual(['root', 'bar']);
    expect(result.current.revision).toBe(1);
    expect(result.current.isImporting).toBe(false);
    expect(result.current.lastUpdatedAt).toEqual(expect.any(Number));
  });

  it('exposes a failed load and retries through refresh', async () => {
    const getTree = vi
      .fn<BookmarkRepository['getTree']>()
      .mockRejectedValueOnce(new Error('permission denied'))
      .mockResolvedValueOnce(tree('重试成功'));
    const repository = repositoryStub(getTree);
    const { result } = renderHook(() => useBookmarks(repository));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('permission denied');

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.records.find(({ id }) => id === 'bar')?.title).toBe(
      '重试成功',
    );
    expect(result.current.revision).toBe(1);
  });

  it('keeps a newer repository snapshot when an older read resolves later', async () => {
    const oldRequest = deferred<BrowserBookmarkNode[]>();
    const oldRepository = repositoryStub(() => oldRequest.promise);
    const newRepository = repositoryStub(
      vi.fn().mockResolvedValue(tree('新快照')),
    );
    const { rerender, result } = renderHook(
      ({ repository }) => useBookmarks(repository),
      { initialProps: { repository: oldRepository } },
    );

    rerender({ repository: newRepository });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.records.find(({ id }) => id === 'bar')?.title).toBe(
      '新快照',
    );

    await act(async () => oldRequest.resolve(tree('旧快照')));
    expect(result.current.records.find(({ id }) => id === 'bar')?.title).toBe(
      '新快照',
    );
    expect(result.current.revision).toBe(1);
  });

  it('clears an old repository import state while the new read is pending', async () => {
    const oldRepository = repositoryStub(
      vi.fn().mockResolvedValue(tree('旧仓库快照')),
    );
    const newRead = deferred<BrowserBookmarkNode[]>();
    const newRepository = repositoryStub(() => newRead.promise);
    const { rerender, result } = renderHook(
      ({ repository }) => useBookmarks(repository),
      { initialProps: { repository: oldRepository } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => oldRepository.emitChanged('import-began'));
    expect(result.current.isImporting).toBe(true);

    rerender({ repository: newRepository });
    expect(result.current.status).toBe('loading');
    expect(result.current.isImporting).toBe(false);
    expect(result.current.records.find(({ id }) => id === 'bar')?.title).toBe(
      '旧仓库快照',
    );

    await act(async () => newRead.resolve(tree('新仓库快照')));
  });

  describe('refresh scheduling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('subscribes before starting the initial read', async () => {
      let repository!: ReturnType<typeof repositoryStub>;
      const getTree = vi.fn<BookmarkRepository['getTree']>(async () => {
        if (getTree.mock.calls.length === 1) {
          repository.emitChanged();
        }
        return tree('书签栏');
      });
      repository = repositoryStub(getTree);
      renderHook(() => useBookmarks(repository));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(199);
      });
      expect(getTree).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(getTree).toHaveBeenCalledTimes(2);
    });

    it('coalesces rapid ordinary changes for 200ms after the last event', async () => {
      const getTree = vi
        .fn<BookmarkRepository['getTree']>()
        .mockResolvedValue(tree('书签栏'));
      const repository = repositoryStub(getTree);
      renderHook(() => useBookmarks(repository));
      await act(async () => {});

      act(() => repository.emitChanged());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      act(() => {
        repository.emitChanged();
        repository.emitChanged();
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(199);
      });
      expect(getTree).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(getTree).toHaveBeenCalledTimes(2);
    });

    it('performs exactly one trailing read for changes received in flight', async () => {
      const firstRead = deferred<BrowserBookmarkNode[]>();
      const secondRead = deferred<BrowserBookmarkNode[]>();
      const getTree = vi
        .fn<BookmarkRepository['getTree']>()
        .mockReturnValueOnce(firstRead.promise)
        .mockReturnValueOnce(secondRead.promise);
      const repository = repositoryStub(getTree);
      renderHook(() => useBookmarks(repository));

      repository.emitChanged();
      repository.emitChanged();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(getTree).toHaveBeenCalledTimes(1);

      await act(async () => firstRead.resolve(tree('首次读取')));
      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });
      expect(getTree).toHaveBeenCalledTimes(2);

      await act(async () => secondRead.resolve(tree('尾随读取')));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(getTree).toHaveBeenCalledTimes(2);
    });

    it('does not leave a debounce timer after a forced trailing read starts', async () => {
      const firstRead = deferred<BrowserBookmarkNode[]>();
      const forcedRead = deferred<BrowserBookmarkNode[]>();
      const getTree = vi
        .fn<BookmarkRepository['getTree']>()
        .mockReturnValueOnce(firstRead.promise)
        .mockReturnValueOnce(forcedRead.promise)
        .mockResolvedValue(tree('意外的第三次读取'));
      const repository = repositoryStub(getTree);
      const { result } = renderHook(() => useBookmarks(repository));

      let refreshPromise!: Promise<void>;
      act(() => {
        refreshPromise = result.current.refresh();
        repository.emitChanged();
      });

      await act(async () => firstRead.resolve(tree('首次读取')));
      expect(getTree).toHaveBeenCalledTimes(2);

      await act(async () => forcedRead.resolve(tree('强制尾随读取')));
      await act(async () => {
        await refreshPromise;
        await vi.advanceTimersByTimeAsync(200);
      });

      expect(getTree).toHaveBeenCalledTimes(2);
    });

    it('discards an in-flight import snapshot and refreshes once after import end', async () => {
      const initialRead = deferred<BrowserBookmarkNode[]>();
      const importedRead = deferred<BrowserBookmarkNode[]>();
      const getTree = vi
        .fn<BookmarkRepository['getTree']>()
        .mockReturnValueOnce(initialRead.promise)
        .mockReturnValueOnce(importedRead.promise);
      const repository = repositoryStub(getTree);
      const { result } = renderHook(() => useBookmarks(repository));

      act(() => repository.emitChanged('import-began'));
      expect(result.current.isImporting).toBe(true);

      act(() => repository.emitChanged());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(getTree).toHaveBeenCalledTimes(1);

      await act(async () => initialRead.resolve(tree('导入中的半成品')));
      expect(result.current.status).toBe('loading');
      expect(result.current.records).toEqual([]);
      expect(result.current.revision).toBe(0);
      expect(result.current.lastUpdatedAt).toBeUndefined();

      act(() => repository.emitChanged('import-ended'));
      expect(result.current.isImporting).toBe(false);
      expect(getTree).toHaveBeenCalledTimes(2);

      await act(async () => importedRead.resolve(tree('完整导入结果')));
      expect(result.current.records.find(({ id }) => id === 'bar')?.title).toBe(
        '完整导入结果',
      );
      expect(result.current.revision).toBe(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(getTree).toHaveBeenCalledTimes(2);
    });

    it('schedules a refresh when the window regains focus', async () => {
      const getTree = vi
        .fn<BookmarkRepository['getTree']>()
        .mockResolvedValue(tree('书签栏'));
      const repository = repositoryStub(getTree);
      renderHook(() => useBookmarks(repository));
      await act(async () => {});

      act(() => window.dispatchEvent(new Event('focus')));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(199);
      });
      expect(getTree).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(getTree).toHaveBeenCalledTimes(2);
    });

    it('refreshes only when a visibility change makes the page visible', async () => {
      const getTree = vi
        .fn<BookmarkRepository['getTree']>()
        .mockResolvedValue(tree('书签栏'));
      const repository = repositoryStub(getTree);
      renderHook(() => useBookmarks(repository));
      await act(async () => {});
      const visibilityState = vi.spyOn(
        document,
        'visibilityState',
        'get',
      );

      visibilityState.mockReturnValue('hidden');
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(getTree).toHaveBeenCalledTimes(1);

      visibilityState.mockReturnValue('visible');
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(199);
      });
      expect(getTree).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(getTree).toHaveBeenCalledTimes(2);
    });

    it('preserves the last good snapshot and timestamp when a refresh fails', async () => {
      vi.setSystemTime(1_000);
      const getTree = vi
        .fn<BookmarkRepository['getTree']>()
        .mockResolvedValueOnce(tree('可用快照'))
        .mockRejectedValueOnce(new Error('temporary failure'));
      const repository = repositoryStub(getTree);
      const { result } = renderHook(() => useBookmarks(repository));
      await act(async () => {});
      expect(result.current.lastUpdatedAt).toBe(1_000);

      vi.setSystemTime(2_000);
      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.status).toBe('error');
      expect(result.current.error).toBe('temporary failure');
      expect(result.current.records.find(({ id }) => id === 'bar')?.title).toBe(
        '可用快照',
      );
      expect(result.current.lastUpdatedAt).toBe(1_000);
      expect(result.current.revision).toBe(1);
    });

    it('disposes StrictMode reads, timers, and event listeners on unmount', async () => {
      const firstRead = deferred<BrowserBookmarkNode[]>();
      const secondRead = deferred<BrowserBookmarkNode[]>();
      const windowAddEventListener = vi.spyOn(window, 'addEventListener');
      const windowRemoveEventListener = vi.spyOn(
        window,
        'removeEventListener',
      );
      const documentAddEventListener = vi.spyOn(
        document,
        'addEventListener',
      );
      const documentRemoveEventListener = vi.spyOn(
        document,
        'removeEventListener',
      );
      const getTree = vi
        .fn<BookmarkRepository['getTree']>()
        .mockReturnValueOnce(firstRead.promise)
        .mockReturnValueOnce(secondRead.promise);
      const repository = repositoryStub(getTree);
      const { result, unmount } = renderHook(
        () => useBookmarks(repository),
        { reactStrictMode: true },
      );
      expect(getTree).toHaveBeenCalledTimes(2);
      expect(repository.listenerCount()).toBe(1);

      act(() => repository.emitChanged());
      expect(vi.getTimerCount()).toBe(1);
      const snapshotAtUnmount = result.current;
      unmount();
      expect(vi.getTimerCount()).toBe(0);
      expect(repository.listenerCount()).toBe(0);

      const addedFocusListeners = windowAddEventListener.mock.calls
        .filter(([eventName]) => eventName === 'focus')
        .map(([, listener]) => listener);
      const removedFocusListeners = windowRemoveEventListener.mock.calls
        .filter(([eventName]) => eventName === 'focus')
        .map(([, listener]) => listener);
      expect(addedFocusListeners.length).toBeGreaterThan(0);
      expect(removedFocusListeners).toEqual(addedFocusListeners);

      const addedVisibilityListeners = documentAddEventListener.mock.calls
        .filter(([eventName]) => eventName === 'visibilitychange')
        .map(([, listener]) => listener);
      const removedVisibilityListeners =
        documentRemoveEventListener.mock.calls
          .filter(([eventName]) => eventName === 'visibilitychange')
          .map(([, listener]) => listener);
      expect(addedVisibilityListeners.length).toBeGreaterThan(0);
      expect(removedVisibilityListeners).toEqual(addedVisibilityListeners);

      act(() => {
        repository.emitChanged();
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await act(async () => {
        firstRead.resolve(tree('卸载后的旧结果'));
        secondRead.reject(new Error('卸载后的失败'));
        await Promise.allSettled([firstRead.promise, secondRead.promise]);
        await vi.runAllTimersAsync();
      });

      expect(getTree).toHaveBeenCalledTimes(2);
      expect(result.current).toBe(snapshotAtUnmount);

      windowAddEventListener.mockRestore();
      windowRemoveEventListener.mockRestore();
      documentAddEventListener.mockRestore();
      documentRemoveEventListener.mockRestore();
    });
  });
});
