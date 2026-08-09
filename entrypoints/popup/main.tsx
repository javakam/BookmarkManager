import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';

import { Popup } from '../../src/ui/popup/Popup';
import '../../src/ui/popup/popup.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('找不到弹窗根节点');
}

interface RuntimeContext {
  readonly tabId?: number;
}

interface RuntimeContextsApi {
  readonly getContexts?: (filter: {
    readonly contextTypes: readonly string[];
    readonly documentUrls: readonly string[];
  }) => Promise<readonly RuntimeContext[]>;
}

async function findExistingManagerTab(url: string): Promise<number | undefined> {
  const runtime = browser.runtime as typeof browser.runtime & RuntimeContextsApi;
  const contexts = await runtime.getContexts?.({
    contextTypes: ['TAB'],
    documentUrls: [url],
  });
  const contextTab = contexts?.find((context) => context.tabId !== undefined);
  if (contextTab?.tabId !== undefined) {
    return contextTab.tabId;
  }

  const existing = await browser.tabs.query({ url });
  return existing.find((tab) => tab.id !== undefined)?.id;
}

createRoot(root).render(
  <StrictMode>
    <Popup
      closePopup={() => window.close()}
      openManager={async () => {
        const url = browser.runtime.getURL('/manager.html');
        try {
          const existingTabId = await findExistingManagerTab(url);
          if (existingTabId !== undefined) {
            await browser.tabs.update(existingTabId, { active: true });
            return;
          }
        } catch {
          // Some Chromium policies require the tabs permission for querying
          // URLs. Keep opening the manager even when that optional reuse path
          // is unavailable.
        }
        await browser.tabs.create({ url });
      }}
    />
  </StrictMode>,
);
