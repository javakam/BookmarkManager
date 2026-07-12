// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BrowserBookmarkNode } from '../../src/domain/bookmarks';
import { ManagerApp } from '../../src/ui/manager/ManagerApp';
import type {
  BookmarkRepository,
  BookmarkRepositoryChange,
} from '../../src/platform/bookmark-repository';
import { createMemoryBookmarkOperationStorage } from '../../src/platform/bookmark-operation-storage';

afterEach(cleanup);

function operationTree(): BrowserBookmarkNode[] {
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
              id: 'icon-only',
              parentId: 'bar',
              index: 0,
              title: '',
              url: 'https://important.example.test',
            },
            {
              id: 'folder-a',
              parentId: 'bar',
              index: 1,
              title: 'Folder A',
              children: [
                {
                  id: 'folder-a-child',
                  parentId: 'folder-a',
                  index: 0,
                  title: 'Nested',
                  children: [],
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
        {
          id: 'managed',
          parentId: 'root',
          index: 2,
          title: '受管书签',
          folderType: 'managed',
          unmodifiable: 'managed',
          children: [
            {
              id: 'managed-bookmark',
              parentId: 'managed',
              index: 0,
              title: 'Managed',
              url: 'https://managed.example.test',
            },
          ],
        },
      ],
    },
  ];
}

function repositoryStub(
  tree = operationTree(),
): BookmarkRepository & { emitChanged: () => void } {
  let listener:
    | ((change: BookmarkRepositoryChange) => void)
    | undefined;
  return {
    getTree: vi.fn().mockResolvedValue(tree),
    createBookmark: vi.fn(async (input) => ({
      id: 'created-bookmark',
      parentId: input.parentId,
      title: input.title,
      url: input.url,
    })),
    createFolder: vi.fn(async (input) => ({
      id: 'created-folder',
      parentId: input.parentId,
      title: input.title,
      children: [],
    })),
    update: vi.fn(async (id, changes) => ({
      id,
      parentId: 'bar',
      index: 0,
      title: changes.title ?? '',
      url: changes.url,
    })),
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

async function renderReady(tree = operationTree()) {
  const repository = repositoryStub(tree);
  render(
    <ManagerApp
      openUrl={vi.fn()}
      operationStorage={createMemoryBookmarkOperationStorage()}
      repository={repository}
    />,
  );
  await screen.findByRole('heading', { name: '书签栏' });
  return repository;
}

async function confirmOperation(name = '确认执行') {
  fireEvent.click(await screen.findByRole('button', { name }));
  await screen.findByRole('dialog', { name: '操作结果' });
}

describe('single bookmark operations', () => {
  it('creates an empty-title bookmark in the current folder after preview confirmation', async () => {
    const repository = await renderReady();

    fireEvent.click(screen.getByRole('button', { name: '新建书签' }));
    const dialog = await screen.findByRole('dialog', { name: '新建书签' });
    fireEvent.change(within(dialog).getByLabelText('网址'), {
      target: { value: 'file:///C:/important.html' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '预览' }));

    expect(await screen.findByText('将新建 1 个书签')).toBeTruthy();
    await confirmOperation();

    expect(repository.createBookmark).toHaveBeenCalledWith({
      parentId: 'bar',
      title: '',
      url: 'file:///C:/important.html',
    });
  });

  it('creates a folder in the current folder', async () => {
    const repository = await renderReady();

    fireEvent.click(screen.getByRole('button', { name: '新建文件夹' }));
    const dialog = await screen.findByRole('dialog', { name: '新建文件夹' });
    fireEvent.change(within(dialog).getByLabelText('名称'), {
      target: { value: '资料' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '预览' }));
    await confirmOperation();

    expect(repository.createFolder).toHaveBeenCalledWith({
      parentId: 'bar',
      title: '资料',
    });
  });

  it('edits a bookmark without synthesizing an empty title', async () => {
    const repository = await renderReady();

    fireEvent.click(
      screen.getByRole('button', { name: '编辑 important.example.test' }),
    );
    const dialog = await screen.findByRole('dialog', { name: '编辑书签' });
    expect((within(dialog).getByLabelText('标题') as HTMLInputElement).value).toBe('');
    fireEvent.change(within(dialog).getByLabelText('网址'), {
      target: { value: 'https://changed.example.test' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '预览' }));
    await confirmOperation();

    expect(repository.update).toHaveBeenCalledWith('icon-only', {
      title: '',
      url: 'https://changed.example.test',
    });
  });

  it('moves a folder only to valid writable folders', async () => {
    const repository = await renderReady();

    fireEvent.click(screen.getByRole('button', { name: '移动 Folder A' }));
    const dialog = await screen.findByRole('dialog', { name: '移动到' });
    const options = within(dialog)
      .getAllByRole('option')
      .map((option) => option.textContent);

    expect(options).toContain('其他书签');
    expect(options).not.toContain('Folder A');
    expect(options).not.toContain('Nested');

    fireEvent.change(within(dialog).getByLabelText('目标文件夹'), {
      target: { value: 'other' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '预览' }));
    await confirmOperation();

    expect(repository.move).toHaveBeenCalledWith('folder-a', {
      parentId: 'other',
    });
  });

  it('moves a bookmark to the recoverable quarantine folder without permanent delete wording or remove calls', async () => {
    const repository = await renderReady();

    fireEvent.click(
      screen.getByRole('button', { name: '移到待删除 important.example.test' }),
    );

    const confirm = await screen.findByRole('dialog', { name: '确认操作' });
    expect(within(confirm).getByText('可恢复')).toBeTruthy();
    expect(confirm.textContent).not.toContain('永久删除');
    await confirmOperation();

    expect(repository.createFolder).toHaveBeenCalledWith({
      parentId: 'other',
      title: '待删除（书签工作台）',
    });
    expect(repository.move).toHaveBeenCalledWith('icon-only', {
      parentId: 'created-folder',
    });
    expect(repository.remove).not.toHaveBeenCalled();
  });

  it('does not expose write controls for managed nodes', async () => {
    await renderReady();
    const sidebar = screen.getByRole('navigation', { name: '主导航' });

    fireEvent.click(within(sidebar).getByRole('button', { name: '受管书签' }));

    expect(await screen.findByText('Managed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /编辑 Managed/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /移动 Managed/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /移到待删除 Managed/ })).toBeNull();
  });
});
