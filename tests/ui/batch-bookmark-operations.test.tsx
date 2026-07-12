// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BrowserBookmarkNode } from '../../src/domain/bookmarks';
import { ManagerApp } from '../../src/ui/manager/ManagerApp';
import type {
  BookmarkRepository,
  BookmarkRepositoryChange,
} from '../../src/platform/bookmark-repository';
import {
  createMemoryBookmarkOperationStorage,
  type BookmarkOperationStorage,
} from '../../src/platform/bookmark-operation-storage';

afterEach(cleanup);

function batchTree(): BrowserBookmarkNode[] {
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
              id: 'folder-a',
              parentId: 'bar',
              index: 1,
              title: 'Folder A',
              children: [],
            },
          ],
        },
        {
          id: 'other',
          parentId: 'root',
          index: 1,
          title: '其他书签',
          folderType: 'other',
          children: [
            {
              id: 'quarantine',
              parentId: 'other',
              index: 0,
              title: '待删除（书签工作台）',
              children: [
                {
                  id: 'deleted-a',
                  parentId: 'quarantine',
                  index: 0,
                  title: 'Deleted A',
                  url: 'https://deleted.example.test',
                },
              ],
            },
          ],
        },
      ],
    },
  ];
}

function repositoryStub(
  tree = batchTree(),
): BookmarkRepository & { emitChanged: () => void } {
  let listener:
    | ((change: BookmarkRepositoryChange) => void)
    | undefined;
  return {
    getTree: vi.fn().mockResolvedValue(tree),
    createBookmark: vi.fn(),
    createFolder: vi.fn(async (input) => ({
      id: 'created-quarantine',
      parentId: input.parentId,
      title: input.title,
      children: [],
    })),
    update: vi.fn(),
    move: vi.fn(async (id, destination) => ({
      id,
      parentId: destination.parentId,
      index: destination.index,
      title: id,
    })),
    remove: vi.fn(),
    onChanged(nextListener) {
      listener = nextListener;
      return () => {
        listener = undefined;
      };
    },
    emitChanged() {
      listener?.('changed');
    },
  };
}

async function renderReady(
  storage: BookmarkOperationStorage = createMemoryBookmarkOperationStorage(),
) {
  const repository = repositoryStub();
  render(
    <ManagerApp
      openUrl={vi.fn()}
      operationStorage={storage}
      repository={repository}
    />,
  );
  await screen.findByRole('heading', { name: '书签栏' });
  return { repository, storage };
}

async function confirm() {
  fireEvent.click(await screen.findByRole('button', { name: '确认执行' }));
  await screen.findByRole('dialog', { name: '操作结果' });
}

describe('batch bookmark operations', () => {
  it('shows selection only in browse, clears it on folder change, and batch moves selected items', async () => {
    const { repository } = await renderReady();

    fireEvent.click(screen.getByRole('checkbox', { name: '选择 A' }));
    expect(await screen.findByRole('toolbar', { name: '批量操作' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '移动到……' }));
    const dialog = await screen.findByRole('dialog', { name: '移动到' });
    fireEvent.change(within(dialog).getByLabelText('目标文件夹'), {
      target: { value: 'other' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '预览' }));
    await confirm();

    expect(repository.move).toHaveBeenCalledWith('a', { parentId: 'other' });
    fireEvent.click(screen.getByRole('button', { name: '知道了' }));
    expect(screen.queryByRole('toolbar', { name: '批量操作' })).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: '选择 A' }));
    const sidebar = screen.getByRole('navigation', { name: '主导航' });
    fireEvent.click(within(sidebar).getByRole('button', { name: '其他书签' }));
    expect(screen.queryByRole('toolbar', { name: '批量操作' })).toBeNull();
  });

  it('batch quarantines selected bookmarks without remove calls', async () => {
    const { repository } = await renderReady();

    fireEvent.click(screen.getByRole('checkbox', { name: '选择 A' }));
    fireEvent.click(screen.getByRole('button', { name: '移到待删除' }));

    expect(await screen.findByText('将移到待删除 1 项')).toBeTruthy();
    await confirm();

    expect(repository.move).toHaveBeenCalledWith('a', {
      parentId: 'quarantine',
    });
    expect(repository.remove).not.toHaveBeenCalled();
  });

  it('restores selected quarantine items through recovery anchors', async () => {
    const storage = createMemoryBookmarkOperationStorage();
    await storage.saveQuarantineFolderId('quarantine');
    await storage.upsertRecoveryEntry({
      nodeId: 'deleted-a',
      originalParentId: 'bar',
      originalIndex: 0,
      quarantinedAt: 1,
    });
    const { repository } = await renderReady(storage);
    const sidebar = screen.getByRole('navigation', { name: '主导航' });

    fireEvent.click(within(sidebar).getByRole('button', { name: '展开 其他书签' }));
    fireEvent.click(within(sidebar).getByRole('button', { name: '待删除（书签工作台）' }));
    await screen.findByRole('heading', { name: '待删除（书签工作台）' });
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 Deleted A' }));
    fireEvent.click(screen.getByRole('button', { name: '恢复' }));
    await confirm();

    expect(repository.move).toHaveBeenCalledWith('deleted-a', {
      parentId: 'bar',
      index: 0,
    });
  });

  it('asks for a fallback folder before restoring when the original parent is missing', async () => {
    const storage = createMemoryBookmarkOperationStorage();
    await storage.saveQuarantineFolderId('quarantine');
    await storage.upsertRecoveryEntry({
      nodeId: 'deleted-a',
      originalParentId: 'missing-parent',
      originalIndex: 0,
      quarantinedAt: 1,
    });
    const { repository } = await renderReady(storage);
    const sidebar = screen.getByRole('navigation', { name: '主导航' });

    fireEvent.click(within(sidebar).getByRole('button', { name: '展开 其他书签' }));
    fireEvent.click(within(sidebar).getByRole('button', { name: '待删除（书签工作台）' }));
    await screen.findByRole('heading', { name: '待删除（书签工作台）' });
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 Deleted A' }));
    fireEvent.click(screen.getByRole('button', { name: '恢复' }));

    const fallback = await screen.findByRole('dialog', { name: '移动到' });
    fireEvent.change(within(fallback).getByLabelText('目标文件夹'), {
      target: { value: 'bar' },
    });
    fireEvent.click(within(fallback).getByRole('button', { name: '预览' }));
    await confirm();

    expect(repository.move).toHaveBeenCalledWith('deleted-a', {
      parentId: 'bar',
      index: 0,
    });
  });
});
