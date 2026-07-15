import { ExternalLink, Folder, LocateFixed, Lock, MoveRight, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';

import {
  getBookmarkDisplayInfo,
} from '../../app/bookmark-view-model';
import type { SearchResult } from '../../app/bookmark-index';
import type { BookmarkRecord } from '../../domain/bookmarks';
import type { SearchReason } from '../../domain/search';
import {
  bookmarkOpenLabel,
  Favicon,
} from './BookmarkRow';
import { useItemContextMenu } from './useItemContextMenu';

const REASON_LABELS: Readonly<Record<SearchReason, string>> = {
  'title-exact': '标题完全匹配',
  'title-prefix': '标题开头匹配',
  domain: '域名匹配',
  pinyin: '拼音匹配',
  path: '文件夹路径匹配',
  url: '网址匹配',
  fuzzy: '近似匹配',
};

interface SearchResultsProps {
  readonly results: readonly SearchResult[];
  readonly onEnterFolder: (folderId: string) => void;
  readonly onLocate: (record: BookmarkRecord) => void;
  readonly onOpen: (record: BookmarkRecord) => void;
  readonly onEdit?: (record: BookmarkRecord) => void;
  readonly onMove?: (record: BookmarkRecord) => void;
  readonly onDelete?: (record: BookmarkRecord) => void;
}

function resultPath(record: BookmarkRecord): string {
  return record.path.filter((segment) => segment.trim()).join(' / ') || '根目录';
}

export function SearchResults({
  results,
  onEnterFolder,
  onLocate,
  onOpen,
  onEdit,
  onMove,
  onDelete,
}: SearchResultsProps) {
  const [contextNode, setContextNode] = useState<BookmarkRecord>();
  const contextDisplay = contextNode ? getBookmarkDisplayInfo(contextNode) : undefined;
  const context = useItemContextMenu(contextDisplay?.displayTitle ?? '', contextNode ? [
    ...(!contextNode.isFolder ? [{ label: '打开', onSelect: () => onOpen(contextNode) }] : []),
    { label: '定位', onSelect: () => onLocate(contextNode) },
    ...(onEdit && !contextNode.isUnmodifiable ? [{ label: '编辑', onSelect: () => onEdit(contextNode) }] : []),
    ...(onMove && !contextNode.isUnmodifiable ? [{ label: '移动', onSelect: () => onMove(contextNode) }] : []),
    ...(onDelete && !contextNode.isUnmodifiable ? [{ label: '删除', onSelect: () => onDelete(contextNode), danger: true }] : []),
  ] : []);
  return (
    <section aria-labelledby="search-results-heading" className="search-results">
      <div className="content-heading">
        <div>
          <h1 id="search-results-heading">搜索结果</h1>
          <span>{results.length} 项</span>
        </div>
      </div>
      {results.length === 0 ? (
        <div className="content-state">没有找到匹配的书签</div>
      ) : (
        <ul aria-label="搜索结果" className="search-result-list">
          {results.map((result) => {
            const { node } = result;
            const display = getBookmarkDisplayInfo(node);
            const openLabel = bookmarkOpenLabel(display);
            const visibleReasons = result.reasons.slice(0, 2);
            const remainingReasonCount = result.reasons.length - visibleReasons.length;
            return (
              <li className="search-result-row" key={node.id} onContextMenu={(event) => { setContextNode(node); context.onContextMenu(event); }}>
                <span className="bookmark-row__icon">
                  {node.isFolder ? (
                    <Folder aria-hidden="true" className="item-icon item-icon--folder" />
                  ) : (
                    <Favicon display={display} record={node} />
                  )}
                </span>
                <span className="search-result-row__identity">
                  {node.isFolder ? (
                    <button
                      aria-label={`进入文件夹 ${display.displayTitle}`}
                      className="text-action"
                      onClick={() => onEnterFolder(node.id)}
                      type="button"
                    >
                      {display.displayTitle}
                    </button>
                  ) : (
                    <span className="bookmark-row__title-text">
                      {display.displayTitle}
                    </span>
                  )}
                  {display.isIconOnly && (
                    <span className="bookmark-row__tag">仅图标显示</span>
                  )}
                  <span className="search-result-row__path">{resultPath(node)}</span>
                </span>
                <span className="search-result-row__match">
                  {visibleReasons.map((reason) => (
                    <span className="match-reason" key={reason}>
                      {REASON_LABELS[reason]}
                    </span>
                  ))}
                  {remainingReasonCount > 0 && (
                    <span className="match-reason">另有 {remainingReasonCount} 项</span>
                  )}
                </span>
                <span className="search-result-row__url">
                  <span>{display.host || (node.isFolder ? '文件夹' : node.url)}</span>
                  {!node.isFolder && <span>{node.url}</span>}
                </span>
                <span className="bookmark-row__actions">
                  {node.isUnmodifiable && (
                    <Lock aria-label="只读" className="status-icon" role="img" size={16} />
                  )}
                  {!node.isFolder && node.url && (
                    <button
                      aria-label={openLabel}
                      className="icon-button"
                      onClick={() => onOpen(node)}
                      title={openLabel}
                      type="button"
                    >
                      <ExternalLink aria-hidden="true" size={17} />
                    </button>
                  )}
                  {!node.isFolder && (
                    <button
                      aria-label={`定位 ${display.displayTitle}`}
                      className="icon-button"
                      onClick={() => onLocate(node)}
                      title={`定位 ${display.displayTitle}`}
                      type="button"
                    >
                      <LocateFixed aria-hidden="true" size={17} />
                    </button>
                  )}
                  {!node.isUnmodifiable && onEdit && <button aria-label={`编辑 ${display.displayTitle}`} className="icon-button" onClick={() => onEdit(node)} title={`编辑 ${display.displayTitle}`} type="button"><Pencil aria-hidden="true" size={16} /></button>}
                  {!node.isUnmodifiable && onMove && <button aria-label={`移动 ${display.displayTitle}`} className="icon-button" onClick={() => onMove(node)} title={`移动 ${display.displayTitle}`} type="button"><MoveRight aria-hidden="true" size={16} /></button>}
                  {!node.isUnmodifiable && onDelete && <button aria-label={`删除 ${display.displayTitle}`} className="icon-button" onClick={() => onDelete(node)} title={`删除 ${display.displayTitle}`} type="button"><Trash2 aria-hidden="true" size={16} /></button>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {context.contextMenu}
    </section>
  );
}
