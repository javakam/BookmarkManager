import { browser } from 'wxt/browser';

export interface ManagerSettings {
  readonly showFolderCounts: boolean;
}

export interface ManagerSettingsRepository {
  load(): Promise<ManagerSettings>;
  save(settings: ManagerSettings): Promise<void>;
}

export interface ManagerSettingsStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}

export const DEFAULT_MANAGER_SETTINGS: ManagerSettings = {
  showFolderCounts: true,
};

const MANAGER_SETTINGS_STORAGE_KEY = 'bookmark-manager.manager-settings';

function getBrowserStorageArea(): ManagerSettingsStorageArea {
  return browser.storage.local as unknown as ManagerSettingsStorageArea;
}

function parseSettings(value: unknown): ManagerSettings {
  if (typeof value !== 'object' || value === null) {
    return { ...DEFAULT_MANAGER_SETTINGS };
  }

  const stored = value as Record<string, unknown>;
  return {
    showFolderCounts:
      typeof stored.showFolderCounts === 'boolean'
        ? stored.showFolderCounts
        : DEFAULT_MANAGER_SETTINGS.showFolderCounts,
  };
}

export function createBrowserManagerSettingsRepository(
  storageArea?: ManagerSettingsStorageArea,
): ManagerSettingsRepository {
  const resolveStorageArea = () => storageArea ?? getBrowserStorageArea();

  return {
    async load() {
      const stored = await resolveStorageArea().get(MANAGER_SETTINGS_STORAGE_KEY);
      return parseSettings(stored[MANAGER_SETTINGS_STORAGE_KEY]);
    },
    async save(settings) {
      await resolveStorageArea().set({
        [MANAGER_SETTINGS_STORAGE_KEY]: {
          showFolderCounts: settings.showFolderCounts,
        },
      });
    },
  };
}
