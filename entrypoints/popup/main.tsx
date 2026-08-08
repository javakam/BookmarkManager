import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';

import { Popup } from '../../src/ui/popup/Popup';
import '../../src/ui/popup/popup.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('找不到弹窗根节点');
}

createRoot(root).render(
  <StrictMode>
    <Popup
      closePopup={() => window.close()}
      openManager={async () => {
        const url = browser.runtime.getURL('/manager.html');
        try {
          const existing = await browser.tabs.query({ url });
          const existingTab = existing.find((tab) => tab.id !== undefined);
          if (existingTab?.id !== undefined) {
            await browser.tabs.update(existingTab.id, { active: true });
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
