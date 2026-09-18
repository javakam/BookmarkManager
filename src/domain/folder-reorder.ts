import type { BookmarkRecord } from './bookmarks';

export type BookmarkDropPosition = 'before' | 'after';
export type FolderDropPosition = BookmarkDropPosition;

export interface FolderMoveDestination {
  readonly parentId: string;
  readonly index: number;
}

export function calculateBookmarkMove(
  siblings: readonly BookmarkRecord[],
  sourceId: string,
  anchorId: string,
  position: BookmarkDropPosition,
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
    !source ||
    !anchor ||
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

  const sourceIndex = orderedSiblings.findIndex((record) => record.id === source.id);
  const finalIndex = position === 'before' ? anchorIndex : anchorIndex + 1;
  if (finalIndex === sourceIndex) {
    return undefined;
  }

  return {
    parentId: source.parentId,
    // The browser bookmarks API calculates same-parent moves against the
    // pre-move sibling list, so a downward move needs one extra index.
    index: sourceIndex < finalIndex ? finalIndex + 1 : finalIndex,
  };
}

export function calculateFolderMove(
  siblings: readonly BookmarkRecord[],
  sourceId: string,
  anchorId: string,
  position: FolderDropPosition,
): FolderMoveDestination | undefined {
  const source = siblings.find((record) => record.id === sourceId);
  const anchor = siblings.find((record) => record.id === anchorId);
  if (!source?.isFolder || !anchor?.isFolder) {
    return undefined;
  }

  return calculateBookmarkMove(siblings, sourceId, anchorId, position);
}
