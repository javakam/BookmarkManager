import {
  Bookmark,
  LoaderCircle,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { BookmarkIndex } from '../../app/bookmark-index';
import { createBookmarkViewModel, getBookmarkDisplayInfo } from '../../app/bookmark-view-model';
import { useBookmarks } from '../../app/use-bookmarks';
import { useManagerSettings } from '../../app/use-manager-settings';
import {
  useOrganizeAnalysis,
  type OrganizeAnalyzers,
} from '../../app/use-organize-analysis';
import type { BookmarkRecord } from '../../domain/bookmarks';
import type { BookmarkRepository } from '../../platform/bookmark-repository';
import {
  DEFAULT_MANAGER_SETTINGS,
  type ManagerSettingsRepository,
} from '../../platform/manager-settings-repository';
import { BrowseView } from './BrowseView';
import { FolderTree, type ManagerView } from './FolderTree';
import { OrganizeView } from './OrganizeView';
import { SearchResults } from './SearchResults';
import { SettingsView } from './SettingsView';

type SearchScopeMode = 'all' | 'folder';

export interface ManagerAppProps {
  readonly repository: BookmarkRepository;
  readonly settingsRepository?: ManagerSettingsRepository;
  readonly openUrl: (url: string) => Promise<void>;
  readonly organizeAnalyzers?: OrganizeAnalyzers;
}

function createDefaultSettingsRepository(): ManagerSettingsRepository {
  let settings = { ...DEFAULT_MANAGER_SETTINGS };
  return {
    async load() {
      return settings;
    },
    async save(nextSettings) {
      settings = { showFolderCounts: nextSettings.showFolderCounts };
    },
  };
}

export function ManagerApp({
  repository,
  settingsRepository,
  openUrl,
  organizeAnalyzers,
}: ManagerAppProps) {
  const data = useBookmarks(repository);
  const [defaultSettingsRepository] = useState(createDefaultSettingsRepository);
  const managerSettings = useManagerSettings(
    settingsRepository ?? defaultSettingsRepository,
  );
  const model = useMemo(
    () => createBookmarkViewModel(data.records),
    [data.records],
  );
  const index = useMemo(
    () => new BookmarkIndex(model.searchableRecords),
    [model],
  );
  const [activeFolderId, setActiveFolderId] = useState<string>();
  const [view, setView] = useState<ManagerView>('browse');
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [query, setQuery] = useState('');
  const [scopeMode, setScopeMode] = useState<SearchScopeMode>('all');
  const [highlightedId, setHighlightedId] = useState<string>();
  const [openError, setOpenError] = useState<string>();
  const [locationStatus, setLocationStatus] = useState<string>();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const organizeAnalysis = useOrganizeAnalysis(
    data.records,
    data.revision,
    view === 'organize' && (data.status !== 'loading' || data.records.length > 0),
    organizeAnalyzers,
  );

  const resolvedFolderId = model.resolveFolderId(activeFolderId);
  const normalizedQuery = query.trim();
  const scope = useMemo(
    () =>
      scopeMode === 'folder' && resolvedFolderId
        ? {
            kind: 'ids' as const,
            ids: model.getDescendantIds(resolvedFolderId),
          }
        : { kind: 'all' as const },
    [model, resolvedFolderId, scopeMode],
  );
  const results = useMemo(
    () =>
      normalizedQuery ? index.search(normalizedQuery, scope, 200) : [],
    [index, normalizedQuery, scope],
  );

  useEffect(() => {
    if (activeFolderId !== resolvedFolderId) {
      setActiveFolderId(resolvedFolderId);
    }
  }, [activeFolderId, resolvedFolderId]);

  useEffect(() => {
    if (highlightedId && !model.recordById.has(highlightedId)) {
      setHighlightedId(undefined);
      setLocationStatus(undefined);
    }
  }, [highlightedId, model]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
      } else if (event.key === 'Escape') {
        setQuery('');
      }
    };
    document.addEventListener('keydown', handleKeyboard);
    return () => document.removeEventListener('keydown', handleKeyboard);
  }, []);

  const revealFolder = useCallback(
    (folderId: string) => {
      const pathIds = model.getBreadcrumbs(folderId).map(({ id }) => id);
      setExpandedFolderIds((current) => {
        const next = new Set(current);
        for (const id of pathIds) {
          next.add(id);
        }
        return next;
      });
    },
    [model],
  );

  const navigate = useCallback(
    (folderId: string) => {
      setActiveFolderId(folderId);
      setHighlightedId(undefined);
      setLocationStatus(undefined);
      revealFolder(folderId);
    },
    [revealFolder],
  );

  const enterSearchFolder = useCallback(
    (folderId: string) => {
      navigate(folderId);
      setQuery('');
    },
    [navigate],
  );

  const handleOpen = useCallback(
    async (record: BookmarkRecord) => {
      if (!record.url) {
        return;
      }
      setOpenError(undefined);
      try {
        await openUrl(record.url);
      } catch {
        setOpenError('无法打开新标签页');
      }
    },
    [openUrl],
  );

  const locate = useCallback(
    (record: BookmarkRecord) => {
      const parentFolderId = model.resolveFolderId(record.parentId);
      if (parentFolderId) {
        setActiveFolderId(parentFolderId);
        revealFolder(parentFolderId);
      }
      const display = getBookmarkDisplayInfo(record);
      setHighlightedId(record.id);
      setLocationStatus(`已定位 ${display.displayTitle}`);
      setQuery('');
      setView('browse');
    },
    [model, revealFolder],
  );

  const locateFolder = useCallback(
    (folder: BookmarkRecord) => {
      setActiveFolderId(folder.id);
      revealFolder(folder.id);
      setHighlightedId(undefined);
      setLocationStatus(`已定位 ${getBookmarkDisplayInfo(folder).displayTitle}`);
      setQuery('');
      setView('browse');
    },
    [revealFolder],
  );

  const bookmarkCount = model.searchableRecords.filter(
    (record) => !record.isFolder,
  ).length;
  const folderCount = model.searchableRecords.length - bookmarkCount;

  let content: React.ReactNode;
  if (data.status === 'loading' && data.records.length === 0) {
    content = (
      <div className="content-state content-state--page" role="status">
        <LoaderCircle aria-hidden="true" className="spin" size={20} />
        <span>正在读取书签...</span>
      </div>
    );
  } else if (data.status === 'error' && data.records.length === 0) {
    content = (
      <div className="content-state content-state--page" role="alert">
        <strong>无法读取书签</strong>
        <span>{data.error}</span>
        <button className="command-button" onClick={() => void data.refresh()} type="button">
          重试
        </button>
      </div>
    );
  } else if (view === 'settings') {
    content = (
      <SettingsView
        isRefreshing={data.status === 'loading'}
        lastUpdatedAt={data.lastUpdatedAt}
        onRefresh={() => void data.refresh()}
        onShowFolderCountsChange={(showFolderCounts) =>
          void managerSettings.update({ showFolderCounts })
        }
        settings={managerSettings.settings}
        settingsError={managerSettings.error}
        settingsStatus={managerSettings.status}
      />
    );
  } else if (view === 'organize') {
    if (organizeAnalysis.status === 'ready') {
      content = (
        <OrganizeView
          analysis={organizeAnalysis.analysis}
          onLocateBookmark={locate}
          onLocateFolder={locateFolder}
          onOpen={(record) => void handleOpen(record)}
        />
      );
    } else if (organizeAnalysis.status === 'error') {
      content = (
        <div className="content-state content-state--page" role="alert">
          <strong>无法分析书签</strong>
          <span>{organizeAnalysis.error}</span>
        </div>
      );
    } else {
      content = (
        <div className="content-state content-state--page" role="status">
          <LoaderCircle aria-hidden="true" className="spin" size={20} />
          <span>正在分析...</span>
        </div>
      );
    }
  } else if (!resolvedFolderId) {
    content = (
      <div className="content-state content-state--page">没有可浏览的书签目录</div>
    );
  } else if (normalizedQuery) {
    content = (
      <SearchResults
        onEnterFolder={enterSearchFolder}
        onLocate={locate}
        onOpen={(record) => void handleOpen(record)}
        results={results}
      />
    );
  } else {
    content = (
      <BrowseView
        activeFolderId={resolvedFolderId}
        highlightedId={highlightedId}
        model={model}
        onNavigate={navigate}
        onOpen={(record) => void handleOpen(record)}
      />
    );
  }

  return (
    <div className="manager-app">
      <header className="app-header">
        <div className="app-brand">
          <Bookmark aria-hidden="true" size={20} />
          <span>书签工作台</span>
        </div>
        <div className="header-center">
          <label className="global-search">
            <Search aria-hidden="true" size={17} />
            <input
              aria-label="搜索书签"
              onChange={(event) => {
                const nextQuery = event.target.value;
                setQuery(nextQuery);
                if (nextQuery.trim()) {
                  setView('browse');
                }
                setLocationStatus(undefined);
              }}
              placeholder="搜索书签、网址、域名或文件夹"
              ref={searchInputRef}
              type="search"
              value={query}
            />
            {query && (
              <button
                aria-label="清空搜索"
                className="search-clear"
                onClick={() => setQuery('')}
                title="清空搜索"
                type="button"
              >
                <X aria-hidden="true" size={16} />
              </button>
            )}
          </label>
          <div aria-label="搜索范围" className="scope-control" role="group">
            <button
              aria-pressed={scopeMode === 'all'}
              onClick={() => setScopeMode('all')}
              type="button"
            >
              全部书签
            </button>
            <button
              aria-pressed={scopeMode === 'folder'}
              disabled={!resolvedFolderId}
              onClick={() => setScopeMode('folder')}
              type="button"
            >
              当前文件夹
            </button>
          </div>
        </div>
        <div className="header-meta">
          <span>{bookmarkCount} 个书签</span>
          <span>{folderCount} 个文件夹</span>
          <button
            aria-label="刷新书签"
            className="icon-button"
            disabled={data.status === 'loading'}
            onClick={() => void data.refresh()}
            title="刷新书签"
            type="button"
          >
            <RefreshCw
              aria-hidden="true"
              className={data.status === 'loading' ? 'spin' : undefined}
              size={17}
            />
          </button>
        </div>
      </header>
      <div className="app-body">
        <FolderTree
          activeFolderId={resolvedFolderId}
          expandedFolderIds={expandedFolderIds}
          model={model}
          onSelect={navigate}
          onToggle={(folderId) => {
            setExpandedFolderIds((current) => {
              const next = new Set(current);
              if (next.has(folderId)) {
                next.delete(folderId);
              } else {
                next.add(folderId);
              }
              return next;
            });
          }}
          onViewChange={setView}
          showFolderCounts={managerSettings.settings.showFolderCounts}
          view={view}
        />
        <main className="app-main">
          {data.status === 'error' && data.records.length > 0 && (
            <div className="inline-error" role="alert">
              {data.error || '刷新书签失败'}
              <button onClick={() => void data.refresh()} type="button">重试</button>
            </div>
          )}
          {openError && <div className="inline-error" role="alert">{openError}</div>}
          {locationStatus && <div className="location-status" role="status">{locationStatus}</div>}
          {content}
        </main>
      </div>
    </div>
  );
}
