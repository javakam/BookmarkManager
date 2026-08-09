import { ChevronRight, FolderPlus, Lock, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  getBookmarkDisplayInfo,
  type BookmarkViewModel,
} from '../../app/bookmark-view-model';
import type { BookmarkRecord } from '../../domain/bookmarks';
import { validateWritableRecord } from '../../domain/bookmark-operations';
import { BookmarkRow } from './BookmarkRow';
import { useItemContextMenu } from './useItemContextMenu';

const PAGE_SIZE = 100;

interface BrowseViewProps {
  readonly model: BookmarkViewModel;
  readonly activeFolderId: string;
  readonly highlightedId?: string;
  readonly selectedIds?: ReadonlySet<string>;
  readonly onCreateBookmark?: (parentId: string) => void;
  readonly onCreateFolder?: (parentId: string) => void;
  readonly onEdit?: (record: BookmarkRecord) => void;
  readonly onNavigate: (folderId: string) => void;
  readonly onMove?: (record: BookmarkRecord) => void;
  readonly onMoveSelection?: () => void;
  readonly onOpen: (record: BookmarkRecord) => void;
  readonly onDelete?: (record: BookmarkRecord) => void;
  readonly onDeleteSelection?: () => void;
  readonly onSelectionChange?: (record: BookmarkRecord, selected: boolean) => void;
}

export function BrowseView({
  model,
  activeFolderId,
  highlightedId,
  selectedIds,
  onCreateBookmark,
  onCreateFolder,
  onEdit,
  onNavigate,
  onMove,
  onMoveSelection,
  onOpen,
  onDelete,
  onDeleteSelection,
  onSelectionChange,
}: BrowseViewProps) {
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
  const [contextRecord, setContextRecord] = useState<BookmarkRecord>();

  const activeFolder = model.recordById.get(activeFolderId);
  const children = activeFolder
    ? (model.childrenByParentId.get(activeFolderId) ?? [])
    : [];

  useEffect(() => {
    setVisibleLimit(PAGE_SIZE);
  }, [activeFolderId]);

  useEffect(() => {
    if (!highlightedId) {
      return;
    }
    const highlightedIndex = children.findIndex(
      (record) => record.id === highlightedId,
    );
    if (highlightedIndex < 0) {
      return;
    }
    const requiredLimit =
      Math.ceil((highlightedIndex + 1) / PAGE_SIZE) * PAGE_SIZE;
    setVisibleLimit((current) => Math.max(current, requiredLimit));
  }, [children, highlightedId]);

  if (!activeFolder) {
    return <div className="content-state">没有可浏览的书签目录</div>;
  }

  const folderName = getBookmarkDisplayInfo(activeFolder).displayTitle;
  const breadcrumbs = model.getBreadcrumbs(activeFolderId);
  const visibleChildren = children.slice(0, visibleLimit);
  const selectableChildren = children.filter(
    (record) => validateWritableRecord(record).valid,
  );
  const selectedCount = selectableChildren.filter((record) =>
    selectedIds?.has(record.id),
  ).length;
  const canWriteInFolder = !activeFolder.isRoot && !activeFolder.isUnmodifiable;
  const contextDisplay = contextRecord ? getBookmarkDisplayInfo(contextRecord) : undefined;
  const context = useItemContextMenu(contextDisplay?.displayTitle ?? '', contextRecord ? [
    ...(!contextRecord.isFolder && contextRecord.url ? [{ label: '打开', onSelect: () => onOpen(contextRecord) }] : []),
    ...(contextRecord.isFolder ? [{ label: '打开文件夹', onSelect: () => onNavigate(contextRecord.id) }] : []),
    ...(!contextRecord.isUnmodifiable && onEdit ? [{ label: '编辑', onSelect: () => onEdit(contextRecord) }] : []),
    ...(!contextRecord.isUnmodifiable && onMove ? [{ label: '移动', onSelect: () => onMove(contextRecord) }] : []),
    ...(!contextRecord.isUnmodifiable && onDelete ? [{ label: '删除', onSelect: () => onDelete(contextRecord), danger: true }] : []),
  ] : []);

  return (
    <section aria-labelledby="browse-heading" className="browse-view">
      <nav aria-label="当前路径" className="breadcrumbs">
        <ol>
          {breadcrumbs.map((folder, index) => {
            const label = getBookmarkDisplayInfo(folder).displayTitle;
            return (
              <li key={folder.id}>
                {index > 0 && <ChevronRight aria-hidden="true" size={14} />}
                <button
                  aria-current={folder.id === activeFolderId ? 'page' : undefined}
                  aria-label={`返回 ${label}`}
                  onClick={() => onNavigate(folder.id)}
                  title={label}
                  type="button"
                >
                  {label}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      <div className="content-heading">
        <div>
          <h1 id="browse-heading">{folderName}</h1>
          {activeFolder.isUnmodifiable && (
            <span
              className="content-heading__readonly"
              title={`${folderName} 只读`}
            >
              <Lock
                aria-label={`${folderName} 只读`}
                className="status-icon"
                role="img"
                size={16}
              />
            </span>
          )}
          <span>{children.length} 项</span>
        </div>
        {canWriteInFolder && (
          <div className="content-heading__actions">
            <div className="folder-batch-group">
              <span>批量操作</span>
              <div aria-label="文件夹批量操作" className="folder-batch-tools" role="toolbar">
                <button className="folder-batch-tools__danger" disabled={selectedCount === 0} onClick={onDeleteSelection} type="button">删除所选</button>
                <button disabled={selectedCount === 0} onClick={onMoveSelection} type="button">移动所选</button>
              </div>
            </div>
            <div className="content-create-tools">
              <button className="command-button" onClick={() => onCreateBookmark?.(activeFolderId)} type="button">
                <Plus aria-hidden="true" size={15} />新建书签
              </button>
              <button className="command-button" onClick={() => onCreateFolder?.(activeFolderId)} type="button">
                <FolderPlus aria-hidden="true" size={15} />新建文件夹
              </button>
            </div>
          </div>
        )}
      </div>
      {children.length > 0 ? (
        <>
          <ul aria-label="当前文件夹内容" className="bookmark-list">
            {visibleChildren.map((record) => (
              <BookmarkRow
                highlighted={highlightedId === record.id}
                key={record.id}
                onEnterFolder={onNavigate}
                onEdit={onEdit}
                onMove={onMove}
                onOpen={onOpen}
                onDelete={onDelete}
                onContextMenu={(event, nextRecord) => { setContextRecord(nextRecord); context.onContextMenu(event); }}
                onSelectionChange={onSelectionChange}
                record={record}
                selectable={
                  validateWritableRecord(record).valid
                }
                selected={selectedIds?.has(record.id) ?? false}
              />
            ))}
          </ul>
          {context.contextMenu}
          {visibleChildren.length < children.length && (
            <div className="browse-load-more">
              <button
                className="command-button"
                onClick={() =>
                  setVisibleLimit((current) =>
                    Math.min(children.length, current + PAGE_SIZE),
                  )
                }
                type="button"
              >
                显示更多
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="content-state">当前文件夹为空</div>
      )}
    </section>
  );
}
