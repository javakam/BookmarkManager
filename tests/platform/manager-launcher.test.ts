import { describe, expect, it, vi } from 'vitest';

import { openOrFocusManager } from '../../src/platform/manager-launcher';

function createApi() {
  return {
    runtime: {
      getContexts: vi.fn(),
    },
    tabs: {
      query: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    windows: {
      update: vi.fn(),
    },
  };
}

describe('openOrFocusManager', () => {
  it('激活并聚焦已有工作台页签，不重复创建', async () => {
    const api = createApi();
    api.runtime.getContexts.mockResolvedValue([{ tabId: 42 }]);
    api.tabs.update.mockResolvedValue({ id: 42, windowId: 7 });

    await openOrFocusManager(api, 'chrome-extension://test/manager.html');

    expect(api.tabs.update).toHaveBeenCalledWith(42, { active: true });
    expect(api.windows.update).toHaveBeenCalledWith(7, { focused: true });
    expect(api.tabs.create).not.toHaveBeenCalled();
  });

  it('没有已有工作台时创建新页签', async () => {
    const api = createApi();
    api.runtime.getContexts.mockResolvedValue([]);
    api.tabs.query.mockResolvedValue([]);

    await openOrFocusManager(api, 'chrome-extension://test/manager.html');

    expect(api.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test/manager.html',
    });
  });

  it('查询工作台失败时仍然创建新页签', async () => {
    const api = createApi();
    api.runtime.getContexts.mockRejectedValue(new Error('unsupported'));
    api.tabs.query.mockRejectedValue(new Error('permission denied'));

    await openOrFocusManager(api, 'chrome-extension://test/manager.html');

    expect(api.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test/manager.html',
    });
  });
});
