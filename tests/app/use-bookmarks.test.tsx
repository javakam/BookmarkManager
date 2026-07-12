// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useBookmarks } from '../../src/app/use-bookmarks';
import type { BrowserBookmarkNode } from '../../src/domain/bookmarks';
import type { BookmarkRepository } from '../../src/platform/bookmark-repository';

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
): BookmarkRepository & { emitChanged: () => void } {
  let listener: (() => void) | undefined;
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
    emitChanged() {
      listener?.();
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

  it('re-reads after external changes and ignores an older pending response', async () => {
    const oldRequest = deferred<BrowserBookmarkNode[]>();
    const newRequest = deferred<BrowserBookmarkNode[]>();
    const getTree = vi
      .fn<BookmarkRepository['getTree']>()
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise);
    const repository = repositoryStub(getTree);
    const { result } = renderHook(() => useBookmarks(repository));

    act(() => repository.emitChanged());
    expect(getTree).toHaveBeenCalledTimes(2);

    await act(async () => newRequest.resolve(tree('新快照')));
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
});
