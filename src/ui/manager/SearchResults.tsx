import { ExternalLink, Folder, LocateFixed, Lock } from 'lucide-react';

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
}

function resultPath(record: BookmarkRecord): string {
  return record.path.filter((segment) => segment.trim()).join(' / ') || '根目录';
}

export function SearchResults({
  results,
  onEnterFolder,
  onLocate,
  onOpen,
}: SearchResultsProps) {
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
              <li className="search-result-row" key={node.id}>
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
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
