import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: '书签工作台',
    description: '本地优先的浏览器原生书签管理器',
    permissions: ['bookmarks', 'storage', 'activeTab', 'favicon'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    action: {
      default_title: '打开书签工作台',
    },
  },
});
