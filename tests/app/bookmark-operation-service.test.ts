import { describe, expect, it, vi } from 'vitest';

import { createBookmarkOperationService } from '../../src/app/bookmark-operation-service';
import { flattenBookmarkTree } from '../../src/domain/tree';
import type { BrowserBookmarkNode } from '../../src/domain/bookmarks';
import type { BookmarkRepository } from '../../src/platform/bookmark-repository';
import {
  createMemoryBookmarkOperationStorage,
  type BookmarkRecoveryEntry,
} from '../../src/platform/bookmark-operation-storage';

function tree(): BrowserBookmarkNode[] {
  return [
    {
      id: 'root',
      title: '',
      children: [
        {
          id: 'bar',
          parentId: 'root',
          index: 0,
          title: '书签栏',
          folderType: 'bookmarks-bar',
          children: [
            {
              id: 'a',
              parentId: 'bar',
              index: 0,
              title: 'A',
              url: 'https://a.example.test',
            },
            {
              id: 'b',
              parentId: 'bar',
              index: 1,
              title: '',
              url: 'https://b.example.test',
            },
            {
              id: 'folder',
              parentId: 'bar',
              index: 2,
              title: 'Folder',
              children: [
                {
                  id: 'inside',
                  parentId: 'folder',
                  index: 0,
                  title: 'Inside',
                  url: 'https://inside.example.test',
                },
              ],
            },
          ],
        },
        {
          id: 'other',
          parentId: 'root',
          index: 1,
          title: '其他书签',
          folderType: 'other',
          children: [],
        },
      ],
    },
  ];
}

function repositoryStub(
  getTree = vi.fn<BookmarkRepository['getTree']>().mockResolvedValue(tree()),
): BookmarkRepository {
  return {
    getTree,
    createBookmark: vi.fn(async (input) => ({
      id: 'created-bookmark',
      title: input.title,
      parentId: input.parentId,
      index: input.index,
      url: input.url,
    })),
    createFolder: vi.fn(async (input) => ({
      id: 'created-folder',
      title: input.title,
      parentId: input.parentId,
      index: input.index,
      children: [],
    })),
    update: vi.fn(async (id, changes) => ({
      id,
      parentId: 'bar',
      index: 0,
      title: changes.title ?? 'A',
      url: changes.url ?? 'https://a.example.test',
    })),
    move: vi.fn(async (id, destination) => ({
      id,
      parentId: destination.parentId,
      index: destination.index,
      title: id,
    })),
    remove: vi.fn(),
    onChanged: vi.fn(() => () => undefined),
  };
}

describe('createBookmarkOperationService', () => {
  it('creates bookmarks and folders from a fresh native tree at execution time', async () => {
    const repository = repositoryStub();
    const service = createBookmarkOperationService({
      repository,
      storage: createMemoryBookmarkOperationStorage(),
    });

    const bookmarkPlan = service.planCreateBookmark(flattenBookmarkTree(tree()), {
      parentId: 'bar',
      title: '',
      url: 'file:///C:/important.html',
    });
    const folderPlan = service.planCreateFolder(flattenBookmarkTree(tree()), {
      parentId: 'bar',
      title: 'New Folder',
    });

    await expect(service.execute(bookmarkPlan)).resolves.toMatchObject({
      kind: 'create-bookmark',
      results: [{ status: 'success' }],
    });
    await expect(service.execute(folderPlan)).resolves.toMatchObject({
      kind: 'create-folder',
      results: [{ status: 'success' }],
    });
    expect(repository.getTree).toHaveBeenCalledTimes(2);
    expect(repository.createBookmark).toHaveBeenCalledWith({
      parentId: 'bar',
      title: '',
      url: 'file:///C:/important.html',
    });
  });

  it('reports a conflict when a bookmark changes between preview and execution', async () => {
    const changedTree = tree();
    changedTree[0]!.children![0]!.children![0]!.title = 'Changed externally';
    const repository = repositoryStub(
      vi.fn<BookmarkRepository['getTree']>().mockResolvedValue(changedTree),
    );
    const service = createBookmarkOperationService({
      repository,
      storage: createMemoryBookmarkOperationStorage(),
    });
    const plan = service.planUpdate(flattenBookmarkTree(tree()), 'a', {
      title: 'Local edit',
    });

    await expect(service.execute(plan)).resolves.toEqual({
      kind: 'update',
      results: [
        {
          id: 'a',
          status: 'conflict',
          message: '书签已在浏览器中变化，请刷新后重试',
        },
      ],
    });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('moves bookmarks in source order and keeps partial failures as item results', async () => {
    const repository = repositoryStub();
    vi.mocked(repository.move).mockImplementation(async (id, destination) => {
      if (id === 'b') {
        throw new Error('move denied');
      }
      return { id, parentId: destination.parentId, index: destination.index, title: id };
    });
    const service = createBookmarkOperationService({
      repository,
      storage: createMemoryBookmarkOperationStorage(),
    });
    const plan = service.planMove(flattenBookmarkTree(tree()), ['b', 'a'], {
      parentId: 'folder',
    });

    const execution = await service.execute(plan);

    expect(vi.mocked(repository.move).mock.calls.map(([id]) => id)).toEqual([
      'a',
      'b',
    ]);
    expect(execution).toEqual({
      kind: 'move',
      results: [
        { id: 'a', status: 'success', message: '已移动' },
        { id: 'b', status: 'failure', message: 'move denied' },
      ],
    });
  });

  it('quarantines bookmarks through move, creates the native quarantine folder, and stores recovery anchors', async () => {
    const storage = createMemoryBookmarkOperationStorage();
    const repository = repositoryStub();
    const service = createBookmarkOperationService({
      now: () => 456,
      repository,
      storage,
    });
    const plan = service.planQuarantine(flattenBookmarkTree(tree()), ['a', 'b']);

    const execution = await service.execute(plan);

    expect(repository.createFolder).toHaveBeenCalledWith({
      parentId: 'other',
      title: '待删除（书签工作台）',
    });
    expect(repository.remove).not.toHaveBeenCalled();
    expect(vi.mocked(repository.move).mock.calls.map(([id]) => id)).toEqual([
      'a',
      'b',
    ]);
    expect(execution.results).toEqual([
      { id: 'a', status: 'success', message: '已移到待删除' },
      { id: 'b', status: 'success', message: '已移到待删除' },
    ]);
    await expect(storage.loadRecoveryEntries()).resolves.toEqual([
      {
        nodeId: 'a',
        originalParentId: 'bar',
        originalIndex: 0,
        nextSiblingId: 'b',
        quarantinedAt: 456,
      },
      {
        nodeId: 'b',
        originalParentId: 'bar',
        originalIndex: 1,
        previousSiblingId: 'a',
        nextSiblingId: 'folder',
        quarantinedAt: 456,
      },
    ]);
  });

  it('restores using sibling anchors and conflicts when the original parent is gone', async () => {
    const storage = createMemoryBookmarkOperationStorage();
    const entry: BookmarkRecoveryEntry = {
      nodeId: 'a',
      originalParentId: 'bar',
      originalIndex: 0,
      nextSiblingId: 'b',
      quarantinedAt: 1,
    };
    await storage.upsertRecoveryEntry(entry);
    await storage.saveQuarantineFolderId('quarantine');
    const nativeTree = tree();
    nativeTree[0]!.children![0]!.children = [
      {
        id: 'b',
        parentId: 'bar',
        index: 0,
        title: '',
        url: 'https://b.example.test',
      },
      {
        id: 'folder',
        parentId: 'bar',
        index: 1,
        title: 'Folder',
        children: [
          {
            id: 'inside',
            parentId: 'folder',
            index: 0,
            title: 'Inside',
            url: 'https://inside.example.test',
          },
        ],
      },
    ];
    nativeTree[0]!.children![1]!.children = [
      {
        id: 'quarantine',
        parentId: 'other',
        index: 0,
        title: '待删除（书签工作台）',
        children: [
          {
            id: 'a',
            parentId: 'quarantine',
            index: 0,
            title: 'A',
            url: 'https://a.example.test',
          },
        ],
      },
    ];
    const repository = repositoryStub(
      vi.fn<BookmarkRepository['getTree']>().mockResolvedValue(nativeTree),
    );
    const service = createBookmarkOperationService({ repository, storage });

    await expect(service.execute(service.planRestore([entry]))).resolves.toEqual({
      kind: 'restore',
      results: [{ id: 'a', status: 'success', message: '已恢复' }],
    });
    expect(repository.move).toHaveBeenCalledWith('a', {
      parentId: 'bar',
      index: 0,
    });
    await expect(storage.loadRecoveryEntries()).resolves.toEqual([]);
  });
});
