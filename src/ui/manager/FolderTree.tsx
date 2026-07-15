import {
  ChevronDown,
  ChevronRight,
  Folder,
  Library,
  ListFilter,
  Lock,
  Settings,
} from 'lucide-react';
import { useState } from 'react';

import type { BookmarkViewModel } from '../../app/bookmark-view-model';
import type { BookmarkRecord } from '../../domain/bookmarks';
import type { FolderDropPosition } from '../../domain/folder-reorder';
import { useItemContextMenu } from './useItemContextMenu';

export type ManagerView = 'browse' | 'organize' | 'settings';

interface FolderTreeProps {
  readonly model: BookmarkViewModel;
  readonly view: ManagerView;
  readonly activeFolderId?: string;
  readonly expandedFolderIds: ReadonlySet<string>;
  readonly showFolderCounts: boolean;
  readonly onSelect: (folderId: string) => void;
  readonly onToggle: (folderId: string) => void;
  readonly onViewChange: (view: ManagerView) => void;
  readonly onEdit?: (record: BookmarkRecord) => void;
  readonly onMove?: (record: BookmarkRecord) => void;
  readonly onDelete?: (record: BookmarkRecord) => void;
  readonly onReorder?: (
    sourceId: string,
    anchorId: string,
    position: FolderDropPosition,
  ) => void;
}

type FolderTreeNodeProps = Pick<
  FolderTreeProps,
  | 'model'
  | 'activeFolderId'
  | 'expandedFolderIds'
  | 'showFolderCounts'
  | 'onSelect'
  | 'onToggle'
  | 'onReorder'
  | 'onEdit'
  | 'onMove'
  | 'onDelete'
> & {
  readonly folder: BookmarkRecord;
  readonly depth: number;
};

function FolderTreeNode({
  folder,
  depth,
  model,
  activeFolderId,
  expandedFolderIds,
  showFolderCounts,
  onSelect,
  onToggle,
  onReorder,
  onEdit,
  onMove,
  onDelete,
}: FolderTreeNodeProps) {
  const [dropPosition, setDropPosition] = useState<FolderDropPosition>();
  const childFolders = (model.childrenByParentId.get(folder.id) ?? []).filter(
    (record) => record.isFolder,
  );
  const isExpanded = expandedFolderIds.has(folder.id);
  const isActive = activeFolderId === folder.id;
  const label = folder.title || '未命名文件夹';
  const directBookmarkCount =
    model.directBookmarkCountByFolderId.get(folder.id) ?? 0;
  const totalBookmarkCount =
    model.totalBookmarkCountByFolderId.get(folder.id) ?? 0;
  const countLabel = `直属 ${directBookmarkCount}，合计 ${totalBookmarkCount}`;
  const canReorder =
    folder.folderType === 'unknown' &&
    !folder.isRoot &&
    !folder.isUnmodifiable &&
    folder.parentId !== undefined &&
    onReorder !== undefined;
  const canManage = folder.folderType === 'unknown' && !folder.isUnmodifiable;
  const context = useItemContextMenu(label, [
    { label: '打开', onSelect: () => onSelect(folder.id) },
    ...(canManage && onEdit ? [{ label: '编辑', onSelect: () => onEdit(folder) }] : []),
    ...(canManage && onMove ? [{ label: '移动', onSelect: () => onMove(folder) }] : []),
    ...(canManage && onDelete ? [{ label: '删除', onSelect: () => onDelete(folder), danger: true }] : []),
  ]);

  const startDrag = (event: React.DragEvent<HTMLElement>) => {
    if (!canReorder) { event.preventDefault(); return; }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-bookmark-folder', JSON.stringify({ sourceId: folder.id, parentId: folder.parentId }));
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!canReorder) {
      return;
    }
    event.preventDefault();
    setDropPosition(undefined);
    try {
      const payload = JSON.parse(
        event.dataTransfer.getData('application/x-bookmark-folder'),
      ) as { sourceId?: string; parentId?: string };
      if (payload.parentId === folder.parentId && payload.sourceId) {
        const bounds = event.currentTarget.getBoundingClientRect();
        const position: FolderDropPosition =
          bounds.height > 0 && event.clientY < bounds.top + bounds.height / 2
            ? 'before'
            : 'after';
        onReorder?.(payload.sourceId, folder.id, position);
      }
    } catch {
      // Ignore malformed drops from outside this sidebar.
    }
  };

  return (
    <li>
      <div
        className={`folder-tree__row${isActive ? ' folder-tree__row--active' : ''}${
          canReorder ? ' folder-tree__row--draggable' : ''
        }${dropPosition ? ` folder-tree__row--drop-${dropPosition}` : ''}`}
        draggable={canReorder}
        onContextMenu={context.onContextMenu}
        onDragLeave={() => setDropPosition(undefined)}
        onDragStart={startDrag}
        onDragOver={(event) => {
          if (canReorder) {
            event.preventDefault();
            const bounds = event.currentTarget.getBoundingClientRect();
            setDropPosition(bounds.height > 0 && event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after');
          }
        }}
        onDrop={handleDrop}
        style={{ '--tree-depth': depth } as React.CSSProperties}
        title={canReorder ? `拖动调整 ${label} 顺序` : undefined}
      >
        {childFolders.length > 0 ? (
          <button
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? '折叠' : '展开'} ${label}`}
            className="tree-toggle"
            onClick={() => onToggle(folder.id)}
            title={`${isExpanded ? '折叠' : '展开'} ${label}`}
            type="button"
          >
            {isExpanded ? (
              <ChevronDown aria-hidden="true" size={15} />
            ) : (
              <ChevronRight aria-hidden="true" size={15} />
            )}
          </button>
        ) : (
          <span className="tree-toggle-spacer" />
        )}
        <Folder aria-hidden="true" className="folder-tree__icon" size={17} />
        <button
          aria-current={isActive ? 'page' : undefined}
          className="folder-tree__label"
          draggable={canReorder}
          onDragStart={startDrag}
          onClick={() => onSelect(folder.id)}
          title={label}
          type="button"
        >
          {label}
        </button>
        {showFolderCounts && (
          <span
            aria-label={countLabel}
            className="folder-tree__count"
            title={countLabel}
          >
            <span className="folder-tree__count-direct">
              {directBookmarkCount}
            </span>
            <span aria-hidden="true" className="folder-tree__count-separator">
              {' / '}
            </span>
            <span className="folder-tree__count-total">
              {totalBookmarkCount}
            </span>
          </span>
        )}
        {folder.isUnmodifiable && (
          <span className="folder-tree__readonly" title={`${label} 只读`}>
            <Lock
              aria-label={`${label} 只读`}
              className="status-icon"
              role="img"
              size={14}
            />
          </span>
        )}
      </div>
      {context.contextMenu}
      {isExpanded && childFolders.length > 0 && (
        <ul>
          {childFolders.map((child) => (
            <FolderTreeNode
              activeFolderId={activeFolderId}
              depth={depth + 1}
              expandedFolderIds={expandedFolderIds}
              folder={child}
              key={child.id}
              model={model}
              onReorder={onReorder}
              onEdit={onEdit}
              onMove={onMove}
              onDelete={onDelete}
              onSelect={onSelect}
              onToggle={onToggle}
              showFolderCounts={showFolderCounts}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function FolderTree(props: FolderTreeProps) {
  return (
    <aside className="app-sidebar">
      <nav aria-label="主导航" className="sidebar-nav">
        <button
          aria-current={props.view === 'browse' ? 'page' : undefined}
          aria-label="浏览"
          className="sidebar-primary"
          onClick={() => props.onViewChange('browse')}
          type="button"
        >
          <Library aria-hidden="true" size={18} />
          <span>浏览</span>
        </button>
        <button
          aria-current={props.view === 'organize' ? 'page' : undefined}
          aria-label="整理"
          className="sidebar-primary"
          onClick={() => props.onViewChange('organize')}
          type="button"
        >
          <ListFilter aria-hidden="true" size={18} />
          <span>整理</span>
        </button>
        <button
          aria-current={props.view === 'settings' ? 'page' : undefined}
          aria-label="设置"
          className="sidebar-primary"
          onClick={() => props.onViewChange('settings')}
          type="button"
        >
          <Settings aria-hidden="true" size={18} />
          <span>设置</span>
        </button>
        <div className="sidebar-section-title">目录</div>
        {props.model.topLevelFolders.length > 0 ? (
          <ul aria-label="书签目录" className="folder-tree">
            {props.model.topLevelFolders.map((folder) => (
              <FolderTreeNode
                {...props}
                depth={0}
                folder={folder}
                key={folder.id}
              />
            ))}
          </ul>
        ) : (
          <p className="sidebar-empty">没有目录</p>
        )}
      </nav>
    </aside>
  );
}
