import { describe, expect, it, vi } from 'vitest';

import { createBookmarkOperationService } from '../../src/app/bookmark-operation-service';
import { flattenBookmarkTree } from '../../src/domain/tree';
import type { BrowserBookmarkNode } from '../../src/domain/bookmarks';
import type { BookmarkRepository } from '../../src/platform/bookmark-repository';

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
    removeTree: vi.fn(),
    onChanged: vi.fn(() => () => undefined),
  };
}

describe('createBookmarkOperationService', () => {
  it('creates bookmarks and folders from a fresh native tree at execution time', async () => {
    const repository = repositoryStub();
    const service = createBookmarkOperationService({
      repository,
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

  it('rejects executable URL schemes when creating or editing a bookmark', () => {
    const repository = repositoryStub();
    const service = createBookmarkOperationService({
      repository,
    });
    const records = flattenBookmarkTree(tree());

    expect(() =>
      service.planCreateBookmark(records, {
        parentId: 'bar',
        title: 'Unsafe',
        url: 'javascript:alert(1)',
      }),
    ).toThrow('不支持保存或打开可执行网址协议');
    expect(() =>
      service.planUpdate(records, 'a', { url: 'data:text/html,unsafe' }),
    ).toThrow('不支持保存或打开可执行网址协议');
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

  it('permanently deletes selected native bookmarks after fingerprint validation', async () => {
    const repository = repositoryStub();
    const service = createBookmarkOperationService({
      repository,
    });
    const plan = service.planDelete(flattenBookmarkTree(tree()), ['b', 'a']);

    await expect(service.execute(plan)).resolves.toEqual({
      kind: 'delete',
      results: [
        { id: 'a', status: 'success', message: '已删除' },
        { id: 'b', status: 'success', message: '已删除' },
      ],
    });
    expect(vi.mocked(repository.remove).mock.calls.map(([id]) => id)).toEqual([
      'a',
      'b',
    ]);
    expect(repository.createFolder).not.toHaveBeenCalled();
    expect(repository.move).not.toHaveBeenCalled();

    const folderPlan = service.planDelete(flattenBookmarkTree(tree()), ['folder']);
    await service.execute(folderPlan);
    expect(repository.removeTree).toHaveBeenCalledWith('folder');
  });

  it('rechecks later deletes without treating its own sibling index shifts as conflicts', async () => {
    const nativeTree = tree();
    const getTree = vi.fn<BookmarkRepository['getTree']>(async () => nativeTree);
    const repository = repositoryStub(getTree);
    vi.mocked(repository.remove).mockImplementation(async (id) => {
      const bar = nativeTree[0]?.children?.[0];
      if (!bar?.children) {
        return;
      }
      bar.children = bar.children.filter((child) => child.id !== id);
      bar.children.forEach((child, index) => {
        child.index = index;
      });
    });
    const service = createBookmarkOperationService({
      repository,
    });

    const execution = await service.execute(
      service.planDelete(flattenBookmarkTree(tree()), ['a', 'b']),
    );

    expect(execution.results).toEqual([
      { id: 'a', status: 'success', message: '已删除' },
      { id: 'b', status: 'success', message: '已删除' },
    ]);
    expect(repository.remove).toHaveBeenCalledTimes(2);
    expect(getTree).toHaveBeenCalledTimes(2);
  });

  it('deletes a selected folder once when one of its descendants is also selected', async () => {
    const repository = repositoryStub();
    const service = createBookmarkOperationService({
      repository,
    });

    const plan = service.planDelete(flattenBookmarkTree(tree()), ['inside', 'folder']);

    expect(plan.sources.map(({ id }) => id)).toEqual(['folder']);
    expect(plan.affectedCount).toBe(2);
    await service.execute(plan);
    expect(repository.removeTree).toHaveBeenCalledWith('folder');
    expect(repository.remove).not.toHaveBeenCalledWith('inside');
  });

  it('blocks recursive deletion when the folder subtree changes after confirmation', async () => {
    const changedTree = tree();
    changedTree[0]!.children![0]!.children![2]!.children!.push({
      id: 'added-after-confirmation',
      parentId: 'folder',
      index: 1,
      title: 'Added externally',
      url: 'https://added.example.test',
    });
    const repository = repositoryStub(
      vi.fn<BookmarkRepository['getTree']>().mockResolvedValue(changedTree),
    );
    const service = createBookmarkOperationService({ repository });
    const plan = service.planDelete(flattenBookmarkTree(tree()), ['folder']);

    await expect(service.execute(plan)).resolves.toEqual({
      kind: 'delete',
      results: [
        {
          id: 'folder',
          status: 'conflict',
          message: '书签已在浏览器中变化，请刷新后重试',
        },
      ],
    });
    expect(repository.removeTree).not.toHaveBeenCalled();
  });

  it('blocks a later recursive delete when its subtree changes during the batch', async () => {
    const firstTree = tree();
    const secondFolder: BrowserBookmarkNode = {
      id: 'folder-two',
      parentId: 'bar',
      index: 3,
      title: 'Folder Two',
      children: [
        {
          id: 'inside-two',
          parentId: 'folder-two',
          index: 0,
          title: 'Inside Two',
          url: 'https://inside-two.example.test',
        },
      ],
    };
    firstTree[0]!.children![0]!.children!.push(secondFolder);

    const changedTree = structuredClone(firstTree);
    changedTree[0]!.children![0]!.children![3]!.children!.push({
      id: 'added-during-delete',
      parentId: 'folder-two',
      index: 1,
      title: 'Added during delete',
      url: 'https://added-during-delete.example.test',
    });
    const getTree = vi
      .fn<BookmarkRepository['getTree']>()
      .mockResolvedValueOnce(firstTree)
      .mockResolvedValue(changedTree);
    const repository = repositoryStub(getTree);
    const service = createBookmarkOperationService({ repository });
    const plan = service.planDelete(flattenBookmarkTree(firstTree), [
      'folder',
      'folder-two',
    ]);

    await expect(service.execute(plan)).resolves.toEqual({
      kind: 'delete',
      results: [
        { id: 'folder', status: 'success', message: '已删除' },
        {
          id: 'folder-two',
          status: 'conflict',
          message: '书签已在浏览器中变化，请刷新后重试',
        },
      ],
    });
    expect(repository.removeTree).toHaveBeenCalledTimes(1);
    expect(repository.removeTree).toHaveBeenCalledWith('folder');
    expect(getTree).toHaveBeenCalledTimes(2);
  });

  it('rechecks every batch item against the native tree before writing', async () => {
    const changedTree = tree();
    changedTree[0]!.children![0]!.children![1]!.title = 'Changed externally';
    const getTree = vi
      .fn<BookmarkRepository['getTree']>()
      .mockResolvedValue(changedTree);
    const repository = repositoryStub(getTree);
    const service = createBookmarkOperationService({
      repository,
    });
    const plan = service.planMove(flattenBookmarkTree(tree()), ['a', 'b'], {
      parentId: 'folder',
    });

    await expect(service.execute(plan)).resolves.toEqual({
      kind: 'move',
      results: [
        { id: 'a', status: 'success', message: '已移动' },
        {
          id: 'b',
          status: 'conflict',
          message: '书签已在浏览器中变化，请刷新后重试',
        },
      ],
    });
    expect(repository.move).toHaveBeenCalledTimes(1);
    expect(getTree).toHaveBeenCalledTimes(2);
  });

  it('stops a batch when the browser changes an unprocessed item mid-execution', async () => {
    const firstTree = tree();
    const changedTree = tree();
    changedTree[0]!.children![0]!.children![1]!.title = 'Changed mid-batch';
    let readCount = 0;
    const getTree = vi.fn<BookmarkRepository['getTree']>(() => {
      readCount += 1;
      return Promise.resolve(readCount === 1 ? firstTree : changedTree);
    });
    const repository = repositoryStub(getTree);
    const service = createBookmarkOperationService({ repository });
    const plan = service.planMove(flattenBookmarkTree(tree()), ['a', 'b'], {
      parentId: 'folder',
    });

    await expect(service.execute(plan)).resolves.toEqual({
      kind: 'move',
      results: [
        { id: 'a', status: 'success', message: '已移动' },
        {
          id: 'b',
          status: 'conflict',
          message: '书签已在浏览器中变化，请刷新后重试',
        },
      ],
    });
    expect(repository.move).toHaveBeenCalledTimes(1);
    expect(getTree).toHaveBeenCalledTimes(2);
  });

  it('conflicts folder reorders when the sibling list changes after preview', async () => {
    const changedTree = tree();
    changedTree[0]!.children![0]!.children!.push({
      id: 'new-folder',
      parentId: 'bar',
      index: 3,
      title: 'New Folder',
      children: [],
    });
    const repository = repositoryStub(
      vi.fn<BookmarkRepository['getTree']>().mockResolvedValue(changedTree),
    );
    const service = createBookmarkOperationService({
      repository,
    });
    const plan = service.planReorder(flattenBookmarkTree(tree()), 'folder', {
      parentId: 'bar',
      index: 0,
    });

    await expect(service.execute(plan)).resolves.toEqual({
      kind: 'reorder',
      results: [
        {
          id: 'folder',
          status: 'conflict',
          message: '书签已在浏览器中变化，请刷新后重试',
        },
      ],
    });
    expect(repository.move).not.toHaveBeenCalled();
  });

});
