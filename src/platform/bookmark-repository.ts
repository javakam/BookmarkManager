import type { BrowserBookmarkNode } from '../domain/bookmarks';
import {
  getBrowserBookmarksApi,
  type BrowserBookmarkEvent,
  type BrowserBookmarksApi,
} from './browser';

export interface BookmarkRepository {
  getTree(): Promise<BrowserBookmarkNode[]>;
  createBookmark(input: {
    parentId: string;
    index?: number;
    title: string;
    url: string;
  }): Promise<BrowserBookmarkNode>;
  createFolder(input: {
    parentId: string;
    index?: number;
    title: string;
  }): Promise<BrowserBookmarkNode>;
  update(
    id: string,
    changes: { title?: string; url?: string },
  ): Promise<BrowserBookmarkNode>;
  move(
    id: string,
    destination: { parentId: string; index?: number },
  ): Promise<BrowserBookmarkNode>;
  remove(id: string): Promise<void>;
  onChanged(listener: () => void): () => void;
}

function mapBrowserBookmarkNode(
  node: BrowserBookmarkNode,
): BrowserBookmarkNode {
  return {
    id: node.id,
    parentId: node.parentId,
    index: node.index,
    title: node.title,
    url: node.url,
    children: node.children?.map(mapBrowserBookmarkNode),
    unmodifiable: node.unmodifiable,
    folderType: node.folderType,
    dateAdded: node.dateAdded,
  };
}

export function createChromeBookmarkRepository(
  api?: BrowserBookmarksApi,
): BookmarkRepository {
  const resolveApi = () => api ?? getBrowserBookmarksApi();

  return {
    async getTree() {
      return (await resolveApi().getTree()).map(mapBrowserBookmarkNode);
    },
    async createBookmark(input) {
      const created = await resolveApi().create({
        parentId: input.parentId,
        title: input.title,
        url: input.url,
        ...(input.index === undefined ? {} : { index: input.index }),
      });
      return mapBrowserBookmarkNode(created);
    },
    async createFolder(input) {
      const created = await resolveApi().create({
        parentId: input.parentId,
        title: input.title,
        ...(input.index === undefined ? {} : { index: input.index }),
      });
      return mapBrowserBookmarkNode(created);
    },
    async update(id, changes) {
      return mapBrowserBookmarkNode(await resolveApi().update(id, changes));
    },
    async move(id, destination) {
      return mapBrowserBookmarkNode(
        await resolveApi().move(id, destination),
      );
    },
    async remove(id) {
      await resolveApi().remove(id);
    },
    onChanged(listener) {
      const resolvedApi = resolveApi();
      const events = [
        resolvedApi.onCreated,
        resolvedApi.onRemoved,
        resolvedApi.onChanged,
        resolvedApi.onMoved,
        resolvedApi.onChildrenReordered,
        resolvedApi.onImportEnded,
      ].filter(
        (event): event is BrowserBookmarkEvent => event !== undefined,
      );
      let isActive = true;
      const handleChange = () => {
        if (isActive) {
          listener();
        }
      };

      for (const event of events) {
        event.addListener(handleChange);
      }

      return () => {
        if (!isActive) {
          return;
        }
        isActive = false;
        for (const event of events) {
          event.removeListener(handleChange);
        }
      };
    },
  };
}
