import { useState } from 'react';

import {
  getBookmarkDisplayInfo,
  type BookmarkViewModel,
} from '../../app/bookmark-view-model';
import type { BookmarkRecord } from '../../domain/bookmarks';

interface MoveBookmarkDialogProps {
  readonly folders: readonly BookmarkRecord[];
  readonly model: BookmarkViewModel;
  readonly onCancel: () => void;
  readonly onPreview: (targetFolderId: string) => void;
}

function folderPathLabel(model: BookmarkViewModel, folder: BookmarkRecord): string {
  return model
    .getBreadcrumbs(folder.id)
    .map((breadcrumb) => getBookmarkDisplayInfo(breadcrumb).displayTitle)
    .join(' / ');
}

export function MoveBookmarkDialog({
  folders,
  model,
  onCancel,
  onPreview,
}: MoveBookmarkDialogProps) {
  const [targetFolderId, setTargetFolderId] = useState(folders[0]?.id ?? '');

  return (
    <div aria-labelledby="move-dialog-title" aria-modal="true" className="dialog-backdrop" role="dialog">
      <form
        className="operation-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (targetFolderId) {
            onPreview(targetFolderId);
          }
        }}
      >
        <header>
          <h2 id="move-dialog-title">移动到</h2>
        </header>
        <label className="field">
          <span>目标文件夹</span>
          <select
            autoFocus
            onChange={(event) => setTargetFolderId(event.target.value)}
            value={targetFolderId}
          >
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folderPathLabel(model, folder)}
              </option>
            ))}
          </select>
        </label>
        <footer className="dialog-actions">
          <button className="ghost-button" onClick={onCancel} type="button">
            取消
          </button>
          <button className="command-button" disabled={!targetFolderId} type="submit">
            预览
          </button>
        </footer>
      </form>
    </div>
  );
}
