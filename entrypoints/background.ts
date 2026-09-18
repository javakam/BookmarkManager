import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';

import {
  openOrFocusManager,
  type ManagerLaunchApi,
} from '../src/platform/manager-launcher';

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {});
  browser.action.onClicked.addListener(() => {
    const url = browser.runtime.getURL('/manager.html');
    void openOrFocusManager(
      browser as unknown as ManagerLaunchApi,
      url,
    ).catch(() => {
      // There is no popup to keep open for an action error.
    });
  });
});
