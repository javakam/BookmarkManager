import { useEffect, useState } from 'react';
import {
  Archive,
  ExternalLink,
  Folder,
  Globe,
  Lock,
  MoveRight,
  Pencil,
} from 'lucide-react';

import {
  getBookmarkDisplayInfo,
  type BookmarkDisplayInfo,
} from '../../app/bookmark-view-model';
import type { BookmarkRecord } from '../../domain/bookmarks';

interface BookmarkRowProps {
  readonly record: BookmarkRecord;
  readonly highlighted?: boolean;
  readonly onEnterFolder: (folderId: string) => void;
  readonly onOpen: (record: BookmarkRecord) => void;
  readonly onEdit?: (record: BookmarkRecord) => void;
  readonly onMove?: (record: BookmarkRecord) => void;
  readonly onQuarantine?: (record: BookmarkRecord) => void;
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
  onEnterFolder,
  onEdit,
  onMove,
  onOpen,
  onQuarantine,
}: BookmarkRowProps) {
  const display = getBookmarkDisplayInfo(record);
  const openLabel = bookmarkOpenLabel(display);
  const isWritable = !record.isRoot && !record.isUnmodifiable;

  return (
    <li
      className={`bookmark-row${highlighted ? ' bookmark-row--highlighted' : ''}`}
      data-highlighted={highlighted ? 'true' : undefined}
    >
      <span className="bookmark-row__icon">
        {record.isFolder ? (
          <Folder aria-hidden="true" className="item-icon item-icon--folder" />
        ) : (
          <Favicon display={display} record={record} />
        )}
      </span>
      <span className="bookmark-row__title">
        {record.isFolder ? (
          <button
            aria-label={`进入文件夹 ${display.displayTitle}`}
            className="text-action"
            onClick={() => onEnterFolder(record.id)}
            type="button"
          >
            {display.displayTitle}
          </button>
        ) : (
          <span className="bookmark-row__title-text">{display.displayTitle}</span>
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
        {isWritable && !record.isFolder && onQuarantine && (
          <button
            aria-label={`移到待删除 ${display.displayTitle}`}
            className="icon-button"
            onClick={() => onQuarantine(record)}
            title={`移到待删除 ${display.displayTitle}`}
            type="button"
          >
            <Archive aria-hidden="true" size={16} />
          </button>
        )}
      </span>
    </li>
  );
}
