import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';

import { createChromeBookmarkRepository } from '../../src/platform/bookmark-repository';
import { createBrowserBookmarkOperationStorage } from '../../src/platform/bookmark-operation-storage';
import { createBrowserManagerSettingsRepository } from '../../src/platform/manager-settings-repository';
import { ManagerApp } from '../../src/ui/manager/ManagerApp';
import '../../src/ui/manager/tokens.css';
import '../../src/ui/manager/app.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('找不到管理器根节点');
}

const repository = createChromeBookmarkRepository();
const settingsRepository = createBrowserManagerSettingsRepository();
const operationStorage = createBrowserBookmarkOperationStorage();

createRoot(root).render(
  <StrictMode>
    <ManagerApp
      openUrl={async (url) => {
        await browser.tabs.create({ url });
      }}
      operationStorage={operationStorage}
      repository={repository}
      settingsRepository={settingsRepository}
    />
  </StrictMode>,
);
