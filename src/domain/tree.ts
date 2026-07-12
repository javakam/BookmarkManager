import type { BookmarkRecord, BrowserBookmarkNode } from './bookmarks';

export function flattenBookmarkTree(
  nodes: BrowserBookmarkNode[],
): BookmarkRecord[] {
  const records: BookmarkRecord[] = [];

  function visit(
    node: BrowserBookmarkNode,
    fallbackIndex: number,
    path: string[],
    depth: number,
    ancestorIsUnmodifiable: boolean,
    ancestorIsBookmarkBar: boolean,
  ): void {
    const folderType = node.folderType ?? 'unknown';
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
    node.children?.forEach((child, childIndex) => {
      visit(
        child,
        childIndex,
        childPath,
        depth + 1,
        isUnmodifiable,
        isBookmarkBar,
      );
    });
  }

  nodes.forEach((node, index) => {
    visit(node, index, [], 0, false, false);
  });

  return records;
}
