export interface ManagerTab {
  readonly id?: number;
  readonly windowId?: number;
}

interface ManagerRuntimeApi {
  readonly getContexts?: (filter: {
    readonly contextTypes: readonly string[];
    readonly documentUrls: readonly string[];
  }) => Promise<readonly { readonly tabId?: number }[]>;
}

export interface ManagerLaunchApi {
  readonly runtime: ManagerRuntimeApi;
  readonly tabs: {
    readonly query: (query: {
      readonly url: string;
    }) => Promise<readonly ManagerTab[]>;
    readonly update: (
      tabId: number,
      updateProperties: { readonly active: boolean },
    ) => Promise<ManagerTab | undefined>;
    readonly create: (createProperties: {
      readonly url: string;
    }) => Promise<ManagerTab | undefined>;
  };
  readonly windows: {
    readonly update: (
      windowId: number,
      updateInfo: { readonly focused: boolean },
    ) => Promise<unknown>;
  };
}

async function findExistingManagerTab(
  api: ManagerLaunchApi,
  url: string,
): Promise<number | undefined> {
  try {
    const contexts = await api.runtime.getContexts?.({
      contextTypes: ['TAB'],
      documentUrls: [url],
    });
    const contextTab = contexts?.find((context) => context.tabId !== undefined);
    if (contextTab?.tabId !== undefined) {
      return contextTab.tabId;
    }
  } catch {
    // Older Chromium versions may not expose runtime.getContexts.
  }

  try {
    const existing = await api.tabs.query({ url });
    return existing.find((tab) => tab.id !== undefined)?.id;
  } catch {
    // URL queries can be restricted by browser policy. Creating a new tab is safe.
    return undefined;
  }
}

export async function openOrFocusManager(
  api: ManagerLaunchApi,
  url: string,
): Promise<void> {
  const existingTabId = await findExistingManagerTab(api, url);
  if (existingTabId !== undefined) {
    try {
      const existingTab = await api.tabs.update(existingTabId, {
        active: true,
      });
      if (existingTab?.windowId !== undefined) {
        try {
          await api.windows.update(existingTab.windowId, {
            focused: true,
          });
        } catch {
          // The tab is already active even if window focus is restricted.
        }
      }
      return;
    } catch {
      // The tab may have closed between the query and update. Open a fresh one.
    }
  }

  await api.tabs.create({ url });
}
