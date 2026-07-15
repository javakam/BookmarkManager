import { useEffect, useState, type MouseEvent } from 'react';

export interface ItemMenuAction {
  readonly label: string;
  readonly onSelect: () => void;
  readonly danger?: boolean;
}

export function useItemContextMenu(
  itemLabel: string,
  actions: readonly ItemMenuAction[],
) {
  const [position, setPosition] = useState<{ x: number; y: number }>();

  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(undefined);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [position]);

  return {
    onContextMenu(event: MouseEvent<HTMLElement>) {
      event.preventDefault();
      setPosition({ x: event.clientX, y: event.clientY });
    },
    contextMenu: position ? (
      <div
        aria-label={`${itemLabel} 操作`}
        className="item-context-menu"
        role="menu"
        style={{ left: position.x, top: position.y }}
      >
        {actions.map((action) => (
          <button
            className={action.danger ? 'item-context-menu__danger' : undefined}
            key={action.label}
            onClick={() => {
              setPosition(undefined);
              action.onSelect();
            }}
            role="menuitem"
            type="button"
          >
            {action.label}
          </button>
        ))}
      </div>
    ) : null,
  };
}
