import {
  ChevronDown,
  ChevronRight,
  Folder,
  Library,
  ListFilter,
  Lock,
  Settings,
} from 'lucide-react';

import type { BookmarkViewModel } from '../../app/bookmark-view-model';
import type { BookmarkRecord } from '../../domain/bookmarks';

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
}

type FolderTreeNodeProps = Pick<
  FolderTreeProps,
  | 'model'
  | 'activeFolderId'
  | 'expandedFolderIds'
  | 'showFolderCounts'
  | 'onSelect'
  | 'onToggle'
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
}: FolderTreeNodeProps) {
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

  return (
    <li>
      <div
        className={`folder-tree__row${isActive ? ' folder-tree__row--active' : ''}`}
        style={{ '--tree-depth': depth } as React.CSSProperties}
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
        {props.view === 'browse' && (
          <>
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
          </>
        )}
      </nav>
    </aside>
  );
}
