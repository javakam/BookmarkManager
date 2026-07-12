import type { BookmarkRecord } from '../domain/bookmarks';
import {
  QUARANTINE_FOLDER_TITLE,
  compareBookmarkFingerprint,
  createBookmarkFingerprint,
  findExactQuarantineFolder,
  isQuarantineFolder,
  findOtherBookmarksFolder,
  sortRecordsInBrowserOrder,
  validateMoveTarget,
  validateWritableRecord,
  type BookmarkFingerprint,
  type BookmarkOperationExecution,
  type BookmarkOperationKind,
  type BookmarkOperationResult,
} from '../domain/bookmark-operations';
import { flattenBookmarkTree } from '../domain/tree';
import type { BookmarkRepository } from '../platform/bookmark-repository';
import type {
  BookmarkOperationStorage,
  BookmarkRecoveryEntry,
} from '../platform/bookmark-operation-storage';

type PlanBase = {
  readonly id: string;
  readonly kind: BookmarkOperationKind;
  readonly createdAt: number;
};

type CreateBookmarkPlan = PlanBase & {
  readonly kind: 'create-bookmark';
  readonly parent: BookmarkFingerprint;
  readonly title: string;
  readonly url: string;
  readonly index?: number;
};

type CreateFolderPlan = PlanBase & {
  readonly kind: 'create-folder';
  readonly parent: BookmarkFingerprint;
  readonly title: string;
  readonly index?: number;
};

type UpdatePlan = PlanBase & {
  readonly kind: 'update';
  readonly source: BookmarkFingerprint;
  readonly changes: { readonly title?: string; readonly url?: string };
};

type MovePlan = PlanBase & {
  readonly kind: 'move' | 'reorder';
  readonly sources: readonly BookmarkFingerprint[];
  readonly target: BookmarkFingerprint;
  readonly index?: number;
  readonly siblings?: readonly BookmarkFingerprint[];
};

type QuarantinePlan = PlanBase & {
  readonly kind: 'quarantine';
  readonly sources: readonly BookmarkFingerprint[];
};

type RestorePlan = PlanBase & {
  readonly kind: 'restore';
  readonly entries: readonly BookmarkRecoveryEntry[];
  readonly fallbackParentId?: string;
};

export type BookmarkOperationPlan =
  | CreateBookmarkPlan
  | CreateFolderPlan
  | UpdatePlan
  | MovePlan
  | QuarantinePlan
  | RestorePlan;

export interface BookmarkOperationService {
  planCreateBookmark(
    records: readonly BookmarkRecord[],
    input: {
      readonly parentId: string;
      readonly title: string;
      readonly url: string;
      readonly index?: number;
    },
  ): CreateBookmarkPlan;
  planCreateFolder(
    records: readonly BookmarkRecord[],
    input: {
      readonly parentId: string;
      readonly title: string;
      readonly index?: number;
    },
  ): CreateFolderPlan;
  planUpdate(
    records: readonly BookmarkRecord[],
    id: string,
    changes: { readonly title?: string; readonly url?: string },
  ): UpdatePlan;
  planMove(
    records: readonly BookmarkRecord[],
    ids: readonly string[],
    destination: { readonly parentId: string; readonly index?: number },
  ): MovePlan;
  planReorder(
    records: readonly BookmarkRecord[],
    id: string,
    destination: { readonly parentId: string; readonly index: number },
  ): MovePlan;
  planQuarantine(
    records: readonly BookmarkRecord[],
    ids: readonly string[],
  ): QuarantinePlan;
  planRestore(
    entries: readonly BookmarkRecoveryEntry[],
    fallbackParentId?: string,
  ): RestorePlan;
  execute(plan: BookmarkOperationPlan): Promise<BookmarkOperationExecution>;
}

export interface BookmarkOperationServiceOptions {
  readonly repository: BookmarkRepository;
  readonly storage: BookmarkOperationStorage;
  readonly now?: () => number;
}

const CONFLICT_MESSAGE = '书签已在浏览器中变化，请刷新后重试';

function operationId(now: number): string {
  return `operation-${now}-${Math.random().toString(36).slice(2)}`;
}

function createFailure(id: string, error: unknown): BookmarkOperationResult {
  return {
    id,
    status: 'failure',
    message: error instanceof Error ? error.message : String(error),
  };
}

function recordsById(
  records: readonly BookmarkRecord[],
): ReadonlyMap<string, BookmarkRecord> {
  return new Map(records.map((record) => [record.id, record]));
}

function requireRecord(
  records: readonly BookmarkRecord[],
  id: string,
): BookmarkRecord {
  const record = records.find((candidate) => candidate.id === id);
  if (!record) {
    throw new Error('书签不存在');
  }
  return record;
}

function requireWritableFolder(
  records: readonly BookmarkRecord[],
  id: string,
): BookmarkRecord {
  const record = requireRecord(records, id);
  if (!record.isFolder) {
    throw new Error('目标文件夹不存在');
  }
  if (record.isRoot || record.isUnmodifiable) {
    throw new Error(record.isUnmodifiable ? '目标文件夹只读' : '根目录不能写入');
  }
  return record;
}

function requireCurrentFingerprint(
  byId: ReadonlyMap<string, BookmarkRecord>,
  expected: BookmarkFingerprint,
): BookmarkRecord | undefined {
  const current = byId.get(expected.id);
  if (
    !current ||
    !compareBookmarkFingerprint(expected, createBookmarkFingerprint(current))
  ) {
    return undefined;
  }
  return current;
}

function collectSources(
  records: readonly BookmarkRecord[],
  ids: readonly string[],
): readonly BookmarkRecord[] {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length !== ids.length) {
    throw new Error('不能重复选择同一个书签');
  }
  return sortRecordsInBrowserOrder(
    uniqueIds.map((id) => requireRecord(records, id)),
  );
}

function recoveryAnchorFor(
  record: BookmarkRecord,
  records: readonly BookmarkRecord[],
  quarantinedAt: number,
): BookmarkRecoveryEntry {
  if (!record.parentId) {
    throw new Error('根目录不能恢复');
  }
  const siblings = records
    .filter((candidate) => candidate.parentId === record.parentId)
    .sort((left, right) => left.index - right.index);
  const previousSibling = siblings
    .slice(0, siblings.findIndex((candidate) => candidate.id === record.id))
    .reverse()
    .find((candidate) => candidate.id !== record.id);
  const nextSibling = siblings
    .slice(siblings.findIndex((candidate) => candidate.id === record.id) + 1)
    .find((candidate) => candidate.id !== record.id);

  return {
    nodeId: record.id,
    originalParentId: record.parentId,
    originalIndex: record.index,
    previousSiblingId: previousSibling?.id,
    nextSiblingId: nextSibling?.id,
    quarantinedAt,
  };
}

function resolveRestoreIndex(
  records: readonly BookmarkRecord[],
  entry: BookmarkRecoveryEntry,
  parentId: string,
): number {
  const siblings = records
    .filter((record) => record.parentId === parentId)
    .sort((left, right) => left.index - right.index);
  const previousSibling = siblings.find(
    (record) => record.id === entry.previousSiblingId,
  );
  if (previousSibling) {
    return previousSibling.index + 1;
  }
  const nextSibling = siblings.find((record) => record.id === entry.nextSiblingId);
  if (nextSibling) {
    return nextSibling.index;
  }
  return entry.originalIndex;
}

function compareSiblingSnapshots(
  records: readonly BookmarkRecord[],
  parentId: string,
  expectedSiblings: readonly BookmarkFingerprint[],
): boolean {
  const currentSiblings = records
    .filter((record) => record.parentId === parentId)
    .sort((left, right) => left.index - right.index || left.id.localeCompare(right.id));
  if (currentSiblings.length !== expectedSiblings.length) {
    return false;
  }
  return currentSiblings.every((record, index) => {
    const expected = expectedSiblings[index];
    return (
      expected !== undefined &&
      record.id === expected.id &&
      compareBookmarkFingerprint(expected, createBookmarkFingerprint(record))
    );
  });
}

export function createBookmarkOperationService({
  repository,
  storage,
  now = Date.now,
}: BookmarkOperationServiceOptions): BookmarkOperationService {
  const makePlanBase = (kind: BookmarkOperationKind): PlanBase => {
    const createdAt = now();
    return { id: operationId(createdAt), kind, createdAt };
  };

  async function readFreshRecords(): Promise<readonly BookmarkRecord[]> {
    return flattenBookmarkTree(await repository.getTree());
  }

  async function ensureQuarantineFolder(
    records: readonly BookmarkRecord[],
  ): Promise<string> {
    const storedId = await storage.loadQuarantineFolderId();
    const byId = recordsById(records);
    const stored = storedId ? byId.get(storedId) : undefined;
    if (stored && isQuarantineFolder(stored, records)) {
      return stored.id;
    }

    const exact = findExactQuarantineFolder(records);
    if (exact && !exact.isUnmodifiable) {
      await storage.saveQuarantineFolderId(exact.id);
      return exact.id;
    }

    const other = findOtherBookmarksFolder(records);
    if (!other) {
      throw new Error('找不到“其他书签”目录');
    }
    const created = await repository.createFolder({
      parentId: other.id,
      title: QUARANTINE_FOLDER_TITLE,
    });
    await storage.saveQuarantineFolderId(created.id);
    return created.id;
  }

  return {
    planCreateBookmark(records, input) {
      const parent = createBookmarkFingerprint(
        requireWritableFolder(records, input.parentId),
      );
      return {
        ...makePlanBase('create-bookmark'),
        kind: 'create-bookmark',
        parent,
        title: input.title,
        url: input.url,
        index: input.index,
      };
    },
    planCreateFolder(records, input) {
      const parent = createBookmarkFingerprint(
        requireWritableFolder(records, input.parentId),
      );
      return {
        ...makePlanBase('create-folder'),
        kind: 'create-folder',
        parent,
        title: input.title,
        index: input.index,
      };
    },
    planUpdate(records, id, changes) {
      const source = requireRecord(records, id);
      const writable = validateWritableRecord(source);
      if (!writable.valid) {
        throw new Error(writable.reason);
      }
      return {
        ...makePlanBase('update'),
        kind: 'update',
        source: createBookmarkFingerprint(source),
        changes,
      };
    },
    planMove(records, ids, destination) {
      const target = requireWritableFolder(records, destination.parentId);
      const sources = collectSources(records, ids);
      for (const source of sources) {
        const validation = validateMoveTarget(records, source, target.id);
        if (!validation.valid) {
          throw new Error(validation.reason);
        }
      }
      return {
        ...makePlanBase('move'),
        kind: 'move',
        sources: sources.map(createBookmarkFingerprint),
        target: createBookmarkFingerprint(target),
        index: destination.index,
      };
    },
    planReorder(records, id, destination) {
      const source = requireRecord(records, id);
      if (source.parentId !== destination.parentId) {
        throw new Error('只能在同一层级调整文件夹顺序');
      }
      const plan = this.planMove(records, [id], destination);
      const siblings = records
        .filter((record) => record.parentId === destination.parentId)
        .sort((left, right) => left.index - right.index || left.id.localeCompare(right.id));
      return {
        ...plan,
        kind: 'reorder',
        siblings: siblings.map(createBookmarkFingerprint),
      };
    },
    planQuarantine(records, ids) {
      const sources = collectSources(records, ids);
      for (const source of sources) {
        const writable = validateWritableRecord(source);
        if (!writable.valid) {
          throw new Error(writable.reason);
        }
        if (source.isFolder || !source.url) {
          throw new Error('只能将书签移到待删除');
        }
      }
      return {
        ...makePlanBase('quarantine'),
        kind: 'quarantine',
        sources: sources.map(createBookmarkFingerprint),
      };
    },
    planRestore(entries, fallbackParentId) {
      return {
        ...makePlanBase('restore'),
        kind: 'restore',
        entries,
        fallbackParentId,
      };
    },
    async execute(plan) {
      if (plan.kind === 'create-bookmark') {
        const records = await readFreshRecords();
        const byId = recordsById(records);
        if (!requireCurrentFingerprint(byId, plan.parent)) {
          return {
            kind: plan.kind,
            results: [
              { id: plan.parent.id, status: 'conflict', message: CONFLICT_MESSAGE },
            ],
          };
        }
        try {
          const created = await repository.createBookmark({
            parentId: plan.parent.id,
            title: plan.title,
            url: plan.url,
            ...(plan.index === undefined ? {} : { index: plan.index }),
          });
          return {
            kind: plan.kind,
            results: [
              { id: created.id, status: 'success', message: '已新建书签' },
            ],
          };
        } catch (error) {
          return {
            kind: plan.kind,
            results: [createFailure(plan.parent.id, error)],
          };
        }
      }

      if (plan.kind === 'create-folder') {
        const records = await readFreshRecords();
        const byId = recordsById(records);
        if (!requireCurrentFingerprint(byId, plan.parent)) {
          return {
            kind: plan.kind,
            results: [
              { id: plan.parent.id, status: 'conflict', message: CONFLICT_MESSAGE },
            ],
          };
        }
        try {
          const created = await repository.createFolder({
            parentId: plan.parent.id,
            title: plan.title,
            ...(plan.index === undefined ? {} : { index: plan.index }),
          });
          return {
            kind: plan.kind,
            results: [
              { id: created.id, status: 'success', message: '已新建文件夹' },
            ],
          };
        } catch (error) {
          return {
            kind: plan.kind,
            results: [createFailure(plan.parent.id, error)],
          };
        }
      }

      if (plan.kind === 'update') {
        const records = await readFreshRecords();
        const byId = recordsById(records);
        if (!requireCurrentFingerprint(byId, plan.source)) {
          return {
            kind: plan.kind,
            results: [
              { id: plan.source.id, status: 'conflict', message: CONFLICT_MESSAGE },
            ],
          };
        }
        try {
          await repository.update(plan.source.id, plan.changes);
          return {
            kind: plan.kind,
            results: [
              { id: plan.source.id, status: 'success', message: '已更新' },
            ],
          };
        } catch (error) {
          return {
            kind: plan.kind,
            results: [createFailure(plan.source.id, error)],
          };
        }
      }

      if (plan.kind === 'move' || plan.kind === 'reorder') {
        const results: BookmarkOperationResult[] = [];
        for (const source of plan.sources) {
          const records = await readFreshRecords();
          const byId = recordsById(records);
          if (!requireCurrentFingerprint(byId, plan.target)) {
            results.push({
              id: source.id,
              status: 'conflict',
              message: CONFLICT_MESSAGE,
            });
            continue;
          }
          if (!requireCurrentFingerprint(byId, source)) {
            results.push({
              id: source.id,
              status: 'conflict',
              message: CONFLICT_MESSAGE,
            });
            continue;
          }
          if (
            plan.kind === 'reorder' &&
            plan.siblings &&
            !compareSiblingSnapshots(records, plan.target.id, plan.siblings)
          ) {
            results.push({
              id: source.id,
              status: 'conflict',
              message: CONFLICT_MESSAGE,
            });
            continue;
          }
          try {
            await repository.move(source.id, {
              parentId: plan.target.id,
              ...(plan.index === undefined ? {} : { index: plan.index }),
            });
            results.push({
              id: source.id,
              status: 'success',
              message: plan.kind === 'reorder' ? '已排序' : '已移动',
            });
          } catch (error) {
            results.push(createFailure(source.id, error));
          }
        }
        return { kind: plan.kind, results };
      }

      if (plan.kind === 'quarantine') {
        const results: BookmarkOperationResult[] = [];
        let knownQuarantineFolderId: string | undefined;
        for (const source of plan.sources) {
          const records = await readFreshRecords();
          const byId = recordsById(records);
          let quarantineFolderId: string;
          try {
            quarantineFolderId =
              knownQuarantineFolderId ?? (await ensureQuarantineFolder(records));
            knownQuarantineFolderId = quarantineFolderId;
          } catch (error) {
            results.push(createFailure(source.id, error));
            continue;
          }
          const current = requireCurrentFingerprint(byId, source);
          if (!current) {
            results.push({
              id: source.id,
              status: 'conflict',
              message: CONFLICT_MESSAGE,
            });
            continue;
          }
          try {
            await storage.upsertRecoveryEntry(
              recoveryAnchorFor(current, records, now()),
            );
            try {
              await repository.move(source.id, { parentId: quarantineFolderId });
            } catch (error) {
              await storage.removeRecoveryEntry(source.id).catch(() => undefined);
              throw error;
            }
            results.push({
              id: source.id,
              status: 'success',
              message: '已移到待删除',
            });
          } catch (error) {
            results.push(createFailure(source.id, error));
          }
        }
        return { kind: plan.kind, results };
      }

      if (plan.kind === 'restore') {
        const results: BookmarkOperationResult[] = [];
        for (const entry of plan.entries) {
          const records = await readFreshRecords();
          const byId = recordsById(records);
          const parentId =
            byId.has(entry.originalParentId)
              ? entry.originalParentId
              : plan.fallbackParentId;
          if (!parentId || !byId.get(parentId)?.isFolder) {
            results.push({
              id: entry.nodeId,
              status: 'conflict',
              message: '原文件夹不存在，请选择恢复位置',
            });
            continue;
          }
          try {
            await repository.move(entry.nodeId, {
              parentId,
              index: resolveRestoreIndex(records, entry, parentId),
            });
            await storage.removeRecoveryEntry(entry.nodeId);
            results.push({
              id: entry.nodeId,
              status: 'success',
              message: '已恢复',
            });
          } catch (error) {
            results.push(createFailure(entry.nodeId, error));
          }
        }
        return { kind: plan.kind, results };
      }
      return { kind: plan.kind, results: [] };
    },
  };
}
