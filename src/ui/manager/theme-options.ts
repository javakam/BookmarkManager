import type { ManagerTheme } from '../../platform/manager-settings-repository';

export interface ManagerThemeOption {
  readonly value: ManagerTheme;
  readonly label: string;
  readonly preview: {
    readonly workspace: string;
    readonly surface: string;
    readonly primary: string;
  };
}

export const MANAGER_THEME_OPTIONS: readonly ManagerThemeOption[] = [
  {
    value: 'system',
    label: '跟随系统',
    preview: {
      workspace: '#eef3f1',
      surface: '#ffffff',
      primary: '#176b57',
    },
  },
  {
    value: 'light',
    label: '浅色',
    preview: {
      workspace: '#eef3f1',
      surface: '#ffffff',
      primary: '#176b57',
    },
  },
  {
    value: 'dark',
    label: '深色',
    preview: {
      workspace: '#202825',
      surface: '#29332f',
      primary: '#6bc2a4',
    },
  },
  {
    value: 'warm-red',
    label: '暖红',
    preview: {
      workspace: '#fff4f1',
      surface: '#fffdfc',
      primary: '#b34345',
    },
  },
  {
    value: 'warm-red-dark',
    label: '暖红深色',
    preview: {
      workspace: '#282122',
      surface: '#35292a',
      primary: '#f08a84',
    },
  },
  {
    value: 'slate',
    label: '雾蓝',
    preview: {
      workspace: '#f1f4f8',
      surface: '#ffffff',
      primary: '#3b5b9a',
    },
  },
];
