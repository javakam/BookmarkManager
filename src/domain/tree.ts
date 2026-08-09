import type { BookmarkRecord, BrowserBookmarkNode } from './bookmarks';

export function flattenBookmarkTree(
  nodes: BrowserBookmarkNode[],
): BookmarkRecord[] {
  const records: BookmarkRecord[] = [];
  const pending: Array<{
    readonly node: BrowserBookmarkNode;
    readonly fallbackIndex: number;
    readonly path: string[];
    readonly depth: number;
    readonly ancestorIsUnmodifiable: boolean;
    readonly ancestorIsBookmarkBar: boolean;
    readonly parentIsSyntheticRoot: boolean;
  }> = [];
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node) {
      pending.push({
        node,
        fallbackIndex: index,
        path: [],
        depth: 0,
        ancestorIsUnmodifiable: false,
        ancestorIsBookmarkBar: false,
        parentIsSyntheticRoot: false,
      });
    }
  }

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }
    const {
      node,
      fallbackIndex,
      path,
      depth,
      ancestorIsUnmodifiable,
      ancestorIsBookmarkBar,
      parentIsSyntheticRoot,
    } = current;
    const folderType =
      node.folderType ??
      (parentIsSyntheticRoot && fallbackIndex === 0
        ? 'bookmarks-bar'
        : parentIsSyntheticRoot && fallbackIndex === 1
          ? 'other'
          : parentIsSyntheticRoot && fallbackIndex === 2
            ? 'mobile'
            : 'unknown');
    const isFolder = !node.url;
    const isUnmodifiable =
      ancestorIsUnmodifiable || node.unmodifiable !== undefined;
    const isBookmarkBar =
      ancestorIsBookmarkBar || folderType === 'bookmarks-bar';

    records.push({
      id: node.id,
      parentId: node.parentId,
      index: node.index ?? fallbackIndex,
      title: node.title,
      url: node.url,
      path,
      depth,
      isFolder,
      isRoot: node.parentId === undefined,
      isUnmodifiable,
      isBookmarkBar,
      folderType,
      dateAdded: node.dateAdded,
    });

    const childPath = isFolder ? [...path, node.title] : path;
    const isSyntheticRoot =
      node.parentId === undefined && isFolder && node.title.trim() === '';
    const children = node.children ?? [];
    for (let childIndex = children.length - 1; childIndex >= 0; childIndex -= 1) {
      const child = children[childIndex];
      if (child) {
        pending.push({
          node: child,
          fallbackIndex: childIndex,
          path: childPath,
          depth: depth + 1,
          ancestorIsUnmodifiable: isUnmodifiable,
          ancestorIsBookmarkBar: isBookmarkBar,
          parentIsSyntheticRoot: isSyntheticRoot,
        });
      }
    }
  }

  return records;
}
