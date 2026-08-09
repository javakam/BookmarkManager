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
      repository={repository}
    />,
  );
  await screen.findByRole('heading', { name: '书签栏' });
  return repository;
}

async function confirmOperation(name: string) {
  fireEvent.click(await screen.findByRole('button', { name }));
  await screen.findByRole('status', { name: '操作提示' });
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
    await confirmOperation('确认新建书签');

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
    await confirmOperation('确认新建文件夹');

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
    await confirmOperation('确认保存');

    expect(repository.update).toHaveBeenCalledWith('icon-only', {
      url: 'https://changed.example.test',
    });
  });

  it('edits the title of an existing bookmarklet without resubmitting its URL', async () => {
    const nativeTree = operationTree();
    nativeTree[0]?.children?.[0]?.children?.unshift({
      id: 'bookmarklet',
      parentId: 'bar',
      index: 0,
      title: 'Bookmarklet',
      url: 'javascript:void(document.body.dataset.saved=1)',
    });
    const repository = await renderReady(nativeTree);

    fireEvent.click(screen.getByRole('button', { name: '编辑 Bookmarklet' }));
    const dialog = await screen.findByRole('dialog', { name: '编辑书签' });
    fireEvent.change(within(dialog).getByLabelText('标题'), {
      target: { value: 'Bookmarklet updated' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '预览' }));
    await confirmOperation('确认保存');

    expect(repository.update).toHaveBeenCalledWith('bookmarklet', {
      title: 'Bookmarklet updated',
    });
  });

  it('shows validation errors inside the editor dialog', async () => {
    await renderReady();

    fireEvent.click(
      screen.getByRole('button', { name: '编辑 important.example.test' }),
    );
    const dialog = await screen.findByRole('dialog', { name: '编辑书签' });
    fireEvent.change(within(dialog).getByLabelText('网址'), {
      target: { value: 'javascript:alert(1)' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '预览' }));

    expect(within(dialog).getByRole('alert').textContent).toContain(
      '不支持保存或打开可执行网址协议',
    );
  });

  it('shows execution failures inside the confirmation dialog', async () => {
    const repository = await renderReady();
    vi.mocked(repository.getTree).mockRejectedValueOnce(
      new Error('native read failed'),
    );

    fireEvent.click(
      screen.getByRole('button', { name: '编辑 important.example.test' }),
    );
    const editor = await screen.findByRole('dialog', { name: '编辑书签' });
    fireEvent.change(within(editor).getByLabelText('标题'), {
      target: { value: 'Changed title' },
    });
    fireEvent.click(within(editor).getByRole('button', { name: '预览' }));
    const confirm = await screen.findByRole('dialog', {
      name: '确认保存修改',
    });
    fireEvent.click(within(confirm).getByRole('button', { name: '确认保存' }));

    expect((await within(confirm).findByRole('alert')).textContent).toContain(
      'native read failed',
    );
  });

  it('keeps keyboard focus inside dialogs and restores the opener after cancel', async () => {
    await renderReady();
    const opener = screen.getByRole('button', {
      name: '编辑 important.example.test',
    });
    opener.focus();
    fireEvent.click(opener);

    const dialog = await screen.findByRole('dialog', { name: '编辑书签' });
    const title = within(dialog).getByLabelText('标题');
    const preview = within(dialog).getByRole('button', { name: '预览' });
    preview.focus();
    fireEvent.keyDown(preview, { key: 'Tab' });
    expect(document.activeElement).toBe(title);

    fireEvent.keyDown(title, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: '取消' }),
    );
    expect(document.querySelector('.app-body')?.hasAttribute('inert')).toBe(true);

    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(document.querySelector('.app-body')?.hasAttribute('inert')).toBe(false);
  });

  it('moves a folder only to valid writable folders', async () => {
    const repository = await renderReady();

    fireEvent.click(screen.getByRole('button', { name: '移动 Folder A' }));
    const dialog = await screen.findByRole('dialog', { name: '移动到' });
    const options = within(dialog)
      .getAllByRole('option')
      .map((option) => option.textContent);

    expect(options).toContain('其他书签');
    expect(options).not.toContain('书签栏');
    expect(options).not.toContain('Folder A');
    expect(options).not.toContain('Nested');
    expect(
      (within(dialog).getByLabelText('目标文件夹') as HTMLSelectElement).value,
    ).toBe('other');

    fireEvent.change(within(dialog).getByLabelText('目标文件夹'), {
      target: { value: 'other' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '预览' }));
    await confirmOperation('确认移动');

    expect(repository.move).toHaveBeenCalledWith('folder-a', {
      parentId: 'other',
    });
  });

  it('permanently deletes a bookmark after explicit confirmation', async () => {
    const repository = await renderReady();

    fireEvent.click(
      screen.getByRole('button', { name: '删除 important.example.test' }),
    );

    const confirm = await screen.findByRole('dialog', { name: '确认删除' });
    expect(within(confirm).getByText('删除后无法恢复')).toBeTruthy();
    await confirmOperation('确认删除');

    expect(repository.remove).toHaveBeenCalledWith('icon-only');
    expect(repository.createFolder).not.toHaveBeenCalled();
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

  it('opens edit, move, and permanent delete actions from a bookmark row context menu', async () => {
    await renderReady();
    const row = screen.getByText('important.example.test').closest('.bookmark-row') as HTMLElement;

    fireEvent.contextMenu(row, { clientX: 120, clientY: 80 });

    const menu = screen.getByRole('menu', { name: 'important.example.test 操作' });
    expect(within(menu).getByRole('menuitem', { name: '编辑' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: '移动' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: '删除' })).toBeTruthy();
    expect(within(menu).queryByText(/待删除/)).toBeNull();
  });
});
