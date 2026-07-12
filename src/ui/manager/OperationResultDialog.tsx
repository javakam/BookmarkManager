import type { BookmarkOperationExecution } from '../../domain/bookmark-operations';

interface OperationResultDialogProps {
  readonly execution: BookmarkOperationExecution;
  readonly onClose: () => void;
}

function statusText(status: string): string {
  if (status === 'success') {
    return '成功';
  }
  if (status === 'conflict') {
    return '冲突';
  }
  return '失败';
}

export function OperationResultDialog({
  execution,
  onClose,
}: OperationResultDialogProps) {
  const successCount = execution.results.filter(
    (result) => result.status === 'success',
  ).length;

  return (
    <div aria-labelledby="operation-result-title" aria-modal="true" className="dialog-backdrop" role="dialog">
      <section className="operation-dialog">
        <header>
          <h2 id="operation-result-title">操作结果</h2>
        </header>
        <p className="operation-summary">
          成功 {successCount} / {execution.results.length}
        </p>
        <ul className="operation-result-list">
          {execution.results.map((result) => (
            <li key={result.id}>
              <span>{statusText(result.status)}</span>
              <span>{result.message}</span>
            </li>
          ))}
        </ul>
        <footer className="dialog-actions">
          <button className="command-button" onClick={onClose} type="button">
            知道了
          </button>
        </footer>
      </section>
    </div>
  );
}
