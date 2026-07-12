import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MANAGER_SETTINGS,
  createBrowserManagerSettingsRepository,
  type ManagerSettingsStorageArea,
} from '../../src/platform/manager-settings-repository';

class StorageAreaStub implements ManagerSettingsStorageArea {
  storedValue: unknown;
  getError?: Error;
  setError?: Error;
  readonly readKeys: string[] = [];
  readonly writes: Record<string, unknown>[] = [];

  async get(key: string): Promise<Record<string, unknown>> {
    this.readKeys.push(key);
    if (this.getError) {
      throw this.getError;
    }
    return this.storedValue === undefined ? {} : { [key]: this.storedValue };
  }

  async set(values: Record<string, unknown>): Promise<void> {
    if (this.setError) {
      throw this.setError;
    }
    this.writes.push(values);
    this.storedValue = Object.values(values)[0];
  }
}

describe('createBrowserManagerSettingsRepository', () => {
  it('loads defaults for missing or malformed storage', async () => {
    for (const storedValue of [
      undefined,
      null,
      'invalid',
      { showFolderCounts: 'false' },
    ]) {
      const storage = new StorageAreaStub();
      storage.storedValue = storedValue;

      await expect(
        createBrowserManagerSettingsRepository(storage).load(),
      ).resolves.toEqual(DEFAULT_MANAGER_SETTINGS);
    }
  });

  it('merges a stored partial object with defaults and ignores unrelated fields', async () => {
    const emptyStorage = new StorageAreaStub();
    emptyStorage.storedValue = {};
    const configuredStorage = new StorageAreaStub();
    configuredStorage.storedValue = {
      showFolderCounts: false,
      unrelated: 'must not escape',
    };

    await expect(
      createBrowserManagerSettingsRepository(emptyStorage).load(),
    ).resolves.toEqual({ showFolderCounts: true });
    await expect(
      createBrowserManagerSettingsRepository(configuredStorage).load(),
    ).resolves.toEqual({ showFolderCounts: false });
  });

  it('saves only the folder-count preference under one namespaced key', async () => {
    const storage = new StorageAreaStub();
    const repository = createBrowserManagerSettingsRepository(storage);

    await repository.save({ showFolderCounts: false });

    expect(storage.writes).toHaveLength(1);
    expect(Object.keys(storage.writes[0] ?? {})).toHaveLength(1);
    const [storageKey] = Object.keys(storage.writes[0] ?? {});
    expect(storageKey).toMatch(/bookmark-manager.+settings/i);
    expect(storage.writes[0]).toEqual({
      [storageKey]: { showFolderCounts: false },
    });
  });

  it('preserves storage failures for the application layer to handle', async () => {
    const loadFailure = new Error('load denied');
    const saveFailure = new Error('save denied');
    const storage = new StorageAreaStub();
    storage.getError = loadFailure;
    const repository = createBrowserManagerSettingsRepository(storage);

    await expect(repository.load()).rejects.toBe(loadFailure);

    storage.getError = undefined;
    storage.setError = saveFailure;
    await expect(
      repository.save({ showFolderCounts: false }),
    ).rejects.toBe(saveFailure);
  });
});
