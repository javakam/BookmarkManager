import { ExternalLink, Folder, LocateFixed, MoveRight, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState, type KeyboardEvent } from 'react';

import type { OrganizeAnalysis } from '../../app/use-organize-analysis';
import { getBookmarkDisplayInfo } from '../../app/bookmark-view-model';
import type {
  DuplicateClassification,
  DuplicateConfidence,
  DuplicateEvidenceType,
  DuplicateGroup,
  DuplicateReason,
  MirrorFolderSuggestion,
} from '../../domain/duplicate-analyzer';
import type { BookmarkRecord } from '../../domain/bookmarks';
import type {
  SimilarityEvidenceType,
  SimilarityPair,
  TitleConflictGroup,
} from '../../domain/similarity-analyzer';
import { useItemContextMenu } from './useItemContextMenu';

type OrganizeTab = 'duplicates' | 'similar' | 'mirrors';
type SimilarityGroup = SimilarityPair | TitleConflictGroup;

const PAGE_SIZE = 50;
const MEMBER_PAGE_SIZE = 50;
const ORGANIZE_TABS = [
  ['duplicates', '重复项'],
  ['similar', '相似项'],
  ['mirrors', '镜像目录'],
] as const;

const CLASSIFICATION_LABELS: Readonly<Record<DuplicateClassification, string>> = {
  exact: '确定重复',
  'normalized-candidate': '规范化候选',
  'loose-candidate': '参数或片段差异',
};

const DUPLICATE_CONFIDENCE_LABELS: Readonly<Record<DuplicateConfidence, string>> = {
  certain: '确定',
  high: '高置信',
  possible: '需确认',
};

const DUPLICATE_REASON_LABELS: Readonly<Record<DuplicateReason, string>> = {
  'same-folder': '同一文件夹',
  'multi-location': '多处收藏',
  'conservative-normalization': '规范化后网址相同',
  'query-or-fragment-variation': '查询参数或片段不同',
};

const DUPLICATE_EVIDENCE_LABELS: Readonly<Record<DuplicateEvidenceType, string>> = {
  'exact-url': '完整网址相同',
  location: '收藏位置',
  'normalization-change': '网址规范化差异',
  'query-fragment-removed': '参数或片段差异',
};

const SIMILARITY_EVIDENCE_LABELS: Readonly<Record<SimilarityEvidenceType, string>> = {
  title: '标题相似',
  'host-path': '网址结构相似',
  'folder-context': '同目录',
  'title-conflict': '标题相同但网址不同',
};

const SIMILARITY_REASON_LABELS = {
  'title-conflict': '标题冲突',
  'title-similarity': '标题相似',
  'host-path-similarity': '网址结构相似',
  'metadata-similarity': '标题与网址结构相似',
} as const;

export interface OrganizeViewProps {
  readonly analysis: OrganizeAnalysis;
  readonly onOpen: (record: BookmarkRecord) => void;
  readonly onLocateBookmark: (record: BookmarkRecord) => void;
  readonly onLocateFolder: (folder: BookmarkRecord) => void;
  readonly onEdit?: (record: BookmarkRecord) => void;
  readonly onMove?: (record: BookmarkRecord) => void;
  readonly onDelete?: (record: BookmarkRecord) => void;
  readonly onMoveSelection?: (records: readonly BookmarkRecord[]) => void;
  readonly onDeleteSelection?: (records: readonly BookmarkRecord[]) => void;
}

function recordPath(record: BookmarkRecord): string {
  return record.path.filter((segment) => segment.trim()).join(' / ') || '根目录';
}

function uniqueLabels<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function MemberRow({
  record,
  onOpen,
  onLocate,
  selected,
  onSelectionChange,
  onEdit,
  onMove,
  onDelete,
}: {
  readonly record: BookmarkRecord;
  readonly onOpen: (record: BookmarkRecord) => void;
  readonly onLocate: (record: BookmarkRecord) => void;
  readonly selected?: boolean;
  readonly onSelectionChange?: (record: BookmarkRecord, selected: boolean) => void;
  readonly onEdit?: (record: BookmarkRecord) => void;
  readonly onMove?: (record: BookmarkRecord) => void;
  readonly onDelete?: (record: BookmarkRecord) => void;
}) {
  const display = getBookmarkDisplayInfo(record);
  const path = recordPath(record);
  const context = useItemContextMenu(display.displayTitle, [
    { label: '打开', onSelect: () => onOpen(record) },
    { label: '定位', onSelect: () => onLocate(record) },
    ...(onEdit ? [{ label: '编辑', onSelect: () => onEdit(record) }] : []),
    ...(onMove ? [{ label: '移动', onSelect: () => onMove(record) }] : []),
    ...(onDelete ? [{ label: '删除', onSelect: () => onDelete(record), danger: true }] : []),
  ]);
  return (
    <li
      className={`organize-member-row${
        onSelectionChange ? ' organize-member-row--selectable' : ''
      }`}
      onContextMenu={context.onContextMenu}
    >
      {onSelectionChange && (
        <input
          aria-label={`选择 ${display.displayTitle}`}
          checked={selected}
          className="organize-member-select"
          onChange={(event) => onSelectionChange(record, event.target.checked)}
          type="checkbox"
        />
      )}
      <span className="organize-member-icon" aria-hidden="true">
        <ExternalLink size={16} />
      </span>
      <span className="organize-member-title" title={display.displayTitle}>
        {display.displayTitle}
        {display.isIconOnly && <span className="bookmark-row__tag">仅图标显示</span>}
      </span>
      <span className="organize-member-path" title={path}>{path}</span>
      <span className="organize-member-url" title={record.url}>{record.url}</span>
      <span className="organize-member-actions">
        <button
          aria-label={`打开 ${display.displayTitle}`}
          className="icon-button"
          onClick={() => onOpen(record)}
          title={`打开 ${display.displayTitle}`}
          type="button"
        >
          <ExternalLink aria-hidden="true" size={17} />
        </button>
        {onEdit && <button aria-label={`编辑 ${display.displayTitle}`} className="icon-button" onClick={() => onEdit(record)} title={`编辑 ${display.displayTitle}`} type="button"><Pencil aria-hidden="true" size={16} /></button>}
        {onMove && <button aria-label={`移动 ${display.displayTitle}`} className="icon-button" onClick={() => onMove(record)} title={`移动 ${display.displayTitle}`} type="button"><MoveRight aria-hidden="true" size={16} /></button>}
        {onDelete && <button aria-label={`删除 ${display.displayTitle}`} className="icon-button" onClick={() => onDelete(record)} title={`删除 ${display.displayTitle}`} type="button"><Trash2 aria-hidden="true" size={16} /></button>}
        <button
          aria-label={`定位 ${display.displayTitle}`}
          className="icon-button"
          onClick={() => onLocate(record)}
          title={`定位 ${display.displayTitle}`}
          type="button"
        >
          <LocateFixed aria-hidden="true" size={17} />
        </button>
      </span>
      {context.contextMenu}
    </li>
  );
}

function GroupHeader({ labels }: { readonly labels: readonly string[] }) {
  return (
    <div className="organize-group-header">
      {labels.map((label, index) => (
        <span className={index === 0 ? 'organize-group-primary' : 'organize-group-meta'} key={`${index}-${label}`}>
          {label}
        </span>
      ))}
    </div>
  );
}

function ShowMoreMembers({ onClick }: { readonly onClick: () => void }) {
  return (
    <div className="organize-member-more">
      <button
        className="command-button command-button--secondary"
        onClick={onClick}
        type="button"
      >
        显示更多成员
      </button>
    </div>
  );
}

function BookmarkMemberList({
  members,
  onOpen,
  onLocate,
  selectedIds,
  onSelectionChange,
  onEdit,
  onMove,
  onDelete,
}: {
  readonly members: readonly BookmarkRecord[];
  readonly onOpen: (record: BookmarkRecord) => void;
  readonly onLocate: (record: BookmarkRecord) => void;
  readonly selectedIds?: ReadonlySet<string>;
  readonly onSelectionChange?: (record: BookmarkRecord, selected: boolean) => void;
  readonly onEdit?: (record: BookmarkRecord) => void;
  readonly onMove?: (record: BookmarkRecord) => void;
  readonly onDelete?: (record: BookmarkRecord) => void;
}) {
  const [limit, setLimit] = useState(MEMBER_PAGE_SIZE);
  return (
    <>
      <ul className="organize-member-list">
        {members.slice(0, limit).map((record) => (
          <MemberRow
            key={record.id}
            onLocate={onLocate}
            onOpen={onOpen}
            onSelectionChange={onSelectionChange}
            onEdit={onEdit}
            onMove={onMove}
            onDelete={onDelete}
            record={record}
            selected={selectedIds?.has(record.id)}
          />
        ))}
      </ul>
      {limit < members.length && (
        <ShowMoreMembers onClick={() => setLimit((current) => current + MEMBER_PAGE_SIZE)} />
      )}
    </>
  );
}

function DuplicateResult({
  group,
  onOpen,
  onLocate,
  selectedIds,
  onSelectionChange,
  onMoveSelection,
  onDeleteSelection,
  onEdit,
  onMove,
  onDelete,
}: {
  readonly group: DuplicateGroup;
  readonly onOpen: (record: BookmarkRecord) => void;
  readonly onLocate: (record: BookmarkRecord) => void;
  readonly selectedIds: ReadonlySet<string>;
  readonly onSelectionChange: (record: BookmarkRecord, selected: boolean) => void;
  readonly onMoveSelection?: (records: readonly BookmarkRecord[]) => void;
  readonly onDeleteSelection?: (records: readonly BookmarkRecord[]) => void;
  readonly onEdit?: (record: BookmarkRecord) => void;
  readonly onMove?: (record: BookmarkRecord) => void;
  readonly onDelete?: (record: BookmarkRecord) => void;
}) {
  const evidence = uniqueLabels(
    group.evidence.map(({ type }) => DUPLICATE_EVIDENCE_LABELS[type]),
  );
  return (
    <li className="organize-group">
      <div className="organize-group-toolbar">
        <GroupHeader labels={[
          CLASSIFICATION_LABELS[group.classification],
          DUPLICATE_CONFIDENCE_LABELS[group.confidence],
          DUPLICATE_REASON_LABELS[group.reason],
          ...evidence,
        ]} />
      </div>
      <BookmarkMemberList
        members={group.members}
        onLocate={onLocate}
        onOpen={onOpen}
        onEdit={onEdit}
        onMove={onMove}
        onDelete={onDelete}
      />
    </li>
  );
}

function SimilarityResult({
  group,
  onOpen,
  onLocate,
  onEdit,
  onMove,
  onDelete,
}: {
  readonly group: SimilarityGroup;
  readonly onOpen: (record: BookmarkRecord) => void;
  readonly onLocate: (record: BookmarkRecord) => void;
  readonly onEdit?: (record: BookmarkRecord) => void;
  readonly onMove?: (record: BookmarkRecord) => void;
  readonly onDelete?: (record: BookmarkRecord) => void;
}) {
  const evidence = uniqueLabels(
    group.evidence.map(({ type }) => SIMILARITY_EVIDENCE_LABELS[type]),
  );
  return (
    <li className="organize-group">
      <GroupHeader labels={uniqueLabels([
        SIMILARITY_REASON_LABELS[group.reason],
        group.confidence === 'high' ? '高相似' : '可能相关',
        ...evidence,
      ])} />
      <BookmarkMemberList members={group.members} onDelete={onDelete} onEdit={onEdit} onLocate={onLocate} onMove={onMove} onOpen={onOpen} />
    </li>
  );
}

function MirrorResult({
  suggestion,
  onLocate,
}: {
  readonly suggestion: MirrorFolderSuggestion;
  readonly onLocate: (folder: BookmarkRecord) => void;
}) {
  const metrics = suggestion.evidence[0];
  const sharedCount = metrics?.sharedCount ?? suggestion.shared.length;
  const unionCount = metrics?.unionCount ?? sharedCount;
  const overlap = Math.round((metrics?.jaccard ?? 0) * 100);
  return (
    <li className="organize-group">
      <GroupHeader labels={[
        '镜像目录候选',
        `共享 ${sharedCount} 项`,
        `总计 ${unionCount} 项`,
        `重合度 ${overlap}%`,
      ]} />
      <MirrorMemberList folders={suggestion.folders} onLocate={onLocate} />
    </li>
  );
}

function MirrorMemberList({
  folders,
  onLocate,
}: {
  readonly folders: readonly BookmarkRecord[];
  readonly onLocate: (folder: BookmarkRecord) => void;
}) {
  const [limit, setLimit] = useState(MEMBER_PAGE_SIZE);
  return (
    <>
      <ul className="organize-member-list">
        {folders.slice(0, limit).map((folder) => {
          const display = getBookmarkDisplayInfo(folder);
          const path = recordPath(folder);
          return (
            <li className="organize-folder-row" key={folder.id}>
              <Folder aria-hidden="true" className="item-icon item-icon--folder" size={18} />
              <span className="organize-member-title" title={display.displayTitle}>{display.displayTitle}</span>
              <span className="organize-member-path" title={path}>{path}</span>
              <span className="organize-folder-actions">
                <button
                  aria-label={`定位 ${display.displayTitle}`}
                  className="icon-button"
                  onClick={() => onLocate(folder)}
                  title={`定位 ${display.displayTitle}`}
                  type="button"
                >
                  <LocateFixed aria-hidden="true" size={17} />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      {limit < folders.length && (
        <ShowMoreMembers onClick={() => setLimit((current) => current + MEMBER_PAGE_SIZE)} />
      )}
    </>
  );
}

function LoadMore({ onClick }: { readonly onClick: () => void }) {
  return (
    <div className="organize-load-more">
      <button className="command-button command-button--secondary" onClick={onClick} type="button">
        加载更多
      </button>
    </div>
  );
}

export function OrganizeView({
  analysis,
  onOpen,
  onLocateBookmark,
  onLocateFolder,
  onMoveSelection,
  onDeleteSelection,
  onEdit,
  onMove,
  onDelete,
}: OrganizeViewProps) {
  const [activeTab, setActiveTab] = useState<OrganizeTab>('duplicates');
  const [limits, setLimits] = useState<Record<OrganizeTab, number>>({
    duplicates: PAGE_SIZE,
    similar: PAGE_SIZE,
    mirrors: PAGE_SIZE,
  });
  const [selectedDuplicateIds, setSelectedDuplicateIds] = useState<Set<string>>(
    () => new Set(),
  );
  useEffect(() => {
    setSelectedDuplicateIds(new Set());
  }, [analysis]);
  const changeDuplicateSelection = (record: BookmarkRecord, selected: boolean) => {
    setSelectedDuplicateIds((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(record.id);
      } else {
        next.delete(record.id);
      }
      return next;
    });
  };
  const similarGroups: SimilarityGroup[] = [
    ...analysis.similar.titleConflictGroups,
    ...analysis.similar.pairs,
  ];
  const counts: Record<OrganizeTab, number> = {
    duplicates: analysis.duplicates.groups.length,
    similar: similarGroups.length,
    mirrors: analysis.mirrorFolders.suggestions.length,
  };

  const selectTab = (tab: OrganizeTab) => {
    setActiveTab(tab);
    setLimits((current) => ({ ...current, [tab]: PAGE_SIZE }));
  };
  const loadMore = (tab: OrganizeTab) => {
    setLimits((current) => ({ ...current, [tab]: current[tab] + PAGE_SIZE }));
  };
  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    tab: OrganizeTab,
  ) => {
    const currentIndex = ORGANIZE_TABS.findIndex(([candidate]) => candidate === tab);
    let targetIndex: number | undefined;
    if (event.key === 'ArrowRight') {
      targetIndex = (currentIndex + 1) % ORGANIZE_TABS.length;
    } else if (event.key === 'ArrowLeft') {
      targetIndex = (currentIndex - 1 + ORGANIZE_TABS.length) % ORGANIZE_TABS.length;
    } else if (event.key === 'Home') {
      targetIndex = 0;
    } else if (event.key === 'End') {
      targetIndex = ORGANIZE_TABS.length - 1;
    }
    if (targetIndex === undefined) {
      return;
    }
    event.preventDefault();
    const targetTab = ORGANIZE_TABS[targetIndex][0];
    selectTab(targetTab);
    document.getElementById(`organize-tab-${targetTab}`)?.focus();
  };

  return (
    <section aria-label="整理" className="organize-view">
      <div className="organize-tabs-bar">
        <div aria-label="整理分类" className="organize-tabs" role="tablist">
          {ORGANIZE_TABS.map(([tab, label]) => (
            <button
              aria-controls={`organize-panel-${tab}`}
              aria-selected={activeTab === tab}
              id={`organize-tab-${tab}`}
              key={tab}
              onClick={() => selectTab(tab)}
              onKeyDown={(event) => handleTabKeyDown(event, tab)}
              role="tab"
              tabIndex={activeTab === tab ? 0 : -1}
              type="button"
            >
              <span>{label}</span>
              <span className="organize-tab-count">{counts[tab]}</span>
            </button>
          ))}
        </div>
        <span className="organize-readonly">仅供检查，不会修改书签</span>
      </div>

      {activeTab === 'duplicates' && (
        <div aria-labelledby="organize-tab-duplicates" id="organize-panel-duplicates" role="tabpanel">
          {analysis.duplicates.groups.length === 0 ? (
            <div className="content-state">没有发现重复项</div>
          ) : (
            <>
              <ul className="organize-group-list">
                {analysis.duplicates.groups.slice(0, limits.duplicates).map((group) => (
                  <DuplicateResult
                    group={group}
                    key={group.id}
                    onLocate={onLocateBookmark}
                    onMoveSelection={onMoveSelection}
                    onOpen={onOpen}
                    onDeleteSelection={onDeleteSelection}
                    onEdit={onEdit}
                    onMove={onMove}
                    onDelete={onDelete}
                    onSelectionChange={changeDuplicateSelection}
                    selectedIds={selectedDuplicateIds}
                  />
                ))}
              </ul>
              {limits.duplicates < analysis.duplicates.groups.length && (
                <LoadMore onClick={() => loadMore('duplicates')} />
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'similar' && (
        <div aria-labelledby="organize-tab-similar" id="organize-panel-similar" role="tabpanel">
          {analysis.similar.truncated && (
            <div className="organize-truncated" role="status">结果较多，仅显示最相关项目</div>
          )}
          {similarGroups.length === 0 ? (
            <div className="content-state">没有发现相似项</div>
          ) : (
            <>
              <ul className="organize-group-list">
                {similarGroups.slice(0, limits.similar).map((group) => (
                    <SimilarityResult group={group} key={group.id} onDelete={onDelete} onEdit={onEdit} onLocate={onLocateBookmark} onMove={onMove} onOpen={onOpen} />
                ))}
              </ul>
              {limits.similar < similarGroups.length && <LoadMore onClick={() => loadMore('similar')} />}
            </>
          )}
        </div>
      )}

      {activeTab === 'mirrors' && (
        <div aria-labelledby="organize-tab-mirrors" id="organize-panel-mirrors" role="tabpanel">
          {analysis.mirrorFolders.truncated && (
            <div className="organize-truncated" role="status">结果较多，仅显示最相关项目</div>
          )}
          {analysis.mirrorFolders.suggestions.length === 0 ? (
            <div className="content-state">没有发现镜像目录</div>
          ) : (
            <>
              <ul className="organize-group-list">
                {analysis.mirrorFolders.suggestions.slice(0, limits.mirrors).map((suggestion) => (
                  <MirrorResult key={suggestion.id} onLocate={onLocateFolder} suggestion={suggestion} />
                ))}
              </ul>
              {limits.mirrors < analysis.mirrorFolders.suggestions.length && (
                <LoadMore onClick={() => loadMore('mirrors')} />
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
