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
        await browser.tabs.create({
          url: browser.runtime.getURL('/manager.html'),
        });
      }}
    />
  </StrictMode>,
);
