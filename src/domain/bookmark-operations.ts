import type { BookmarkRecord } from './bookmarks';

export const QUARANTINE_FOLDER_TITLE = '待删除（书签工作台）';

export type BookmarkOperationKind =
  | 'create-bookmark'
  | 'create-folder'
  | 'update'
  | 'move'
  | 'reorder'
  | 'quarantine'
  | 'restore';

export interface BookmarkFingerprint {
  readonly id: string;
  readonly parentId?: string;
  readonly index: number;
  readonly title: string;
  readonly url?: string;
  readonly isFolder: boolean;
  readonly isUnmodifiable: boolean;
}

export interface BookmarkOperationResult {
  readonly id: string;
  readonly status: 'success' | 'conflict' | 'failure';
  readonly message: string;
}

export interface BookmarkOperationExecution {
  readonly kind: BookmarkOperationKind;
  readonly results: readonly BookmarkOperationResult[];
}

export type ValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: string };

export function createBookmarkFingerprint(
  record: BookmarkRecord,
): BookmarkFingerprint {
  return {
    id: record.id,
    parentId: record.parentId,
    index: record.index,
    title: record.title,
    url: record.url,
    isFolder: record.isFolder,
    isUnmodifiable: record.isUnmodifiable,
  };
}

export function compareBookmarkFingerprint(
  expected: BookmarkFingerprint,
  actual: BookmarkFingerprint,
): boolean {
  return (
    expected.id === actual.id &&
    expected.parentId === actual.parentId &&
    expected.index === actual.index &&
    expected.title === actual.title &&
    expected.url === actual.url &&
    expected.isFolder === actual.isFolder &&
    expected.isUnmodifiable === actual.isUnmodifiable
  );
}

export function sortRecordsInBrowserOrder(
  records: readonly BookmarkRecord[],
): readonly BookmarkRecord[] {
  return [...records].sort((left, right) => {
    const leftPath = left.path.join('\u0000');
    const rightPath = right.path.join('\u0000');
    return (
      leftPath.localeCompare(rightPath) ||
      (left.parentId ?? '').localeCompare(right.parentId ?? '') ||
      left.index - right.index ||
      left.id.localeCompare(right.id)
    );
  });
}

export function validateWritableRecord(record: BookmarkRecord): ValidationResult {
  if (record.isRoot) {
    return { valid: false, reason: '根目录不能移动' };
  }
  if (record.isUnmodifiable) {
    return { valid: false, reason: '只读书签不能修改' };
  }
  return { valid: true };
}

export function validateMoveTarget(
  records: readonly BookmarkRecord[],
  source: BookmarkRecord,
  targetFolderId: string,
): ValidationResult {
  const writable = validateWritableRecord(source);
  if (!writable.valid) {
    return writable;
  }

  const target = records.find((record) => record.id === targetFolderId);
  if (!target?.isFolder) {
    return { valid: false, reason: '目标文件夹不存在' };
  }
  if (target.isUnmodifiable) {
    return { valid: false, reason: '目标文件夹只读' };
  }

  if (source.isFolder) {
    let current: BookmarkRecord | undefined = target;
    const byId = new Map(records.map((record) => [record.id, record]));
    while (current) {
      if (current.id === source.id) {
        return { valid: false, reason: '不能移动到自身或子文件夹' };
      }
      current =
        current.parentId === undefined
          ? undefined
          : byId.get(current.parentId);
    }
  }

  return { valid: true };
}

export function findOtherBookmarksFolder(
  records: readonly BookmarkRecord[],
): BookmarkRecord | undefined {
  return records.find(
    (record) =>
      record.isFolder &&
      !record.isRoot &&
      (record.folderType === 'other' || record.title === '其他书签'),
  );
}

export function findExactQuarantineFolder(
  records: readonly BookmarkRecord[],
): BookmarkRecord | undefined {
  return records.find(
    (record) => record.isFolder && record.title === QUARANTINE_FOLDER_TITLE,
  );
}
