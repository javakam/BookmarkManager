import { CheckCircle2, RefreshCw } from 'lucide-react';

import type { ManagerSettingsState } from '../../app/use-manager-settings';
import type { ManagerSettings } from '../../platform/manager-settings-repository';

interface SettingsViewProps {
  readonly settings: ManagerSettings;
  readonly settingsStatus: ManagerSettingsState['status'];
  readonly settingsError?: string;
  readonly lastUpdatedAt?: number;
  readonly isRefreshing: boolean;
  readonly onShowFolderCountsChange: (showFolderCounts: boolean) => void;
  readonly onRefresh: () => void;
}

const UPDATED_AT_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'medium',
});

export function SettingsView({
  settings,
  settingsStatus,
  settingsError,
  lastUpdatedAt,
  isRefreshing,
  onShowFolderCountsChange,
  onRefresh,
}: SettingsViewProps) {
  return (
    <section
      aria-labelledby="settings-view-title"
      className="settings-view"
      role="region"
    >
      <header className="settings-view__header">
        <h1 id="settings-view-title">设置</h1>
      </header>

      {settingsError && (
        <div className="settings-view__error" role="alert">
          {settingsError}
        </div>
      )}

      <div className="settings-preference">
        <label className="settings-toggle">
          <span>显示目录书签数量</span>
          <input
            checked={settings.showFolderCounts}
            disabled={settingsStatus === 'loading'}
            onChange={(event) =>
              onShowFolderCountsChange(event.currentTarget.checked)
            }
            type="checkbox"
          />
          <span aria-hidden="true" className="settings-toggle__track">
            <span className="settings-toggle__thumb" />
          </span>
        </label>
      </div>

      <dl className="settings-details">
        <div className="settings-details__row">
          <dt>数据来源</dt>
          <dd>当前浏览器原生书签</dd>
        </div>
        <div className="settings-details__row">
          <dt>自动更新</dt>
          <dd className="settings-enabled-state">
            <CheckCircle2 aria-hidden="true" size={16} />
            <span>已开启</span>
          </dd>
        </div>
        <div className="settings-details__row settings-details__row--refresh">
          <dt>上次更新</dt>
          <dd>
            {lastUpdatedAt === undefined ? (
              <span>尚未更新</span>
            ) : (
              <time dateTime={new Date(lastUpdatedAt).toISOString()}>
                {UPDATED_AT_FORMATTER.format(lastUpdatedAt)}
              </time>
            )}
            <button
              aria-label="立即刷新书签"
              className="command-button command-button--secondary settings-refresh"
              disabled={isRefreshing}
              onClick={onRefresh}
              type="button"
            >
              <RefreshCw
                aria-hidden="true"
                className={isRefreshing ? 'spin' : undefined}
                size={16}
              />
              <span>立即刷新</span>
            </button>
          </dd>
        </div>
      </dl>
    </section>
  );
}
