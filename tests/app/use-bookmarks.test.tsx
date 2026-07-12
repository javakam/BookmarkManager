// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBookmarks } from '../../src/app/use-bookmarks';
import type { BrowserBookmarkNode } from '../../src/domain/bookmarks';
import type {
  BookmarkRepository,
  BookmarkRepositoryChange,
} from '../../src/platform/bookmark-repository';

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

  describe('refresh scheduling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('subscribes before the initial read and coalesces rapid changes for 200ms', async () => {
      let repository!: ReturnType<typeof repositoryStub>;
      const getTree = vi.fn<BookmarkRepository['getTree']>(async () => {
        if (getTree.mock.calls.length === 1) {
          repository.emitChanged();
        }
        return tree('书签栏');
      });
      repository = repositoryStub(getTree);
      renderHook(() => useBookmarks(repository));

      repository.emitChanged();
      repository.emitChanged();
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

    it('suppresses intermediate import refreshes and forces one at import end', async () => {
      const getTree = vi
        .fn<BookmarkRepository['getTree']>()
        .mockResolvedValueOnce(tree('导入前'))
        .mockResolvedValueOnce(tree('导入后'));
      const repository = repositoryStub(getTree);
      const { result } = renderHook(() => useBookmarks(repository));
      await act(async () => {});

      repository.emitChanged();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      act(() => repository.emitChanged('import-began'));
      expect(result.current.isImporting).toBe(true);

      repository.emitChanged();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(getTree).toHaveBeenCalledTimes(1);

      await act(async () => repository.emitChanged('import-ended'));
      expect(result.current.isImporting).toBe(false);
      expect(getTree).toHaveBeenCalledTimes(2);
      expect(result.current.records.find(({ id }) => id === 'bar')?.title).toBe(
        '导入后',
      );
    });

    it('coalesces focus and visible-page refreshes through the same scheduler', async () => {
      const getTree = vi
        .fn<BookmarkRepository['getTree']>()
        .mockResolvedValue(tree('书签栏'));
      const repository = repositoryStub(getTree);
      renderHook(() => useBookmarks(repository));
      await act(async () => {});

      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
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
  });
});
