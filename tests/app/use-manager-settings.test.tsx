// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useManagerSettings } from '../../src/app/use-manager-settings';
import type {
  ManagerSettings,
  ManagerSettingsRepository,
} from '../../src/platform/manager-settings-repository';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('useManagerSettings', () => {
  it('loads settings, exposes ready state, and persists updates', async () => {
    const request = deferred<ManagerSettings>();
    const saved: ManagerSettings[] = [];
    const repository: ManagerSettingsRepository = {
      load: () => request.promise,
      async save(settings) {
        saved.push(settings);
      },
    };
    const { result } = renderHook(() => useManagerSettings(repository));

    expect(result.current.status).toBe('loading');
    expect(result.current.settings).toEqual({ showFolderCounts: true });

    await act(async () => request.resolve({ showFolderCounts: false }));
    expect(result.current.status).toBe('ready');
    expect(result.current.settings).toEqual({ showFolderCounts: false });

    await act(async () => {
      await result.current.update({ showFolderCounts: true });
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.settings).toEqual({ showFolderCounts: true });
    expect(saved).toEqual([{ showFolderCounts: true }]);
  });

  it('keeps defaults visible and exposes concise load and save errors', async () => {
    const repository: ManagerSettingsRepository = {
      async load() {
        throw new Error('sensitive browser failure details');
      },
      async save() {
        throw new Error('quota and profile details');
      },
    };
    const { result } = renderHook(() => useManagerSettings(repository));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.settings).toEqual({ showFolderCounts: true });
    expect(result.current.error).toBe('无法读取设置');

    await act(async () => {
      await result.current.update({ showFolderCounts: false });
    });
    expect(result.current.settings).toEqual({ showFolderCounts: false });
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('无法保存设置');
  });

  it('does not reload when its consumer rerenders with the same repository', async () => {
    const load = vi.fn(async () => ({ showFolderCounts: true }));
    const repository: ManagerSettingsRepository = {
      load,
      async save() {},
    };
    const { rerender, result } = renderHook(
      ({ marker }) => {
        void marker;
        return useManagerSettings(repository);
      },
      { initialProps: { marker: 0 } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    rerender({ marker: 1 });

    expect(load).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('ready');
  });

  it('keeps the newest update when an older save fails later', async () => {
    const saves: Array<{
      settings: ManagerSettings;
      request: ReturnType<typeof deferred<void>>;
    }> = [];
    let persisted = true;
    const repository: ManagerSettingsRepository = {
      async load() {
        return { showFolderCounts: true };
      },
      save(settings) {
        const request = deferred<void>();
        saves.push({ settings, request });
        return request.promise.then(() => {
          persisted = settings.showFolderCounts;
        });
      },
    };
    const { result } = renderHook(() => useManagerSettings(repository));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let hideUpdate!: Promise<void>;
    let showUpdate!: Promise<void>;
    act(() => {
      hideUpdate = result.current.update({ showFolderCounts: false });
      showUpdate = result.current.update({ showFolderCounts: true });
    });
    expect(result.current.settings.showFolderCounts).toBe(true);

    await waitFor(() =>
      expect(
        saves.some(({ settings }) => settings.showFolderCounts === false),
      ).toBe(true),
    );
    const hideSave = saves.find(
      ({ settings }) => settings.showFolderCounts === false,
    );
    expect(hideSave).toBeTruthy();
    await act(async () => {
      hideSave?.request.reject(new Error('older save failed'));
      await hideUpdate;
    });

    await waitFor(() =>
      expect(
        saves.some(({ settings }) => settings.showFolderCounts === true),
      ).toBe(true),
    );
    const showSave = saves.find(
      ({ settings }) => settings.showFolderCounts === true,
    );
    await act(async () => {
      showSave?.request.resolve();
      await showUpdate;
    });

    expect(result.current.settings.showFolderCounts).toBe(true);
    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBeUndefined();
    expect(persisted).toBe(true);
  });

  it('ignores late StrictMode loads after switching repositories', async () => {
    const oldLoads: Array<ReturnType<typeof deferred<ManagerSettings>>> = [];
    const oldRepository: ManagerSettingsRepository = {
      load() {
        const request = deferred<ManagerSettings>();
        oldLoads.push(request);
        return request.promise;
      },
      async save() {},
    };
    const newRepository: ManagerSettingsRepository = {
      async load() {
        return { showFolderCounts: false };
      },
      async save() {},
    };
    const { rerender, result } = renderHook(
      ({ repository }) => useManagerSettings(repository),
      {
        initialProps: { repository: oldRepository },
        reactStrictMode: true,
      },
    );
    expect(oldLoads).toHaveLength(2);

    rerender({ repository: newRepository });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.settings.showFolderCounts).toBe(false);

    await act(async () => {
      for (const request of oldLoads) {
        request.resolve({ showFolderCounts: true });
      }
      await Promise.all(oldLoads.map(({ promise }) => promise));
    });
    expect(result.current.settings.showFolderCounts).toBe(false);
  });

  it('ignores a pending save failure after unmount', async () => {
    const saveRequest = deferred<void>();
    const repository: ManagerSettingsRepository = {
      async load() {
        return { showFolderCounts: true };
      },
      save() {
        return saveRequest.promise;
      },
    };
    const { result, unmount } = renderHook(() =>
      useManagerSettings(repository),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let update!: Promise<void>;
    act(() => {
      update = result.current.update({ showFolderCounts: false });
    });
    const snapshotAtUnmount = result.current;
    unmount();

    await act(async () => {
      saveRequest.reject(new Error('late save failure'));
      await update;
    });
    expect(result.current).toBe(snapshotAtUnmount);
  });
});
