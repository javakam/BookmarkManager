// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsView } from '../../src/ui/manager/SettingsView';

afterEach(cleanup);

describe('SettingsView', () => {
  it('renders the focused settings and dispatches toggle and manual refresh actions', () => {
    const onShowFolderCountsChange = vi.fn();
    const onRefresh = vi.fn();
    const lastUpdatedAt = new Date(2026, 6, 12, 10, 30, 5).getTime();
    const expectedTime = new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'medium',
      timeStyle: 'medium',
    }).format(lastUpdatedAt);

    render(
      <SettingsView
        isRefreshing={false}
        lastUpdatedAt={lastUpdatedAt}
        onRefresh={onRefresh}
        onShowFolderCountsChange={onShowFolderCountsChange}
        settings={{ showFolderCounts: true }}
        settingsStatus="ready"
      />,
    );

    const settings = screen.getByRole('region', { name: '设置' });
    const toggle = within(settings).getByRole('checkbox', {
      name: '显示目录书签数量',
    });
    expect((toggle as HTMLInputElement).checked).toBe(true);
    expect(within(settings).getByText('当前浏览器原生书签')).toBeTruthy();
    expect(within(settings).getByText('自动更新')).toBeTruthy();
    expect(within(settings).getByText('已开启')).toBeTruthy();
    expect(
      within(settings).queryByRole('checkbox', { name: '自动更新' }),
    ).toBeNull();
    expect(within(settings).getByText(expectedTime)).toBeTruthy();
    expect(within(settings).queryByText(/主题|密度|链接检查/)).toBeNull();

    fireEvent.click(toggle);
    expect(onShowFolderCountsChange).toHaveBeenCalledWith(false);

    fireEvent.click(
      within(settings).getByRole('button', { name: '立即刷新书签' }),
    );
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows unavailable refresh time and settings errors without hiding controls', () => {
    render(
      <SettingsView
        isRefreshing
        onRefresh={vi.fn()}
        onShowFolderCountsChange={vi.fn()}
        settings={{ showFolderCounts: true }}
        settingsError="无法读取设置"
        settingsStatus="error"
      />,
    );

    expect(screen.getByText('尚未更新')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('无法读取设置');
    expect(
      screen.getByRole('checkbox', { name: '显示目录书签数量' }),
    ).toBeTruthy();
    expect(
      (screen.getByRole('button', {
        name: '立即刷新书签',
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
