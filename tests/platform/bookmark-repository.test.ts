import { describe, expect, it } from 'vitest';

import type { BrowserBookmarkNode } from '../../src/domain/bookmarks';
import {
  createChromeBookmarkRepository,
  type BookmarkRepository,
  type BookmarkRepositoryChange,
} from '../../src/platform/bookmark-repository';
import type {
  BrowserBookmarkEvent,
  BrowserBookmarksApi,
  BrowserCreateDetails,
  BrowserMoveDestination,
  BrowserUpdateChanges,
} from '../../src/platform/browser';

class EventStub implements BrowserBookmarkEvent {
  private readonly listeners = new Set<() => void>();

  addListener(listener: () => void): void {
    this.listeners.add(listener);
  }

  removeListener(listener: () => void): void {
    this.listeners.delete(listener);
  }

  fire(..._eventArguments: unknown[]): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  get size(): number {
    return this.listeners.size;
  }
}

type Operation = 'getTree' | 'create' | 'update' | 'move' | 'remove';

class BookmarksApiStub implements BrowserBookmarksApi {
  tree: BrowserBookmarkNode[] = [];
  errors: Partial<Record<Operation, Error>> = {};
  readonly createInputs: BrowserCreateDetails[] = [];
  readonly updateInputs: Array<{
    id: string;
    changes: BrowserUpdateChanges;
  }> = [];
  readonly moveInputs: Array<{
    id: string;
    destination: BrowserMoveDestination;
  }> = [];
  readonly removeInputs: string[] = [];

  readonly onCreated = new EventStub();
  readonly onRemoved = new EventStub();
  readonly onChanged = new EventStub();
  readonly onMoved = new EventStub();
  readonly onChildrenReordered = new EventStub();
  readonly onImportEnded = new EventStub();
  readonly onImportBegan = new EventStub();

  async getTree(): Promise<BrowserBookmarkNode[]> {
    this.fail('getTree');
    return this.tree;
  }

  async create(details: BrowserCreateDetails): Promise<BrowserBookmarkNode> {
    this.fail('create');
    this.createInputs.push(details);
    return {
      id: `created-${this.createInputs.length}`,
      parentId: details.parentId,
      index: details.index,
      title: details.title,
      url: details.url,
    };
  }

  async update(
    id: string,
    changes: BrowserUpdateChanges,
  ): Promise<BrowserBookmarkNode> {
    this.fail('update');
    this.updateInputs.push({ id, changes });
    return { id, title: changes.title ?? 'Existing', url: changes.url };
  }

  async move(
    id: string,
    destination: BrowserMoveDestination,
  ): Promise<BrowserBookmarkNode> {
    this.fail('move');
    this.moveInputs.push({ id, destination });
    return {
      id,
      parentId: destination.parentId,
      index: destination.index,
      title: 'Moved',
    };
  }

  async remove(id: string): Promise<void> {
    this.fail('remove');
    this.removeInputs.push(id);
  }

  private fail(operation: Operation): void {
    const error = this.errors[operation];
    if (error !== undefined) {
      throw error;
    }
  }
}

describe('createChromeBookmarkRepository', () => {
  it('constructs without reading the browser API in a Node environment', () => {
    expect(() => createChromeBookmarkRepository()).not.toThrow();
  });

  it('maps a recursive browser tree without adding a title or leaking browser-only fields', async () => {
    const api = new BookmarksApiStub();
    const rawTree = [
      {
        id: 'root',
        title: '',
        dateAdded: 10,
        children: [
          {
            id: 'managed-child',
            parentId: 'root',
            index: 0,
            title: '',
            url: 'file:///C:/temp/index.html',
            unmodifiable: 'managed' as const,
            folderType: 'managed' as const,
            dateAdded: 20,
            syncing: false,
          },
        ],
        syncing: true,
      },
    ];
    api.tree = rawTree;

    const result = await createChromeBookmarkRepository(api).getTree();

    expect(result).not.toBe(rawTree);
    expect(result[0]).toMatchObject({
      id: 'root',
      parentId: undefined,
      index: undefined,
      title: '',
      url: undefined,
      unmodifiable: undefined,
      folderType: undefined,
      dateAdded: 10,
    });
    expect(result[0]?.children?.[0]).toMatchObject({
      id: 'managed-child',
      parentId: 'root',
      index: 0,
      title: '',
      url: 'file:///C:/temp/index.html',
      unmodifiable: 'managed',
      folderType: 'managed',
      dateAdded: 20,
    });
    expect(result[0]).not.toHaveProperty('syncing');
    expect(result[0]?.children?.[0]).not.toHaveProperty('syncing');
  });

  it('creates a bookmark with the exact parent, index, empty title, and URL', async () => {
    const api = new BookmarksApiStub();
    const repository = createChromeBookmarkRepository(api);

    const result = await repository.createBookmark({
      parentId: 'parent',
      index: 3,
      title: '',
      url: 'file:///C:/bookmarks/readme.html',
    });

    expect(api.createInputs).toEqual([
      {
        parentId: 'parent',
        index: 3,
        title: '',
        url: 'file:///C:/bookmarks/readme.html',
      },
    ]);
    expect(result).toMatchObject({
      id: 'created-1',
      title: '',
      url: 'file:///C:/bookmarks/readme.html',
    });
  });

  it('creates a folder without sending a url or an absent index', async () => {
    const api = new BookmarksApiStub();
    const repository = createChromeBookmarkRepository(api);

    const result = await repository.createFolder({
      parentId: 'parent',
      title: '',
    });

    expect(api.createInputs).toEqual([
      { parentId: 'parent', title: '' },
    ]);
    expect(result).toMatchObject({
      id: 'created-1',
      parentId: 'parent',
      title: '',
      url: undefined,
    });
  });

  it('forwards update changes exactly, including empty strings', async () => {
    const api = new BookmarksApiStub();
    const repository = createChromeBookmarkRepository(api);

    const result = await repository.update('bookmark', {
      title: '',
      url: '',
    });

    expect(api.updateInputs).toEqual([
      { id: 'bookmark', changes: { title: '', url: '' } },
    ]);
    expect(result).toMatchObject({ id: 'bookmark', title: '', url: '' });
  });

  it('forwards move destinations exactly and preserves index zero', async () => {
    const api = new BookmarksApiStub();
    const repository = createChromeBookmarkRepository(api);

    const result = await repository.move('bookmark', {
      parentId: 'destination',
      index: 0,
    });

    expect(api.moveInputs).toEqual([
      {
        id: 'bookmark',
        destination: { parentId: 'destination', index: 0 },
      },
    ]);
    expect(result).toMatchObject({
      id: 'bookmark',
      parentId: 'destination',
      index: 0,
    });
  });

  it('removes the requested bookmark and resolves only after the API resolves', async () => {
    const api = new BookmarksApiStub();
    const repository = createChromeBookmarkRepository(api);

    await expect(repository.remove('bookmark')).resolves.toBeUndefined();
    expect(api.removeInputs).toEqual(['bookmark']);
  });

  it.each<[
    string,
    Operation,
    (repository: BookmarkRepository) => Promise<unknown>,
  ]>([
    ['getTree', 'getTree', (repository) => repository.getTree()],
    [
      'createBookmark',
      'create',
      (repository) =>
        repository.createBookmark({
          parentId: 'parent',
          title: 'Bookmark',
          url: 'https://example.test',
        }),
    ],
    [
      'createFolder',
      'create',
      (repository) =>
        repository.createFolder({ parentId: 'parent', title: 'Folder' }),
    ],
    [
      'update',
      'update',
      (repository) => repository.update('bookmark', { title: 'Changed' }),
    ],
    [
      'move',
      'move',
      (repository) =>
        repository.move('bookmark', { parentId: 'destination' }),
    ],
    ['remove', 'remove', (repository) => repository.remove('bookmark')],
  ])('rethrows the exact API rejection from %s', async (_name, operation, invoke) => {
    const api = new BookmarksApiStub();
    const rejection = new Error(`${operation} failed`);
    api.errors[operation] = rejection;

    await expect(invoke(createChromeBookmarkRepository(api))).rejects.toBe(
      rejection,
    );
  });

  it('reports every ordinary browser mutation as changed', () => {
    const api = new BookmarksApiStub();
    const repository = createChromeBookmarkRepository(api);
    const changes: BookmarkRepositoryChange[] = [];

    const unsubscribe = repository.onChanged((change) => {
      changes.push(change);
    });

    api.onCreated.fire('created', { id: 'created', title: 'Created' });
    api.onRemoved.fire('removed', { parentId: 'root', index: 0 });
    api.onChanged.fire('changed', { title: 'Changed' });
    api.onMoved.fire('moved', { parentId: 'target', index: 0 });
    api.onChildrenReordered.fire('root', { childIds: ['changed'] });

    expect(changes).toEqual([
      'changed',
      'changed',
      'changed',
      'changed',
      'changed',
    ]);
    unsubscribe();
  });

  it('reports browser import lifecycle events distinctly', () => {
    const api = new BookmarksApiStub();
    const repository = createChromeBookmarkRepository(api);
    const changes: BookmarkRepositoryChange[] = [];

    const unsubscribe = repository.onChanged((change) => {
      changes.push(change);
    });

    api.onImportBegan.fire();
    api.onImportEnded.fire();

    expect(changes).toEqual(['import-began', 'import-ended']);
    unsubscribe();
  });

  it('subscribes to every browser event and fully detaches on unsubscribe', () => {
    const api = new BookmarksApiStub();
    const repository = createChromeBookmarkRepository(api);
    const subscribedEvents = [
      api.onCreated,
      api.onRemoved,
      api.onChanged,
      api.onMoved,
      api.onChildrenReordered,
      api.onImportBegan,
      api.onImportEnded,
    ];
    let notificationCount = 0;

    const unsubscribe = repository.onChanged(() => {
      notificationCount += 1;
    });

    expect(subscribedEvents.map((event) => event.size)).toEqual([
      1, 1, 1, 1, 1, 1, 1,
    ]);

    api.onCreated.fire('created', { id: 'created', title: 'Created' });
    api.onRemoved.fire('removed', { parentId: 'root', index: 0 });
    api.onChanged.fire('changed', { title: 'Changed' });
    api.onMoved.fire('moved', { parentId: 'target', index: 0 });
    api.onChildrenReordered.fire('root', { childIds: ['changed'] });
    api.onImportEnded.fire();
    api.onImportBegan.fire();
    expect(notificationCount).toBe(7);

    unsubscribe();
    expect(subscribedEvents.map((event) => event.size)).toEqual([
      0, 0, 0, 0, 0, 0, 0,
    ]);

    expect(() => {
      for (const event of subscribedEvents) {
        event.fire('late event after unmount');
      }
    }).not.toThrow();
    expect(notificationCount).toBe(7);

    unsubscribe();
    expect(subscribedEvents.map((event) => event.size)).toEqual([
      0, 0, 0, 0, 0, 0, 0,
    ]);
  });
});
