import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';

import { createChromeBookmarkRepository } from '../../src/platform/bookmark-repository';
import { ManagerApp } from '../../src/ui/manager/ManagerApp';
import '../../src/ui/manager/tokens.css';
import '../../src/ui/manager/app.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('找不到管理器根节点');
}

const repository = createChromeBookmarkRepository();

createRoot(root).render(
  <StrictMode>
    <ManagerApp
      openUrl={async (url) => {
        await browser.tabs.create({ url });
      }}
      repository={repository}
    />
  </StrictMode>,
);
