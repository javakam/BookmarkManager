import type { BookmarkRecord } from '../domain/bookmarks';

export interface BookmarkDisplayInfo {
  readonly displayTitle: string;
  readonly host: string;
  readonly isIconOnly: boolean;
}

export interface BookmarkViewModel {
  readonly recordById: ReadonlyMap<string, BookmarkRecord>;
  readonly childrenByParentId: ReadonlyMap<string, readonly BookmarkRecord[]>;
  readonly directBookmarkCountByFolderId: ReadonlyMap<string, number>;
  readonly totalBookmarkCountByFolderId: ReadonlyMap<string, number>;
  readonly syntheticRootIds: ReadonlySet<string>;
  readonly topLevelFolders: readonly BookmarkRecord[];
  readonly searchableRecords: readonly BookmarkRecord[];
  readonly defaultFolderId?: string;
  getBreadcrumbs(folderId: string): readonly BookmarkRecord[];
  getDescendantIds(folderId: string): ReadonlySet<string>;
  resolveFolderId(folderId?: string): string | undefined;
}

function compareBrowserOrder(
  left: BookmarkRecord,
  right: BookmarkRecord,
): number {
  return left.index - right.index || left.id.localeCompare(right.id);
}

function isSyntheticRoot(record: BookmarkRecord): boolean {
  return record.isRoot && record.isFolder && record.title.trim() === '';
}

function getHost(url: string | undefined): string {
  if (!url) {
    return '';
  }

  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

export function getBookmarkDisplayInfo(
  record: BookmarkRecord,
): BookmarkDisplayInfo {
  const host = getHost(record.url);
  if (record.isFolder) {
    return {
      displayTitle: record.title || '未命名文件夹',
      host: '',
      isIconOnly: false,
    };
  }

  const isIconOnly = record.title === '';
  return {
    displayTitle: isIconOnly
      ? host || record.url || '仅图标显示'
      : record.title,
    host,
    isIconOnly,
  };
}

export function createBookmarkViewModel(
  records: readonly BookmarkRecord[],
): BookmarkViewModel {
  const recordById = new Map(records.map((record) => [record.id, record]));
  const mutableChildren = new Map<string, BookmarkRecord[]>();

  for (const record of records) {
    if (record.parentId === undefined) {
      continue;
    }
    const siblings = mutableChildren.get(record.parentId) ?? [];
    siblings.push(record);
    mutableChildren.set(record.parentId, siblings);
  }

  const childrenByParentId = new Map<string, readonly BookmarkRecord[]>();
  for (const [parentId, children] of mutableChildren) {
    childrenByParentId.set(parentId, [...children].sort(compareBrowserOrder));
  }

  const directBookmarkCountByFolderId = new Map<string, number>();
  const totalBookmarkCountByFolderId = new Map<string, number>();
  const remainingChildFolderCountById = new Map<string, number>();

  for (const record of records) {
    if (record.isFolder) {
      directBookmarkCountByFolderId.set(record.id, 0);
      totalBookmarkCountByFolderId.set(record.id, 0);
      remainingChildFolderCountById.set(record.id, 0);
    }
  }

  for (const record of records) {
    if (record.parentId === undefined) {
      continue;
    }
    if (record.isFolder) {
      if (remainingChildFolderCountById.has(record.parentId)) {
        remainingChildFolderCountById.set(
          record.parentId,
          (remainingChildFolderCountById.get(record.parentId) ?? 0) + 1,
        );
      }
    } else if (directBookmarkCountByFolderId.has(record.parentId)) {
      directBookmarkCountByFolderId.set(
        record.parentId,
        (directBookmarkCountByFolderId.get(record.parentId) ?? 0) + 1,
      );
    }
  }

  const pendingFolders: string[] = [];
  for (const [folderId, directCount] of directBookmarkCountByFolderId) {
    totalBookmarkCountByFolderId.set(folderId, directCount);
    if (remainingChildFolderCountById.get(folderId) === 0) {
      pendingFolders.push(folderId);
    }
  }

  for (let cursor = 0; cursor < pendingFolders.length; cursor += 1) {
    const folderId = pendingFolders[cursor];
    const parentId = recordById.get(folderId)?.parentId;
    if (parentId === undefined || !totalBookmarkCountByFolderId.has(parentId)) {
      continue;
    }
    totalBookmarkCountByFolderId.set(
      parentId,
      (totalBookmarkCountByFolderId.get(parentId) ?? 0) +
        (totalBookmarkCountByFolderId.get(folderId) ?? 0),
    );
    const remaining = (remainingChildFolderCountById.get(parentId) ?? 0) - 1;
    remainingChildFolderCountById.set(parentId, remaining);
    if (remaining === 0) {
      pendingFolders.push(parentId);
    }
  }

  const roots = records
    .filter((record) => record.parentId === undefined)
    .sort(compareBrowserOrder);
  const syntheticRootIds = new Set(
    roots.filter(isSyntheticRoot).map(({ id }) => id),
  );
  const topLevelFolders = roots.flatMap((root) => {
    if (!syntheticRootIds.has(root.id)) {
      return root.isFolder ? [root] : [];
    }
    return (childrenByParentId.get(root.id) ?? []).filter(
      (record) => record.isFolder,
    );
  });
  const defaultFolder =
    topLevelFolders.find(
      (record) =>
        record.folderType === 'bookmarks-bar' || record.isBookmarkBar,
    ) ?? topLevelFolders[0];

  const getBreadcrumbs = (folderId: string): readonly BookmarkRecord[] => {
    const breadcrumbs: BookmarkRecord[] = [];
    const visited = new Set<string>();
    let current = recordById.get(folderId);

    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      if (current.isFolder && !syntheticRootIds.has(current.id)) {
        breadcrumbs.push(current);
      }
      current =
        current.parentId === undefined
          ? undefined
          : recordById.get(current.parentId);
    }

    return breadcrumbs.reverse();
  };

  const getDescendantIds = (folderId: string): ReadonlySet<string> => {
    const descendants = new Set<string>();
    const pending = [...(childrenByParentId.get(folderId) ?? [])].reverse();

    while (pending.length > 0) {
      const current = pending.pop();
      if (!current || descendants.has(current.id)) {
        continue;
      }
      descendants.add(current.id);
      if (current.isFolder) {
        const children = childrenByParentId.get(current.id) ?? [];
        for (let index = children.length - 1; index >= 0; index -= 1) {
          pending.push(children[index]);
        }
      }
    }

    return descendants;
  };

  const resolveFolderId = (folderId?: string): string | undefined => {
    if (folderId) {
      const folder = recordById.get(folderId);
      if (folder?.isFolder && !syntheticRootIds.has(folder.id)) {
        return folder.id;
      }
    }
    return defaultFolder?.id;
  };

  return {
    recordById,
    childrenByParentId,
    directBookmarkCountByFolderId,
    totalBookmarkCountByFolderId,
    syntheticRootIds,
    topLevelFolders,
    searchableRecords: records.filter(
      (record) => !syntheticRootIds.has(record.id),
    ),
    defaultFolderId: defaultFolder?.id,
    getBreadcrumbs,
    getDescendantIds,
    resolveFolderId,
  };
}
