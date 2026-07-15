import { browser } from 'wxt/browser';

import type { BrowserBookmarkNode } from '../domain/bookmarks';

export interface BrowserCreateDetails {
  parentId: string;
  index?: number;
  title: string;
  url?: string;
}

export interface BrowserUpdateChanges {
  title?: string;
  url?: string;
}

export interface BrowserMoveDestination {
  parentId: string;
  index?: number;
}

export interface BrowserBookmarkEvent {
  addListener(listener: () => void): void;
  removeListener(listener: () => void): void;
}

export interface BrowserBookmarksApi {
  getTree(): Promise<BrowserBookmarkNode[]>;
  create(details: BrowserCreateDetails): Promise<BrowserBookmarkNode>;
  update(
    id: string,
    changes: BrowserUpdateChanges,
  ): Promise<BrowserBookmarkNode>;
  move(
    id: string,
    destination: BrowserMoveDestination,
  ): Promise<BrowserBookmarkNode>;
  remove(id: string): Promise<void>;
  removeTree?(id: string): Promise<void>;
  onCreated?: BrowserBookmarkEvent;
  onRemoved?: BrowserBookmarkEvent;
  onChanged?: BrowserBookmarkEvent;
  onMoved?: BrowserBookmarkEvent;
  onChildrenReordered?: BrowserBookmarkEvent;
  onImportBegan?: BrowserBookmarkEvent;
  onImportEnded?: BrowserBookmarkEvent;
}

export function getBrowserBookmarksApi(): BrowserBookmarksApi {
  return browser.bookmarks as unknown as BrowserBookmarksApi;
}
