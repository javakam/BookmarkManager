import { useState } from 'react';

import type { BookmarkRecord } from '../../domain/bookmarks';
import { trapDialogFocus } from './dialog-focus';

type BookmarkEditorMode = 'create-bookmark' | 'create-folder' | 'edit';

interface BookmarkEditorDialogProps {
  readonly mode: BookmarkEditorMode;
  readonly record?: BookmarkRecord;
  readonly error?: string;
  readonly onCancel: () => void;
  readonly onPreview: (input: { title: string; url?: string }) => void;
}

function dialogTitle(mode: BookmarkEditorMode, record?: BookmarkRecord): string {
  if (mode === 'create-bookmark') {
    return '新建书签';
  }
  if (mode === 'create-folder') {
    return '新建文件夹';
  }
  return record?.isFolder ? '编辑文件夹' : '编辑书签';
}

export function BookmarkEditorDialog({
  mode,
  record,
  error,
  onCancel,
  onPreview,
}: BookmarkEditorDialogProps) {
  const [title, setTitle] = useState(record?.title ?? '');
  const [url, setUrl] = useState(record?.url ?? '');
  const heading = dialogTitle(mode, record);
  const needsUrl = mode === 'create-bookmark' || (mode === 'edit' && !record?.isFolder);
  const hasChanges =
    mode !== 'edit' ||
    title !== (record?.title ?? '') ||
    (needsUrl && url !== (record?.url ?? ''));

  return (
    <div
      aria-labelledby="bookmark-editor-title"
      aria-modal="true"
      className="dialog-backdrop"
      onKeyDown={trapDialogFocus}
      role="dialog"
    >
      <form
        className="operation-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onPreview({
            title,
            ...(needsUrl ? { url } : {}),
          });
        }}
      >
        <header>
          <h2 id="bookmark-editor-title">{heading}</h2>
        </header>
        <label className="field">
          <span>{mode === 'create-folder' || record?.isFolder ? '名称' : '标题'}</span>
          <input
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
            type="text"
            value={title}
          />
        </label>
        {needsUrl && (
          <label className="field">
            <span>网址</span>
            <textarea
              aria-label="网址"
              className="field__textarea"
              rows={4}
              onChange={(event) => setUrl(event.target.value)}
              required
              value={url}
            />
          </label>
        )}
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        <footer className="dialog-actions">
          <button className="ghost-button" onClick={onCancel} type="button">
            取消
          </button>
          <button className="command-button" disabled={!hasChanges} type="submit">
            预览
          </button>
        </footer>
      </form>
    </div>
  );
}
