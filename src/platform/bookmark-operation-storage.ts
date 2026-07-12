import { browser } from 'wxt/browser';

export interface BookmarkRecoveryEntry {
  readonly nodeId: string;
  readonly originalParentId: string;
  readonly originalIndex: number;
  readonly previousSiblingId?: string;
  readonly nextSiblingId?: string;
  readonly quarantinedAt: number;
}

export interface BookmarkOperationStorage {
  loadQuarantineFolderId(): Promise<string | undefined>;
  saveQuarantineFolderId(folderId: string): Promise<void>;
  loadRecoveryEntries(): Promise<readonly BookmarkRecoveryEntry[]>;
  upsertRecoveryEntry(entry: BookmarkRecoveryEntry): Promise<void>;
  removeRecoveryEntry(nodeId: string): Promise<void>;
}

export interface BookmarkOperationStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}

interface StoredOperationState {
  readonly quarantineFolderId?: string;
  readonly recoveryEntries: readonly BookmarkRecoveryEntry[];
}

const OPERATION_STORAGE_KEY = 'bookmark-manager.operations';

function getBrowserStorageArea(): BookmarkOperationStorageArea {
  return browser.storage.local as unknown as BookmarkOperationStorageArea;
}

function parseRecoveryEntry(value: unknown): BookmarkRecoveryEntry | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const stored = value as Record<string, unknown>;
  if (
    typeof stored.nodeId !== 'string' ||
    typeof stored.originalParentId !== 'string' ||
    typeof stored.originalIndex !== 'number' ||
    typeof stored.quarantinedAt !== 'number'
  ) {
    return undefined;
  }
  return {
    nodeId: stored.nodeId,
    originalParentId: stored.originalParentId,
    originalIndex: stored.originalIndex,
    previousSiblingId:
      typeof stored.previousSiblingId === 'string'
        ? stored.previousSiblingId
        : undefined,
    nextSiblingId:
      typeof stored.nextSiblingId === 'string'
        ? stored.nextSiblingId
        : undefined,
    quarantinedAt: stored.quarantinedAt,
  };
}

function parseState(value: unknown): StoredOperationState {
  if (typeof value !== 'object' || value === null) {
    return { recoveryEntries: [] };
  }

  const stored = value as Record<string, unknown>;
  const recoveryEntries = Array.isArray(stored.recoveryEntries)
    ? stored.recoveryEntries.flatMap((entry) => {
        const parsed = parseRecoveryEntry(entry);
        return parsed ? [parsed] : [];
      })
    : [];

  return {
    quarantineFolderId:
      typeof stored.quarantineFolderId === 'string'
        ? stored.quarantineFolderId
        : undefined,
    recoveryEntries,
  };
}

function createRepository(
  loadState: () => Promise<StoredOperationState>,
  saveState: (state: StoredOperationState) => Promise<void>,
): BookmarkOperationStorage {
  return {
    async loadQuarantineFolderId() {
      return (await loadState()).quarantineFolderId;
    },
    async saveQuarantineFolderId(folderId) {
      const state = await loadState();
      await saveState({ ...state, quarantineFolderId: folderId });
    },
    async loadRecoveryEntries() {
      return (await loadState()).recoveryEntries;
    },
    async upsertRecoveryEntry(entry) {
      const state = await loadState();
      await saveState({
        ...state,
        recoveryEntries: [
          ...state.recoveryEntries.filter(
            (existing) => existing.nodeId !== entry.nodeId,
          ),
          entry,
        ],
      });
    },
    async removeRecoveryEntry(nodeId) {
      const state = await loadState();
      await saveState({
        ...state,
        recoveryEntries: state.recoveryEntries.filter(
          (entry) => entry.nodeId !== nodeId,
        ),
      });
    },
  };
}

export function createBrowserBookmarkOperationStorage(
  storageArea?: BookmarkOperationStorageArea,
): BookmarkOperationStorage {
  const resolveStorageArea = () => storageArea ?? getBrowserStorageArea();

  return createRepository(
    async () => {
      const stored = await resolveStorageArea().get(OPERATION_STORAGE_KEY);
      return parseState(stored[OPERATION_STORAGE_KEY]);
    },
    async (state) => {
      await resolveStorageArea().set({
        [OPERATION_STORAGE_KEY]: {
          quarantineFolderId: state.quarantineFolderId,
          recoveryEntries: state.recoveryEntries,
        },
      });
    },
  );
}

export function createMemoryBookmarkOperationStorage(): BookmarkOperationStorage {
  let state: StoredOperationState = { recoveryEntries: [] };
  return createRepository(
    async () => state,
    async (nextState) => {
      state = {
        quarantineFolderId: nextState.quarantineFolderId,
        recoveryEntries: [...nextState.recoveryEntries],
      };
    },
  );
}
