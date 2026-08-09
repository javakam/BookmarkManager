import type { BookmarkRecord } from '../domain/bookmarks';
import {
  compareBookmarkFingerprint,
  createBookmarkFingerprint,
  sortRecordsInBrowserOrder,
  validateMoveTarget,
  validateWritableRecord,
  type BookmarkFingerprint,
  type BookmarkOperationExecution,
  type BookmarkOperationKind,
  type BookmarkOperationResult,
} from '../domain/bookmark-operations';
import { flattenBookmarkTree } from '../domain/tree';
import { validateBookmarkUrl } from '../domain/url-safety';
import type { BookmarkRepository } from '../platform/bookmark-repository';

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

type DeletePlan = PlanBase & {
  readonly kind: 'delete';
  readonly sources: readonly BookmarkFingerprint[];
  /** Full subtree snapshot used to protect permanent deletion. */
  readonly affected: readonly BookmarkFingerprint[];
  readonly affectedCount: number;
  readonly folderCount: number;
  readonly bookmarkCount: number;
};

export type BookmarkOperationPlan =
  | CreateBookmarkPlan
  | CreateFolderPlan
  | UpdatePlan
  | MovePlan
  | DeletePlan;

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
  planDelete(
    records: readonly BookmarkRecord[],
    ids: readonly string[],
  ): DeletePlan;
  execute(plan: BookmarkOperationPlan): Promise<BookmarkOperationExecution>;
}

export interface BookmarkOperationServiceOptions {
  readonly repository: BookmarkRepository;
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

function compareStableBookmarkFingerprint(
  expected: BookmarkFingerprint,
  actual: BookmarkFingerprint,
): boolean {
  return (
    expected.id === actual.id &&
    expected.parentId === actual.parentId &&
    expected.title === actual.title &&
    expected.url === actual.url &&
    expected.isFolder === actual.isFolder &&
    expected.isUnmodifiable === actual.isUnmodifiable
  );
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

function deleteImpact(
  records: readonly BookmarkRecord[],
  sources: readonly BookmarkRecord[],
): {
  readonly records: readonly BookmarkRecord[];
  readonly affectedCount: number;
  readonly folderCount: number;
  readonly bookmarkCount: number;
} {
  const childrenByParentId = new Map<string, BookmarkRecord[]>();
  for (const record of records) {
    if (!record.parentId) {
      continue;
    }
    const children = childrenByParentId.get(record.parentId) ?? [];
    children.push(record);
    childrenByParentId.set(record.parentId, children);
  }

  const affected = new Map<string, BookmarkRecord>();
  const pending = [...sources];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || affected.has(current.id)) {
      continue;
    }
    affected.set(current.id, current);
    if (current.isFolder) {
      pending.push(...(childrenByParentId.get(current.id) ?? []));
    }
  }

  const folderCount = [...affected.values()].filter((record) => record.isFolder).length;
  return {
    records: [...affected.values()],
    affectedCount: affected.size,
    folderCount,
    bookmarkCount: affected.size - folderCount,
  };
}

function collectCurrentDeleteRecords(
  records: readonly BookmarkRecord[],
  sources: readonly BookmarkFingerprint[],
): readonly BookmarkRecord[] {
  const byId = recordsById(records);
  const sourceIds = new Set(sources.map((source) => source.id));

  return records.filter((record) => {
    let current: BookmarkRecord | undefined = record;
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      if (sourceIds.has(current.id)) {
        return true;
      }
      visited.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return false;
  });
}

function matchesDeleteSnapshot(
  records: readonly BookmarkRecord[],
  plan: DeletePlan,
): boolean {
  const currentAffected = collectCurrentDeleteRecords(records, plan.sources);
  if (currentAffected.length !== plan.affected.length) {
    return false;
  }
  const currentById = recordsById(currentAffected);
  return plan.affected.every((expected) => {
    const current = currentById.get(expected.id);
    return Boolean(
      current &&
        compareBookmarkFingerprint(expected, createBookmarkFingerprint(current)),
    );
  });
}

function matchesDeleteSourceSnapshot(
  records: readonly BookmarkRecord[],
  plan: DeletePlan,
  source: BookmarkFingerprint,
): boolean {
  const expectedAffected = collectExpectedDeleteFingerprints(plan, source);
  const currentAffected = collectCurrentDeleteRecords(records, [source]);
  if (currentAffected.length !== expectedAffected.length) {
    return false;
  }
  const currentById = recordsById(currentAffected);
  return expectedAffected.every((expected) => {
    const current = currentById.get(expected.id);
    return Boolean(
      current &&
        compareStableBookmarkFingerprint(
          expected,
          createBookmarkFingerprint(current),
        ),
    );
  });
}

function collectExpectedDeleteFingerprints(
  plan: DeletePlan,
  source: BookmarkFingerprint,
): readonly BookmarkFingerprint[] {
  const expectedById = new Map(
    plan.affected.map((fingerprint) => [fingerprint.id, fingerprint]),
  );
  return plan.affected.filter((fingerprint) => {
    let current: BookmarkFingerprint | undefined = fingerprint;
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      if (current.id === source.id) {
        return true;
      }
      visited.add(current.id);
      current = current.parentId
        ? expectedById.get(current.parentId)
        : undefined;
    }
    return false;
  });
}

function createSafeDeleteOrder(
  plan: DeletePlan,
  source: BookmarkFingerprint,
): readonly BookmarkFingerprint[] {
  const expected = collectExpectedDeleteFingerprints(plan, source);
  const expectedById = new Map(
    expected.map((fingerprint) => [fingerprint.id, fingerprint]),
  );
  const childrenByParentId = new Map<string, BookmarkFingerprint[]>();
  for (const fingerprint of expected) {
    if (!fingerprint.parentId || !expectedById.has(fingerprint.parentId)) {
      continue;
    }
    const children = childrenByParentId.get(fingerprint.parentId) ?? [];
    children.push(fingerprint);
    childrenByParentId.set(fingerprint.parentId, children);
  }
  for (const children of childrenByParentId.values()) {
    children.sort(
      (left, right) =>
        left.index - right.index || left.id.localeCompare(right.id),
    );
  }

  const ordered: BookmarkFingerprint[] = [];
  const pending: Array<{
    readonly fingerprint: BookmarkFingerprint;
    readonly expanded: boolean;
  }> = [{ fingerprint: source, expanded: false }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }
    if (current.expanded) {
      ordered.push(current.fingerprint);
      continue;
    }
    pending.push({ fingerprint: current.fingerprint, expanded: true });
    const children = childrenByParentId.get(current.fingerprint.id) ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push({ fingerprint: children[index], expanded: false });
    }
  }
  return ordered;
}

function removeNestedDeleteSources(
  records: readonly BookmarkRecord[],
  sources: readonly BookmarkRecord[],
): readonly BookmarkRecord[] {
  const byId = recordsById(records);
  const selectedIds = new Set(sources.map((source) => source.id));
  return sources.filter((source) => {
    let parentId = source.parentId;
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      if (selectedIds.has(parentId)) {
        return false;
      }
      visited.add(parentId);
      parentId = byId.get(parentId)?.parentId;
    }
    return true;
  });
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
  now = Date.now,
}: BookmarkOperationServiceOptions): BookmarkOperationService {
  const makePlanBase = (kind: BookmarkOperationKind): PlanBase => {
    const createdAt = now();
    return { id: operationId(createdAt), kind, createdAt };
  };

  async function readFreshRecords(): Promise<readonly BookmarkRecord[]> {
    return flattenBookmarkTree(await repository.getTree());
  }

  return {
    planCreateBookmark(records, input) {
      const urlValidation = validateBookmarkUrl(input.url);
      if (!urlValidation.valid) {
        throw new Error(urlValidation.reason);
      }
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
      if (changes.url !== undefined) {
        const urlValidation = validateBookmarkUrl(changes.url);
        if (!urlValidation.valid) {
          throw new Error(urlValidation.reason);
        }
      }
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
    planDelete(records, ids) {
      const selectedSources = collectSources(records, ids);
      const sources = removeNestedDeleteSources(records, selectedSources);
      for (const source of sources) {
        const writable = validateWritableRecord(source);
        if (!writable.valid) {
          throw new Error(writable.reason);
        }
      }
      const impact = deleteImpact(records, sources);
      return {
        ...makePlanBase('delete'),
        kind: 'delete',
        sources: sources.map(createBookmarkFingerprint),
        affected: impact.records.map(createBookmarkFingerprint),
        affectedCount: impact.affectedCount,
        folderCount: impact.folderCount,
        bookmarkCount: impact.bookmarkCount,
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
        // Validate the complete batch against one native snapshot before the
        // first write. A successful move/remove changes sibling indexes; doing
        // a full fingerprint check after every item would therefore report
        // false conflicts for the remaining items in the same folder.
        const records = await readFreshRecords();
        for (const [sourceIndex, source] of plan.sources.entries()) {
          // Re-read before every item after the first. Native moves can change
          // sibling indexes, so only stable identity fields are compared here;
          // this still catches an external edit, deletion, or parent move that
          // happened while the batch was executing.
          const currentRecords =
            sourceIndex === 0 ? records : await readFreshRecords();
          const byId = recordsById(currentRecords);
          const currentTarget = byId.get(plan.target.id);
          const currentSource = byId.get(source.id);
          const targetIsCurrent = Boolean(
            currentTarget &&
              compareStableBookmarkFingerprint(
                plan.target,
                createBookmarkFingerprint(currentTarget),
              ),
          );
          const sourceIsCurrent = Boolean(
            currentSource &&
              compareStableBookmarkFingerprint(
                source,
                createBookmarkFingerprint(currentSource),
              ),
          );
          const siblingsAreCurrent =
            plan.kind !== 'reorder' ||
            !plan.siblings ||
            compareSiblingSnapshots(currentRecords, plan.target.id, plan.siblings);
          if (
            !targetIsCurrent ||
            !siblingsAreCurrent ||
            !sourceIsCurrent
          ) {
            results.push({
              id: source.id,
              status: 'conflict',
              message: CONFLICT_MESSAGE,
            });
            continue;
          }
          if (
            plan.kind === 'move' &&
            plan.index === undefined &&
            currentSource?.parentId === plan.target.id
          ) {
            results.push({
              id: source.id,
              status: 'success',
              message: '已在目标文件夹中',
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

      if (plan.kind === 'delete') {
        const results: BookmarkOperationResult[] = [];
        // Deleting one sibling shifts the indexes of the others. Check all
        // fingerprints before mutating the tree so a valid batch is not
        // rejected merely because an earlier deletion changed those indexes.
        const records = await readFreshRecords();
        if (!matchesDeleteSnapshot(records, plan)) {
          return {
            kind: plan.kind,
            results: plan.sources.map((source) => ({
              id: source.id,
              status: 'conflict' as const,
              message: CONFLICT_MESSAGE,
            })),
          };
        }
        for (const [sourceIndex, source] of plan.sources.entries()) {
          // A previous deletion can shift sibling indexes. Re-read before each
          // later source and compare stable fields plus its complete subtree so
          // external additions or edits are not included in the confirmed work.
          if (
            sourceIndex > 0 &&
            !matchesDeleteSourceSnapshot(
              await readFreshRecords(),
              plan,
              source,
            )
          ) {
            results.push({
              id: source.id,
              status: 'conflict',
              message: CONFLICT_MESSAGE,
            });
            continue;
          }
          let removedCount = 0;
          try {
            const deleteOrder = createSafeDeleteOrder(plan, source);
            // Ordinary removal is deliberate: a concurrently added child keeps
            // its folder non-empty and blocks deletion instead of being swept.
            for (const expected of deleteOrder) {
              await repository.remove(expected.id);
              removedCount += 1;
            }
            results.push({ id: source.id, status: 'success', message: '已删除' });
          } catch (error) {
            const failure = createFailure(source.id, error);
            results.push(
              removedCount > 0
                ? {
                    ...failure,
                    message: `已删除 ${removedCount} 个确认项，后续删除未完成：${failure.message}`,
                  }
                : failure,
            );
          }
        }
        return { kind: plan.kind, results };
      }

      return { kind: plan.kind, results: [] };
    },
  };
}
