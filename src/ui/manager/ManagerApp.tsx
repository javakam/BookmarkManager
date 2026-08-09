import {
  BookmarkCheck,
  LoaderCircle,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  createBookmarkOperationService,
  type BookmarkOperationPlan,
} from '../../app/bookmark-operation-service';
import { BookmarkIndex } from '../../app/bookmark-index';
import { createBookmarkViewModel, getBookmarkDisplayInfo } from '../../app/bookmark-view-model';
import { useBookmarks } from '../../app/use-bookmarks';
import { useManagerSettings } from '../../app/use-manager-settings';
import {
  useOrganizeAnalysis,
  type OrganizeAnalyzers,
} from '../../app/use-organize-analysis';
import type { BookmarkRecord } from '../../domain/bookmarks';
import { isDangerousBookmarkUrl } from '../../domain/url-safety';
import {
  calculateFolderMove,
  type FolderDropPosition,
} from '../../domain/folder-reorder';
import {
  type BookmarkOperationExecution,
} from '../../domain/bookmark-operations';
import type { BookmarkRepository } from '../../platform/bookmark-repository';
import {
  DEFAULT_MANAGER_SETTINGS,
  type ManagerSettingsRepository,
} from '../../platform/manager-settings-repository';
import { BookmarkEditorDialog } from './BookmarkEditorDialog';
import { BrowseView } from './BrowseView';
import { ConfirmOperationDialog } from './ConfirmOperationDialog';
import { FolderTree, type ManagerView } from './FolderTree';
import { MoveBookmarkDialog } from './MoveBookmarkDialog';
import { OrganizeView, type OrganizeTab } from './OrganizeView';
import { SearchResults } from './SearchResults';
import { SettingsView } from './SettingsView';

type SearchScopeMode = 'all' | 'folder';

export interface ManagerAppProps {
  readonly repository: BookmarkRepository;
  readonly settingsRepository?: ManagerSettingsRepository;
  readonly openUrl: (url: string) => Promise<void>;
  readonly organizeAnalyzers?: OrganizeAnalyzers;
  readonly version?: string;
}

type EditorState =
  | {
      readonly mode: 'create-bookmark';
      readonly parentId: string;
      readonly records: readonly BookmarkRecord[];
    }
  | {
      readonly mode: 'create-folder';
      readonly parentId: string;
      readonly records: readonly BookmarkRecord[];
    }
  | {
      readonly mode: 'edit';
      readonly record: BookmarkRecord;
      readonly records: readonly BookmarkRecord[];
    };

type LocationReturnState =
  | {
      readonly kind: 'search';
      readonly query: string;
      readonly scopeMode: SearchScopeMode;
      readonly folderId?: string;
      readonly scrollTop: number;
    }
  | {
      readonly kind: 'organize';
      readonly folderId?: string;
      readonly scrollTop: number;
    };

function operationResultSummary(execution: BookmarkOperationExecution): string {
  const successfulCount = execution.results.filter(
    (result) => result.status === 'success',
  ).length;
  const conflictCount = execution.results.filter(
    (result) => result.status === 'conflict',
  ).length;
  const failureCount = execution.results.filter(
    (result) => result.status === 'failure',
  ).length;
  if (conflictCount > 0 || failureCount > 0) {
    return `已完成 ${successfulCount} 项，${conflictCount} 项冲突，${failureCount} 项失败`;
  }

  switch (execution.kind) {
    case 'create-bookmark':
      return '已新建书签';
    case 'create-folder':
      return '已新建文件夹';
    case 'update':
      return '已保存修改';
    case 'move':
      return successfulCount === 1 ? '已移动' : `已移动 ${successfulCount} 项`;
    case 'reorder':
      return '已调整文件夹顺序';
    case 'delete':
      return successfulCount === 1
        ? '已永久删除'
        : `已永久删除 ${successfulCount} 项`;
  }
}

function createDefaultSettingsRepository(): ManagerSettingsRepository {
  let settings = { ...DEFAULT_MANAGER_SETTINGS };
  return {
    async load() {
      return settings;
    },
    async save(nextSettings) {
      settings = {
        showFolderCounts: nextSettings.showFolderCounts,
        theme: nextSettings.theme,
      };
    },
  };
}

export function ManagerApp({
  repository,
  settingsRepository,
  openUrl,
  organizeAnalyzers,
  version,
}: ManagerAppProps) {
  const data = useBookmarks(repository);
  const [defaultSettingsRepository] = useState(createDefaultSettingsRepository);
  const managerSettings = useManagerSettings(
    settingsRepository ?? defaultSettingsRepository,
  );
  const operationService = useMemo(
    () =>
      createBookmarkOperationService({
        repository,
      }),
    [repository],
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
  const initialExpansionApplied = useRef(false);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [scopeMode, setScopeMode] = useState<SearchScopeMode>('all');
  const [organizeTab, setOrganizeTab] = useState<OrganizeTab>('duplicates');
  const [highlightedId, setHighlightedId] = useState<string>();
  const [openError, setOpenError] = useState<string>();
  const [operationError, setOperationError] = useState<string>();
  const [editorState, setEditorState] = useState<EditorState>();
  const [moveRecord, setMoveRecord] = useState<BookmarkRecord>();
  const [moveSourceIds, setMoveSourceIds] = useState<readonly string[]>();
  const [moveRecordsSnapshot, setMoveRecordsSnapshot] = useState<
    readonly BookmarkRecord[]
  >();
  const [confirmPlan, setConfirmPlan] = useState<BookmarkOperationPlan>();
  const [operationResult, setOperationResult] =
    useState<BookmarkOperationExecution>();
  const [isExecutingOperation, setIsExecutingOperation] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [locationStatus, setLocationStatus] = useState<string>();
  const [locationReturn, setLocationReturn] = useState<LocationReturnState>();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const operationFocusOriginRef = useRef<HTMLElement | null>(null);
  const pendingScrollTop = useRef<number | undefined>(undefined);
  const organizeAnalysis = useOrganizeAnalysis(
    data.records,
    data.revision,
    view === 'organize' && (data.status !== 'loading' || data.records.length > 0),
    organizeAnalyzers,
  );

  const defaultFolderId = model.defaultFolderId;

  useLayoutEffect(() => {
    if (initialExpansionApplied.current || data.status === 'loading' || !defaultFolderId) {
      return;
    }
    initialExpansionApplied.current = true;
    setExpandedFolderIds((current) => {
      if (current.has(defaultFolderId)) {
        return current;
      }
      const next = new Set(current);
      next.add(defaultFolderId);
      return next;
    });
  }, [data.status, defaultFolderId]);

  useLayoutEffect(() => {
    if (pendingScrollTop.current === undefined || !mainRef.current) {
      return;
    }
    mainRef.current.scrollTop = pendingScrollTop.current;
    pendingScrollTop.current = undefined;
  }, [organizeTab, query, view]);

  const resolvedFolderId = model.resolveFolderId(activeFolderId);
  const normalizedQuery = query.trim();
  const deferredNormalizedQuery = deferredQuery.trim();
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
      deferredNormalizedQuery
        ? index.search(deferredNormalizedQuery, scope, 200)
        : [],
    [deferredNormalizedQuery, index, scope],
  );
  const moveModel = useMemo(
    () =>
      moveRecordsSnapshot
        ? createBookmarkViewModel(moveRecordsSnapshot)
        : model,
    [model, moveRecordsSnapshot],
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
    setSelectedIds(new Set());
  }, [resolvedFolderId]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [normalizedQuery, scopeMode]);

  useEffect(() => {
    setSelectedIds((current) => {
      const next = new Set(
        [...current].filter((id) => model.recordById.has(id)),
      );
      return next.size === current.size ? current : next;
    });
  }, [model]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (document.querySelector('[aria-modal="true"], [role="menu"]')) {
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
      } else if (event.key === 'Escape') {
        setQuery('');
        setLocationReturn(undefined);
        setLocationStatus(undefined);
      }
    };
    document.addEventListener('keydown', handleKeyboard);
    return () => document.removeEventListener('keydown', handleKeyboard);
  }, []);

  useEffect(() => {
    if (!operationResult) return;
    if (operationResult.results.some((result) => result.status !== 'success')) {
      return;
    }
    const timer = window.setTimeout(() => setOperationResult(undefined), 2600);
    return () => window.clearTimeout(timer);
  }, [operationResult]);

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

  const clearLocationReturn = useCallback(() => {
    setLocationReturn(undefined);
    setLocationStatus(undefined);
  }, []);

  const rememberOperationFocus = useCallback(() => {
    setOpenError(undefined);
    setOperationError(undefined);
    setOperationResult(undefined);
    if (operationFocusOriginRef.current?.isConnected) {
      return;
    }
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      operationFocusOriginRef.current = activeElement;
    }
  }, []);

  const restoreOperationFocus = useCallback(() => {
    const origin = operationFocusOriginRef.current;
    operationFocusOriginRef.current = null;
    window.setTimeout(() => {
      if (origin?.isConnected) {
        origin.focus();
      } else {
        mainRef.current?.focus();
      }
    }, 0);
  }, []);

  const navigate = useCallback(
    (folderId: string) => {
      setActiveFolderId(folderId);
      setHighlightedId(undefined);
      setOpenError(undefined);
      setOperationError(undefined);
      clearLocationReturn();
      revealFolder(folderId);
    },
    [clearLocationReturn, revealFolder],
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
      if (isDangerousBookmarkUrl(record.url)) {
        setOpenError('出于安全原因，不能打开可执行网址协议');
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
      const returnState: LocationReturnState | undefined = normalizedQuery
        ? {
            kind: 'search',
            query,
            scopeMode,
            folderId: resolvedFolderId,
            scrollTop: mainRef.current?.scrollTop ?? 0,
          }
        : view === 'organize'
          ? {
              kind: 'organize',
              folderId: resolvedFolderId,
              scrollTop: mainRef.current?.scrollTop ?? 0,
            }
          : undefined;
      const parentFolderId = model.resolveFolderId(record.parentId);
      if (parentFolderId) {
        setActiveFolderId(parentFolderId);
        revealFolder(parentFolderId);
      }
      const display = getBookmarkDisplayInfo(record);
      setHighlightedId(record.id);
      setLocationStatus(`已定位 ${display.displayTitle}`);
      setLocationReturn(returnState);
      setQuery('');
      setView('browse');
    },
    [model, normalizedQuery, query, resolvedFolderId, scopeMode, view, revealFolder],
  );

  const locateFolder = useCallback(
    (folder: BookmarkRecord) => {
      const returnState: LocationReturnState | undefined = normalizedQuery
        ? {
            kind: 'search',
            query,
            scopeMode,
            folderId: resolvedFolderId,
            scrollTop: mainRef.current?.scrollTop ?? 0,
          }
        : view === 'organize'
          ? {
              kind: 'organize',
              folderId: resolvedFolderId,
              scrollTop: mainRef.current?.scrollTop ?? 0,
            }
          : undefined;
      setActiveFolderId(folder.id);
      revealFolder(folder.id);
      setHighlightedId(undefined);
      setLocationStatus(`已定位 ${getBookmarkDisplayInfo(folder).displayTitle}`);
      setLocationReturn(returnState);
      setQuery('');
      setView('browse');
    },
    [normalizedQuery, query, resolvedFolderId, scopeMode, view, revealFolder],
  );

  const returnFromLocation = useCallback(() => {
    if (!locationReturn) {
      return;
    }
    const source = locationReturn;
    setLocationReturn(undefined);
    setLocationStatus(undefined);
    setHighlightedId(undefined);
    setActiveFolderId(source.folderId);
    pendingScrollTop.current = source.scrollTop;
    if (source.folderId) {
      revealFolder(source.folderId);
    }
    if (source.kind === 'search') {
      setScopeMode(source.scopeMode);
      setQuery(source.query);
      setView('browse');
    } else {
      setQuery('');
      setView('organize');
    }
  }, [locationReturn, revealFolder]);

  const changeView = useCallback(
    (nextView: ManagerView) => {
      clearLocationReturn();
      setOpenError(undefined);
      setOperationError(undefined);
      if (nextView === 'organize') {
        setOrganizeTab('duplicates');
      }
      setView(nextView);
    },
    [clearLocationReturn],
  );

  const clearOperationUi = useCallback(() => {
    setEditorState(undefined);
    setMoveRecord(undefined);
    setMoveSourceIds(undefined);
    setMoveRecordsSnapshot(undefined);
    setConfirmPlan(undefined);
    setOperationError(undefined);
    restoreOperationFocus();
  }, [restoreOperationFocus]);

  useEffect(() => {
    if (
      isExecutingOperation ||
      (!editorState && !moveRecord && !moveSourceIds && !confirmPlan)
    ) {
      return;
    }
    const handleDialogKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      clearOperationUi();
    };
    document.addEventListener('keydown', handleDialogKeyboard);
    return () => document.removeEventListener('keydown', handleDialogKeyboard);
  }, [
    clearOperationUi,
    confirmPlan,
    editorState,
    isExecutingOperation,
    moveRecord,
    moveSourceIds,
  ]);

  const openEditor = useCallback(
    (next: EditorState['mode'], value: string | BookmarkRecord) => {
      rememberOperationFocus();
      setOpenError(undefined);
      setOperationError(undefined);
      if (next === 'edit') {
        setEditorState({
          mode: 'edit',
          record: value as BookmarkRecord,
          records: data.records,
        });
        return;
      }
      setEditorState({
        mode: next,
        parentId: value as string,
        records: data.records,
      });
    },
    [data.records, rememberOperationFocus],
  );

  const startMove = useCallback(
    (record: BookmarkRecord) => {
      rememberOperationFocus();
      setOpenError(undefined);
      setOperationError(undefined);
      setMoveRecord(record);
      setMoveSourceIds(undefined);
      setMoveRecordsSnapshot(data.records);
    },
    [data.records, rememberOperationFocus],
  );

  const startMoveSelection = useCallback(
    (ids: readonly string[]) => {
      rememberOperationFocus();
      setOpenError(undefined);
      setOperationError(undefined);
      setMoveRecord(undefined);
      setMoveSourceIds([...ids]);
      setMoveRecordsSnapshot(data.records);
    },
    [data.records, rememberOperationFocus],
  );

  const previewCreateOrEdit = useCallback(
    (input: { title: string; url?: string }) => {
      if (!editorState) {
        return;
      }
      if (data.isImporting) {
        setOperationError('浏览器正在导入书签，请等待导入完成后再操作');
        return;
      }
      try {
        let plan: BookmarkOperationPlan;
        const records = editorState.records;
        if (editorState.mode === 'create-bookmark') {
          plan = operationService.planCreateBookmark(records, {
            parentId: editorState.parentId,
            title: input.title,
            url: input.url ?? '',
          });
        } else if (editorState.mode === 'create-folder') {
          plan = operationService.planCreateFolder(records, {
            parentId: editorState.parentId,
            title: input.title,
          });
        } else {
          const changes: { title?: string; url?: string } = {};
          if (input.title !== editorState.record.title) {
            changes.title = input.title;
          }
          if (
            !editorState.record.isFolder &&
            (input.url ?? '') !== (editorState.record.url ?? '')
          ) {
            changes.url = input.url ?? '';
          }
          plan = operationService.planUpdate(
            records,
            editorState.record.id,
            changes,
          );
        }
        setEditorState(undefined);
        setConfirmPlan(plan);
        setOperationError(undefined);
      } catch (error) {
        setOperationError(error instanceof Error ? error.message : String(error));
      }
    },
    [data.isImporting, editorState, operationService],
  );

  const previewMove = useCallback(
    (targetFolderId: string) => {
      if (data.isImporting) {
        setOperationError('浏览器正在导入书签，请等待导入完成后再操作');
        return;
      }
      const ids = moveSourceIds ?? (moveRecord ? [moveRecord.id] : undefined);
      if (!ids || ids.length === 0) {
        return;
      }
      try {
        const records = moveRecordsSnapshot ?? data.records;
        const plan = operationService.planMove(records, ids, {
          parentId: targetFolderId,
        });
        setMoveRecord(undefined);
        setMoveSourceIds(undefined);
        setMoveRecordsSnapshot(undefined);
        setConfirmPlan(plan);
        setOperationError(undefined);
      } catch (error) {
        setOperationError(error instanceof Error ? error.message : String(error));
      }
    },
    [
      data.isImporting,
      data.records,
      moveRecord,
      moveRecordsSnapshot,
      moveSourceIds,
      operationService,
    ],
  );

  const previewDelete = useCallback(
    (record: BookmarkRecord) => {
      if (data.isImporting) {
        setOperationError('浏览器正在导入书签，请等待导入完成后再操作');
        return;
      }
      try {
        rememberOperationFocus();
        setConfirmPlan(operationService.planDelete(data.records, [record.id]));
        setOperationError(undefined);
      } catch (error) {
        setOperationError(error instanceof Error ? error.message : String(error));
      }
    },
    [data.records, operationService, rememberOperationFocus],
  );

  const previewFolderReorder = useCallback(
    (sourceId: string, anchorId: string, position: FolderDropPosition) => {
      if (data.isImporting) {
        setOperationError('浏览器正在导入书签，请等待导入完成后再操作');
        return;
      }
      const source = model.recordById.get(sourceId);
      if (!source?.parentId) {
        return;
      }
      const destination = calculateFolderMove(
        model.childrenByParentId.get(source.parentId) ?? [],
        sourceId,
        anchorId,
        position,
      );
      if (!destination) {
        setOperationError('只能在同一层级调整文件夹顺序');
        return;
      }
      try {
        rememberOperationFocus();
        setConfirmPlan(
          operationService.planReorder(data.records, sourceId, destination),
        );
        setOperationError(undefined);
      } catch (error) {
        setOperationError(error instanceof Error ? error.message : String(error));
      }
    },
    [
      data.isImporting,
      data.records,
      model,
      operationService,
      rememberOperationFocus,
    ],
  );

  const executeConfirmedPlan = useCallback(async () => {
    if (!confirmPlan) {
      return;
    }
    if (data.isImporting) {
      setOperationError('浏览器正在导入书签，请等待导入完成后再操作');
      return;
    }
    setIsExecutingOperation(true);
    setOperationError(undefined);
    try {
      const execution = await operationService.execute(confirmPlan);
      setConfirmPlan(undefined);
      setOperationResult(execution);
      const succeededIds = new Set(
        execution.results
          .filter((result) => result.status === 'success')
          .map((result) => result.id),
      );
      setSelectedIds((current) => {
        const next = new Set(
          [...current].filter((id) => !succeededIds.has(id)),
        );
        return next;
      });
      await data.refresh();
      restoreOperationFocus();
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsExecutingOperation(false);
    }
  }, [confirmPlan, data, operationService, restoreOperationFocus]);

  const writableMoveTargets = useMemo(() => {
    const operationModel = moveModel;
    const ids = moveSourceIds ?? (moveRecord ? [moveRecord.id] : undefined);
    if (!ids || ids.length === 0) {
      return [];
    }
    const blockedIds = new Set<string>();
    const sourceParentIds = new Set<string>();
    for (const id of ids) {
      const source = operationModel.recordById.get(id);
      if (source?.parentId) {
        sourceParentIds.add(source.parentId);
      }
      if (source?.isFolder) {
        blockedIds.add(source.id);
        for (const descendantId of operationModel.getDescendantIds(source.id)) {
          blockedIds.add(descendantId);
        }
      }
    }
    const onlySourceParentId =
      sourceParentIds.size === 1 ? [...sourceParentIds][0] : undefined;
    return operationModel.searchableRecords.filter(
      (record) =>
        record.isFolder &&
        !record.isRoot &&
        !record.isUnmodifiable &&
        !blockedIds.has(record.id) &&
        record.id !== onlySourceParentId,
    );
  }, [moveModel, moveRecord, moveSourceIds]);

  const preferredMoveTargetId = useMemo(() => {
    const ids = moveSourceIds ?? (moveRecord ? [moveRecord.id] : undefined);
    if (!ids || ids.length === 0) {
      return undefined;
    }
    const sourceParentIds = new Set(
      ids
        .map((id) => moveModel.recordById.get(id)?.parentId)
        .filter((id): id is string => id !== undefined),
    );
    return (
      writableMoveTargets.find((folder) => !sourceParentIds.has(folder.id))?.id ??
      writableMoveTargets[0]?.id
    );
  }, [moveModel, moveRecord, moveSourceIds, writableMoveTargets]);

  const toggleSelection = useCallback(
    (record: BookmarkRecord, selected: boolean) => {
      setSelectedIds((current) => {
        const next = new Set(current);
        if (selected) {
          next.add(record.id);
        } else {
          next.delete(record.id);
        }
        return next;
      });
    },
    [],
  );

  const previewBatchDelete = useCallback(() => {
    if (data.isImporting) {
      setOperationError('浏览器正在导入书签，请等待导入完成后再操作');
      return;
    }
    try {
      rememberOperationFocus();
      setConfirmPlan(
        operationService.planDelete(data.records, [...selectedIds]),
      );
      setOperationError(undefined);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    }
  }, [
    data.isImporting,
    data.records,
    operationService,
    rememberOperationFocus,
    selectedIds,
  ]);

  const bookmarkCount = model.searchableRecords.filter(
    (record) => !record.isFolder,
  ).length;
  const folderCount = model.searchableRecords.length - bookmarkCount;
  const hasOperationDialog = Boolean(
    editorState || moveRecord || moveSourceIds || confirmPlan,
  );

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
        onThemeChange={(theme) => void managerSettings.update({ theme })}
        settings={managerSettings.settings}
        settingsError={managerSettings.error}
        settingsStatus={managerSettings.status}
      />
    );
  } else if (view === 'organize') {
    if (organizeAnalysis.status === 'ready') {
      content = (
        <OrganizeView
          activeTab={organizeTab}
          analysis={organizeAnalysis.analysis}
          onDelete={previewDelete}
          onEdit={(record) => openEditor('edit', record)}
          onLocateBookmark={locate}
          onLocateFolder={locateFolder}
          onMove={startMove}
          onOpen={(record) => void handleOpen(record)}
          onTabChange={setOrganizeTab}
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
        isPending={normalizedQuery !== deferredNormalizedQuery}
        onDelete={previewDelete}
        onEdit={(record) => openEditor('edit', record)}
        onEnterFolder={enterSearchFolder}
        onLocate={locate}
        onMove={startMove}
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
        onCreateBookmark={(parentId) =>
          openEditor('create-bookmark', parentId)
        }
        onCreateFolder={(parentId) =>
          openEditor('create-folder', parentId)
        }
        onEdit={(record) => openEditor('edit', record)}
        onNavigate={navigate}
        onMove={startMove}
        onOpen={(record) => void handleOpen(record)}
        onDelete={previewDelete}
        onDeleteSelection={previewBatchDelete}
        onMoveSelection={() => startMoveSelection([...selectedIds])}
        onSelectionChange={toggleSelection}
        selectedIds={selectedIds}
      />
    );
  }

  return (
    <div className="manager-app" data-theme={managerSettings.settings.theme ?? 'system'}>
      <header
        aria-hidden={hasOperationDialog ? true : undefined}
        className="app-header"
        inert={hasOperationDialog ? true : undefined}
      >
        <div className="app-brand">
          <span aria-hidden="true" className="app-brand__mark">
            <BookmarkCheck size={20} strokeWidth={2.2} />
          </span>
          <span className="app-brand__text">
            <span>书签工作台</span>
            {version && <small>v{version}</small>}
          </span>
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
                clearLocationReturn();
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
              onClick={() => {
                clearLocationReturn();
                setScopeMode('all');
              }}
              type="button"
            >
              全部书签
            </button>
            <button
              aria-pressed={scopeMode === 'folder'}
              disabled={!resolvedFolderId}
              onClick={() => {
                clearLocationReturn();
                setScopeMode('folder');
              }}
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
      <div
        aria-hidden={hasOperationDialog ? true : undefined}
        className="app-body"
        inert={hasOperationDialog ? true : undefined}
      >
        <FolderTree
          activeFolderId={resolvedFolderId}
          expandedFolderIds={expandedFolderIds}
          model={model}
          onSelect={(folderId) => {
            navigate(folderId);
            setView('browse');
          }}
          onReorder={previewFolderReorder}
          onInvalidDrop={() => setOperationError('只能在同一层级调整文件夹顺序')}
          onEdit={(record) => openEditor('edit', record)}
          onMove={startMove}
          onDelete={previewDelete}
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
          onViewChange={changeView}
          showFolderCounts={managerSettings.settings.showFolderCounts}
          view={view}
        />
        <main className="app-main" ref={mainRef} tabIndex={-1}>
          {data.isImporting && (
            <div className="inline-warning" role="status">
              浏览器正在导入书签，写操作已暂停；导入完成后会自动刷新。
            </div>
          )}
          {data.status === 'error' && data.records.length > 0 && (
            <div className="inline-error" role="alert">
              {data.error || '刷新书签失败'}
              <button onClick={() => void data.refresh()} type="button">重试</button>
            </div>
          )}
          {openError && (
            <div className="inline-error" role="alert">
              <span>{openError}</span>
              <button onClick={() => setOpenError(undefined)} type="button">
                关闭
              </button>
            </div>
          )}
          {operationError && !hasOperationDialog && (
            <div className="inline-error" role="alert">
              <span>{operationError}</span>
              <button onClick={() => setOperationError(undefined)} type="button">
                关闭
              </button>
            </div>
          )}
          {locationStatus && (
            <div className="location-status" role="status">
              <span>{locationStatus}</span>
              {locationReturn && (
                <button
                  className="location-status__return"
                  onClick={returnFromLocation}
                  type="button"
                >
                  {locationReturn.kind === 'search' ? '返回搜索结果' : '返回整理结果'}
                </button>
              )}
            </div>
          )}
          {content}
        </main>
      </div>
      {editorState && (
        <BookmarkEditorDialog
          error={operationError}
          mode={editorState.mode}
          onCancel={clearOperationUi}
          onPreview={previewCreateOrEdit}
          record={editorState.mode === 'edit' ? editorState.record : undefined}
        />
      )}
      {(moveRecord || moveSourceIds) && (
        <MoveBookmarkDialog
          error={operationError}
          folders={writableMoveTargets}
          model={moveModel}
          preferredFolderId={preferredMoveTargetId}
          onCancel={clearOperationUi}
          onPreview={previewMove}
        />
      )}
      {confirmPlan && (
        <ConfirmOperationDialog
          disabled={isExecutingOperation || data.isImporting}
          error={operationError}
          onCancel={clearOperationUi}
          onConfirm={() => void executeConfirmedPlan()}
          plan={confirmPlan}
        />
      )}
      {operationResult && (
        <div
          aria-label="操作提示"
          className="operation-toast"
          role={operationResult.results.some((result) => result.status !== 'success') ? 'alert' : 'status'}
        >
          <div className="operation-toast__summary">
            {operationResultSummary(operationResult)}
          </div>
          {operationResult.results.some((result) => result.status !== 'success') && (
            <ul className="operation-toast__details">
              {operationResult.results
                .filter((result) => result.status !== 'success')
                .map((result) => (
                  <li key={result.id}>{result.id}：{result.message}</li>
                ))}
            </ul>
          )}
          <button
            aria-label="关闭操作提示"
            className="operation-toast__close"
            onClick={() => setOperationResult(undefined)}
            title="关闭操作提示"
            type="button"
          >
            <X aria-hidden="true" size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
