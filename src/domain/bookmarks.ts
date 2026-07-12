export type BookmarkFolderType =
  | 'bookmarks-bar'
  | 'other'
  | 'mobile'
  | 'managed'
  | 'unknown';

export type BookmarkUnmodifiable = 'managed' | 'readonly';

export interface BrowserBookmarkNode {
  id: string;
  parentId?: string;
  index?: number;
  title: string;
  url?: string;
  children?: BrowserBookmarkNode[];
  unmodifiable?: BookmarkUnmodifiable;
  folderType?: BookmarkFolderType;
  dateAdded?: number;
}

export type BrowserBookmarkTreeNode = BrowserBookmarkNode;

export interface BookmarkRecord {
  readonly id: string;
  readonly parentId?: string;
  readonly index: number;
  readonly title: string;
  readonly url?: string;
  readonly path: readonly string[];
  readonly depth: number;
  readonly isFolder: boolean;
  readonly isRoot: boolean;
  readonly isUnmodifiable: boolean;
  readonly isBookmarkBar: boolean;
  readonly folderType: BookmarkFolderType;
  readonly dateAdded?: number;
}
