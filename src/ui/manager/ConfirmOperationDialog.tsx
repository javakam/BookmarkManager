import type { BookmarkOperationPlan } from '../../app/bookmark-operation-service';

interface ConfirmOperationDialogProps {
  readonly plan: BookmarkOperationPlan;
  readonly disabled?: boolean;
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
    case 'quarantine':
      return `将移到待删除 ${plan.sources.length} 项`;
    case 'restore':
      return `将恢复 ${plan.entries.length} 项`;
  }
}

export function ConfirmOperationDialog({
  plan,
  disabled = false,
  onCancel,
  onConfirm,
}: ConfirmOperationDialogProps) {
  const isQuarantine = plan.kind === 'quarantine';

  return (
    <div aria-labelledby="confirm-operation-title" aria-modal="true" className="dialog-backdrop" role="dialog">
      <section className="operation-dialog">
        <header>
          <h2 id="confirm-operation-title">确认操作</h2>
        </header>
        <p className="operation-summary">{operationSummary(plan)}</p>
        {isQuarantine && (
          <p className="operation-note">
            可恢复
          </p>
        )}
        <footer className="dialog-actions">
          <button className="ghost-button" disabled={disabled} onClick={onCancel} type="button">
            取消
          </button>
          <button className="command-button" disabled={disabled} onClick={onConfirm} type="button">
            确认执行
          </button>
        </footer>
      </section>
    </div>
  );
}
