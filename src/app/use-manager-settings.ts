import { useCallback, useEffect, useRef, useState } from 'react';

import {
  DEFAULT_MANAGER_SETTINGS,
  type ManagerSettings,
  type ManagerSettingsRepository,
} from '../platform/manager-settings-repository';

export interface ManagerSettingsState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly settings: ManagerSettings;
  readonly error?: string;
  readonly update: (changes: Partial<ManagerSettings>) => Promise<void>;
}

interface ManagerSettingsSnapshot {
  readonly status: ManagerSettingsState['status'];
  readonly settings: ManagerSettings;
  readonly error?: string;
}

export function useManagerSettings(
  repository: ManagerSettingsRepository,
): ManagerSettingsState {
  const [snapshot, setSnapshot] = useState<ManagerSettingsSnapshot>({
    status: 'loading',
    settings: { ...DEFAULT_MANAGER_SETTINGS },
  });
  const currentSettings = useRef<ManagerSettings>({
    ...DEFAULT_MANAGER_SETTINGS,
  });
  const operationSequence = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let isActive = true;
    const operationId = ++operationSequence.current;
    saveQueue.current = Promise.resolve();
    currentSettings.current = { ...DEFAULT_MANAGER_SETTINGS };
    setSnapshot({
      status: 'loading',
      settings: currentSettings.current,
    });

    void repository.load().then(
      (settings) => {
        if (!isActive || operationSequence.current !== operationId) {
          return;
        }
        currentSettings.current = settings;
        setSnapshot({ status: 'ready', settings });
      },
      () => {
        if (!isActive || operationSequence.current !== operationId) {
          return;
        }
        setSnapshot({
          status: 'error',
          settings: currentSettings.current,
          error: '无法读取设置',
        });
      },
    );

    return () => {
      isActive = false;
      operationSequence.current += 1;
      saveQueue.current = Promise.resolve();
    };
  }, [repository]);

  const update = useCallback(
    async (changes: Partial<ManagerSettings>) => {
      const operationId = ++operationSequence.current;
      const settings: ManagerSettings = {
        showFolderCounts:
          changes.showFolderCounts ?? currentSettings.current.showFolderCounts,
      };
      currentSettings.current = settings;
      setSnapshot({ status: 'ready', settings });

      const save = saveQueue.current
        .catch(() => undefined)
        .then(() => repository.save(settings));
      saveQueue.current = save;

      try {
        await save;
      } catch {
        if (operationSequence.current !== operationId) {
          return;
        }
        setSnapshot({
          status: 'error',
          settings,
          error: '无法保存设置',
        });
      }
    },
    [repository],
  );

  return { ...snapshot, update };
}
