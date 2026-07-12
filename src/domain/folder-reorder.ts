import type { BookmarkRecord } from './bookmarks';

export type FolderDropPosition = 'before' | 'after';

export interface FolderMoveDestination {
  readonly parentId: string;
  readonly index: number;
}

export function calculateFolderMove(
  siblings: readonly BookmarkRecord[],
  sourceId: string,
  anchorId: string,
  position: FolderDropPosition,
): FolderMoveDestination | undefined {
  if (sourceId === anchorId) {
    return undefined;
  }

  const orderedSiblings = [...siblings].sort(
    (left, right) => left.index - right.index || left.id.localeCompare(right.id),
  );
  const source = orderedSiblings.find((record) => record.id === sourceId);
  const anchor = orderedSiblings.find((record) => record.id === anchorId);

  if (
    !source?.isFolder ||
    !anchor?.isFolder ||
    source.parentId === undefined ||
    source.parentId !== anchor.parentId
  ) {
    return undefined;
  }

  const remaining = orderedSiblings.filter((record) => record.id !== source.id);
  const anchorIndex = remaining.findIndex((record) => record.id === anchor.id);
  if (anchorIndex < 0) {
    return undefined;
  }

  return {
    parentId: source.parentId,
    index: position === 'before' ? anchorIndex : anchorIndex + 1,
  };
}
