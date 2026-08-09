import type { BookmarkOperationPlan } from '../../app/bookmark-operation-service';
import { trapDialogFocus } from './dialog-focus';

interface ConfirmOperationDialogProps {
  readonly plan: BookmarkOperationPlan;
  readonly disabled?: boolean;
  readonly error?: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

function operationSummary(plan: BookmarkOperationPlan): string {
  switch (plan.kind) {
    case 'create-bookmark':
      return '将新建 1 个书签';
    case 'create-folder':
      return '将新建 1 个文件夹';
    case 'update':
      return '将更新 1 项';
    case 'move':
      return `将移动 ${plan.sources.length} 项`;
    case 'reorder':
      return '将调整 1 个文件夹顺序';
    case 'delete':
      if (plan.affectedCount === plan.sources.length) {
        return `将永久删除 ${plan.affectedCount} 项`;
      }
      return `将永久删除 ${plan.affectedCount} 项（含 ${plan.folderCount} 个文件夹及其内容）`;
  }
}

function operationCopy(plan: BookmarkOperationPlan): {
  readonly title: string;
  readonly confirmLabel: string;
} {
  switch (plan.kind) {
    case 'create-bookmark':
      return { title: '确认新建书签', confirmLabel: '确认新建书签' };
    case 'create-folder':
      return { title: '确认新建文件夹', confirmLabel: '确认新建文件夹' };
    case 'update':
      return { title: '确认保存修改', confirmLabel: '确认保存' };
    case 'move':
      return { title: '确认移动', confirmLabel: '确认移动' };
    case 'reorder':
      return { title: '确认调整顺序', confirmLabel: '确认调整顺序' };
    case 'delete':
      return { title: '确认删除', confirmLabel: '确认删除' };
  }
}

export function ConfirmOperationDialog({
  plan,
  disabled = false,
  error,
  onCancel,
  onConfirm,
}: ConfirmOperationDialogProps) {
  const isDestructive = plan.kind === 'delete';
  const copy = operationCopy(plan);

  return (
    <div
      aria-labelledby="confirm-operation-title"
      aria-modal="true"
      className="dialog-backdrop"
      onKeyDown={trapDialogFocus}
      role="dialog"
    >
      <section className="operation-dialog">
        <header>
          <h2 id="confirm-operation-title">{copy.title}</h2>
        </header>
        <p className="operation-summary">{operationSummary(plan)}</p>
        {isDestructive && (
          <p className="operation-note">删除后无法恢复</p>
        )}
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        <footer className="dialog-actions">
          <button autoFocus className="ghost-button" disabled={disabled} onClick={onCancel} type="button">
            取消
          </button>
          <button
            className={`command-button${isDestructive ? ' command-button--danger' : ''}`}
            disabled={disabled}
            onClick={onConfirm}
            type="button"
          >
            {copy.confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
