// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsView } from '../../src/ui/manager/SettingsView';

afterEach(cleanup);

describe('SettingsView', () => {
  it('renders the focused settings and dispatches toggle and manual refresh actions', () => {
    const onShowFolderCountsChange = vi.fn();
    const onThemeChange = vi.fn();
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
        onThemeChange={onThemeChange}
        settings={{ showFolderCounts: true, theme: 'system' }}
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
    const themeOptions = within(settings).getAllByRole('radio');
    expect(themeOptions).toHaveLength(6);
    expect(
      (within(settings).getByRole('radio', {
        name: '跟随系统',
      }) as HTMLInputElement).checked,
    ).toBe(true);

    fireEvent.click(within(settings).getByRole('radio', { name: '暖红' }));
    expect(onThemeChange).toHaveBeenCalledWith('warm-red');

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
        settings={{ showFolderCounts: true, theme: 'system' }}
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
    expect(
      (screen.getByRole('radio', { name: '暖红' }) as HTMLInputElement)
        .disabled,
    ).toBe(true);
  });
});
