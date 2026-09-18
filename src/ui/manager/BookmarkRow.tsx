import { useEffect, useRef, useState } from 'react';
import {
  ExternalLink,
  Folder,
  Globe,
  GripVertical,
  Lock,
  MoveRight,
  Pencil,
  Trash2,
} from 'lucide-react';

import {
  getBookmarkDisplayInfo,
  type BookmarkDisplayInfo,
} from '../../app/bookmark-view-model';
import { validateWritableRecord } from '../../domain/bookmark-operations';
import type { BookmarkRecord } from '../../domain/bookmarks';
import type { DragEvent, MouseEvent } from 'react';
import type { BookmarkDropPosition } from '../../domain/folder-reorder';

export interface BookmarkDragState {
  readonly sourceId: string;
  readonly parentId: string;
  readonly revision: number;
}

export interface BookmarkDropTarget {
  readonly anchorId: string;
  readonly position: BookmarkDropPosition;
}

interface BookmarkRowProps {
  readonly record: BookmarkRecord;
  readonly highlighted?: boolean;
  readonly selectable?: boolean;
  readonly selected?: boolean;
  readonly onEnterFolder: (folderId: string) => void;
  readonly onOpen: (record: BookmarkRecord) => void;
  readonly onEdit?: (record: BookmarkRecord) => void;
  readonly onMove?: (record: BookmarkRecord) => void;
  readonly onDelete?: (record: BookmarkRecord) => void;
  readonly onSelectionChange?: (record: BookmarkRecord, selected: boolean) => void;
  readonly onContextMenu?: (event: MouseEvent<HTMLElement>, record: BookmarkRecord) => void;
  readonly reorderRevision?: number;
  readonly draggedItem?: BookmarkDragState;
  readonly dropTarget?: BookmarkDropTarget;
  readonly onDraggedItemChange?: (next?: BookmarkDragState) => void;
  readonly onDropTargetChange?: (next?: BookmarkDropTarget) => void;
  readonly onReorder?: (
    sourceId: string,
    anchorId: string,
    position: BookmarkDropPosition,
    revision: number,
  ) => void;
}

export function createFaviconUrl(url: string): string {
  const faviconUrl = new URL('/_favicon/', location.origin);
  faviconUrl.searchParams.set('pageUrl', url);
  faviconUrl.searchParams.set('size', '32');
  return faviconUrl.toString();
}

export function bookmarkOpenLabel(
  display: BookmarkDisplayInfo,
): string {
  return `打开 ${display.displayTitle}${
    display.isIconOnly ? '（仅图标显示）' : ''
  }`;
}

export function Favicon({
  record,
  display,
}: {
  readonly record: BookmarkRecord;
  readonly display: BookmarkDisplayInfo;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [record.url]);

  if (!record.url || failed) {
    return (
      <Globe
        aria-label={`${display.displayTitle} 默认网站图标`}
        className="item-icon item-icon--bookmark"
        role="img"
      />
    );
  }

  return (
    <img
      aria-label={`${display.displayTitle} 网站图标`}
      className="item-favicon"
      decoding="async"
      height="20"
      loading="lazy"
      onError={() => setFailed(true)}
      src={createFaviconUrl(record.url)}
      width="20"
    />
  );
}

export function BookmarkRow({
  record,
  highlighted = false,
  selectable = false,
  selected = false,
  onEnterFolder,
  onEdit,
  onMove,
  onOpen,
  onDelete,
  onSelectionChange,
  onContextMenu,
  reorderRevision,
  draggedItem,
  dropTarget,
  onDraggedItemChange,
  onDropTargetChange,
  onReorder,
}: BookmarkRowProps) {
  const display = getBookmarkDisplayInfo(record);
  const openLabel = bookmarkOpenLabel(display);
  const isWritable = validateWritableRecord(record).valid;
  const rowRef = useRef<HTMLLIElement>(null);
  const canReorder =
    isWritable &&
    record.parentId !== undefined &&
    reorderRevision !== undefined &&
    onReorder !== undefined;
  const dropPosition =
    dropTarget?.anchorId === record.id ? dropTarget.position : undefined;

  const getDropPosition = (event: DragEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return bounds.height > 0 && event.clientY < bounds.top + bounds.height / 2
      ? 'before'
      : 'after';
  };

  const startDrag = (event: DragEvent<HTMLLIElement>) => {
    if (!canReorder || !record.parentId || reorderRevision === undefined) {
      event.preventDefault();
      return;
    }
    if (
      event.target instanceof Element &&
      event.target.closest('button, input, a, textarea, select')
    ) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(
      'application/x-bookmark-item',
      JSON.stringify({
        sourceId: record.id,
        parentId: record.parentId,
        revision: reorderRevision,
      }),
    );
    onDraggedItemChange?.({
      sourceId: record.id,
      parentId: record.parentId,
      revision: reorderRevision,
    });
  };

  const handleDrop = (event: DragEvent<HTMLLIElement>) => {
    event.preventDefault();
    const currentDropTarget = dropTarget;
    onDropTargetChange?.(undefined);
    onDraggedItemChange?.(undefined);
    if (!canReorder || !currentDropTarget) {
      return;
    }
    if (
      draggedItem &&
      draggedItem.sourceId !== record.id &&
      draggedItem.parentId === record.parentId
    ) {
      onReorder?.(
        draggedItem.sourceId,
        record.id,
        currentDropTarget.position,
        draggedItem.revision,
      );
    }
  };

  useEffect(() => {
    if (highlighted) {
      rowRef.current?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    }
  }, [highlighted]);

  return (
    <li
      className={`bookmark-row${highlighted ? ' bookmark-row--highlighted' : ''}${
        canReorder ? ' bookmark-row--draggable' : ''
      }${dropPosition ? ` bookmark-row--drop-${dropPosition}` : ''}`}
      data-bookmark-id={record.id}
      data-highlighted={highlighted ? 'true' : undefined}
      draggable={canReorder}
      onDragEnd={() => {
        onDropTargetChange?.(undefined);
        onDraggedItemChange?.(undefined);
      }}
      onDragOver={(event) => {
        if (!canReorder) {
          onDropTargetChange?.(undefined);
          return;
        }
        event.preventDefault();
        if (
          draggedItem &&
          draggedItem.sourceId !== record.id &&
          draggedItem.parentId === record.parentId
        ) {
          onDropTargetChange?.({
            anchorId: record.id,
            position: getDropPosition(event),
          });
        } else {
          onDropTargetChange?.(undefined);
        }
      }}
      onDragStart={startDrag}
      onDrop={handleDrop}
      onContextMenu={(event) => onContextMenu?.(event, record)}
      ref={rowRef}
      title={canReorder ? `拖动调整 ${display.displayTitle} 顺序` : undefined}
    >
      <span className="bookmark-row__select">
        {selectable && (
          <input
            aria-label={`选择 ${display.displayTitle}`}
            checked={selected}
            onChange={(event) => onSelectionChange?.(record, event.target.checked)}
            type="checkbox"
          />
        )}
      </span>
      <span className="bookmark-row__icon">
        {record.isFolder ? (
          <Folder aria-hidden="true" className="item-icon item-icon--folder" />
        ) : (
          <Favicon display={display} record={record} />
        )}
      </span>
      <span
        aria-label={canReorder ? `拖动调整 ${display.displayTitle} 顺序` : undefined}
        className="bookmark-row__drag-handle"
        role={canReorder ? 'img' : undefined}
        title={canReorder ? `拖动调整 ${display.displayTitle} 顺序` : undefined}
      >
        {canReorder && <GripVertical size={16} />}
      </span>
      <span className="bookmark-row__title">
        {record.isFolder ? (
          <button
            aria-label={`进入文件夹 ${display.displayTitle}`}
            className="text-action"
            onClick={() => onEnterFolder(record.id)}
            title={display.displayTitle}
            type="button"
          >
            {display.displayTitle}
          </button>
        ) : (
          <span className="bookmark-row__title-text" title={display.displayTitle}>
            {display.displayTitle}
          </span>
        )}
        {display.isIconOnly && (
          <span className="bookmark-row__tag">仅图标显示</span>
        )}
      </span>
      <span className="bookmark-row__kind">
        {record.isFolder
          ? '文件夹'
          : display.isIconOnly
            ? '书签'
            : display.host || '书签'}
      </span>
      <span className="bookmark-row__url">
        {record.isFolder ? '' : record.url}
      </span>
      <span className="bookmark-row__actions">
        {record.isUnmodifiable && (
          <Lock
            aria-label="只读"
            className="status-icon"
            role="img"
            size={16}
          />
        )}
        {!record.isFolder && record.url && (
          <button
            aria-label={openLabel}
            className="icon-button"
            onClick={() => onOpen(record)}
            title={openLabel}
            type="button"
          >
            <ExternalLink aria-hidden="true" size={17} />
          </button>
        )}
        {isWritable && onEdit && (
          <button
            aria-label={`编辑 ${display.displayTitle}`}
            className="icon-button"
            onClick={() => onEdit(record)}
            title={`编辑 ${display.displayTitle}`}
            type="button"
          >
            <Pencil aria-hidden="true" size={16} />
          </button>
        )}
        {isWritable && onMove && (
          <button
            aria-label={`移动 ${display.displayTitle}`}
            className="icon-button"
            onClick={() => onMove(record)}
            title={`移动 ${display.displayTitle}`}
            type="button"
          >
            <MoveRight aria-hidden="true" size={16} />
          </button>
        )}
        {isWritable && onDelete && (
          <button
            aria-label={`删除 ${display.displayTitle}`}
            className="icon-button icon-button--danger"
            onClick={() => onDelete(record)}
            title={`删除 ${display.displayTitle}`}
            type="button"
          >
            <Trash2 aria-hidden="true" size={16} />
          </button>
        )}
      </span>
    </li>
  );
}
