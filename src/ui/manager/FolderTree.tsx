import {
  ChevronDown,
  ChevronRight,
  Folder,
  Library,
  ListFilter,
  Lock,
} from 'lucide-react';

import type { BookmarkViewModel } from '../../app/bookmark-view-model';
import type { BookmarkRecord } from '../../domain/bookmarks';

export type ManagerView = 'browse' | 'organize';

interface FolderTreeProps {
  readonly model: BookmarkViewModel;
  readonly view: ManagerView;
  readonly activeFolderId?: string;
  readonly expandedFolderIds: ReadonlySet<string>;
  readonly onSelect: (folderId: string) => void;
  readonly onToggle: (folderId: string) => void;
  readonly onViewChange: (view: ManagerView) => void;
}

type FolderTreeNodeProps = Pick<
  FolderTreeProps,
  'model' | 'activeFolderId' | 'expandedFolderIds' | 'onSelect' | 'onToggle'
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
  onSelect,
  onToggle,
}: FolderTreeNodeProps) {
  const childFolders = (model.childrenByParentId.get(folder.id) ?? []).filter(
    (record) => record.isFolder,
  );
  const isExpanded = expandedFolderIds.has(folder.id);
  const isActive = activeFolderId === folder.id;
  const label = folder.title || '未命名文件夹';

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
