interface BatchActionBarProps {
  readonly selectedCount: number;
  readonly canQuarantine: boolean;
  readonly canRestore: boolean;
  readonly onCancelSelection: () => void;
  readonly onMove: () => void;
  readonly onQuarantine: () => void;
  readonly onRestore: () => void;
}

export function BatchActionBar({
  selectedCount,
  canQuarantine,
  canRestore,
  onCancelSelection,
  onMove,
  onQuarantine,
  onRestore,
}: BatchActionBarProps) {
  return (
    <div aria-label="批量操作" className="batch-action-bar" role="toolbar">
      <span>{selectedCount} 项已选择</span>
      <button className="command-button command-button--secondary" onClick={onMove} type="button">
        移动到……
      </button>
      {canQuarantine && (
        <button className="command-button command-button--secondary" onClick={onQuarantine} type="button">
          移到待删除
        </button>
      )}
      {canRestore && (
        <button className="command-button command-button--secondary" onClick={onRestore} type="button">
          恢复
        </button>
      )}
      <button className="ghost-button" onClick={onCancelSelection} type="button">
        取消选择
      </button>
    </div>
  );
}
