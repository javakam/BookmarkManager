import { describe, expect, it } from 'vitest';

import {
  createBrowserBookmarkOperationStorage,
  type BookmarkOperationStorageArea,
  type BookmarkRecoveryEntry,
} from '../../src/platform/bookmark-operation-storage';

class StorageAreaStub implements BookmarkOperationStorageArea {
  storedValue: unknown;
  readonly writes: Record<string, unknown>[] = [];

  async get(key: string): Promise<Record<string, unknown>> {
    return this.storedValue === undefined ? {} : { [key]: this.storedValue };
  }

  async set(values: Record<string, unknown>): Promise<void> {
    this.writes.push(values);
    this.storedValue = Object.values(values)[0];
  }
}

const entry: BookmarkRecoveryEntry = {
  nodeId: 'bookmark',
  originalParentId: 'bar',
  originalIndex: 2,
  previousSiblingId: 'before',
  nextSiblingId: 'after',
  quarantinedAt: 123,
};

describe('createBrowserBookmarkOperationStorage', () => {
  it('loads empty state from missing or malformed storage', async () => {
    for (const storedValue of [undefined, null, 'bad', { recoveryEntries: 'bad' }]) {
      const storage = new StorageAreaStub();
      storage.storedValue = storedValue;

      const repository = createBrowserBookmarkOperationStorage(storage);

      await expect(repository.loadQuarantineFolderId()).resolves.toBeUndefined();
      await expect(repository.loadRecoveryEntries()).resolves.toEqual([]);
    }
  });

  it('stores only the quarantine folder id and recovery anchors under one namespaced key', async () => {
    const storage = new StorageAreaStub();
    const repository = createBrowserBookmarkOperationStorage(storage);

    await repository.saveQuarantineFolderId('quarantine');
    await repository.upsertRecoveryEntry(entry);

    expect(storage.writes).toHaveLength(2);
    const [storageKey] = Object.keys(storage.writes[1] ?? {});
    expect(storageKey).toMatch(/bookmark-manager.+operations/i);
    expect(storage.writes[1]).toEqual({
      [storageKey]: {
        quarantineFolderId: 'quarantine',
        recoveryEntries: [entry],
      },
    });
  });

  it('upserts and removes recovery entries by node id', async () => {
    const storage = new StorageAreaStub();
    const repository = createBrowserBookmarkOperationStorage(storage);

    await repository.upsertRecoveryEntry(entry);
    await repository.upsertRecoveryEntry({ ...entry, originalIndex: 5 });
    await expect(repository.loadRecoveryEntries()).resolves.toEqual([
      { ...entry, originalIndex: 5 },
    ]);

    await repository.removeRecoveryEntry('bookmark');
    await expect(repository.loadRecoveryEntries()).resolves.toEqual([]);
  });
});
