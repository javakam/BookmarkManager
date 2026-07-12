import { ChevronRight, FolderPlus, Lock, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  getBookmarkDisplayInfo,
  type BookmarkViewModel,
} from '../../app/bookmark-view-model';
import type { BookmarkRecord } from '../../domain/bookmarks';
import { BookmarkRow } from './BookmarkRow';

const PAGE_SIZE = 100;

interface BrowseViewProps {
  readonly model: BookmarkViewModel;
  readonly activeFolderId: string;
  readonly highlightedId?: string;
  readonly onCreateBookmark?: (parentId: string) => void;
  readonly onCreateFolder?: (parentId: string) => void;
  readonly onEdit?: (record: BookmarkRecord) => void;
  readonly onNavigate: (folderId: string) => void;
  readonly onMove?: (record: BookmarkRecord) => void;
  readonly onOpen: (record: BookmarkRecord) => void;
  readonly onQuarantine?: (record: BookmarkRecord) => void;
}

export function BrowseView({
  model,
  activeFolderId,
  highlightedId,
  onCreateBookmark,
  onCreateFolder,
  onEdit,
  onNavigate,
  onMove,
  onOpen,
  onQuarantine,
}: BrowseViewProps) {
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);

  useEffect(() => {
    setVisibleLimit(PAGE_SIZE);
  }, [activeFolderId]);

  const activeFolder = model.recordById.get(activeFolderId);
  if (!activeFolder) {
    return <div className="content-state">没有可浏览的书签目录</div>;
  }

  const folderName = getBookmarkDisplayInfo(activeFolder).displayTitle;
  const breadcrumbs = model.getBreadcrumbs(activeFolderId);
  const children = model.childrenByParentId.get(activeFolderId) ?? [];
  const visibleChildren = children.slice(0, visibleLimit);
  const canWriteInFolder = !activeFolder.isRoot && !activeFolder.isUnmodifiable;

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
            <button
              className="command-button"
              onClick={() => onCreateBookmark?.(activeFolderId)}
              type="button"
            >
              <Plus aria-hidden="true" size={15} />
              新建书签
            </button>
            <button
              className="command-button"
              onClick={() => onCreateFolder?.(activeFolderId)}
              type="button"
            >
              <FolderPlus aria-hidden="true" size={15} />
              新建文件夹
            </button>
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
                onQuarantine={onQuarantine}
                record={record}
              />
            ))}
          </ul>
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
