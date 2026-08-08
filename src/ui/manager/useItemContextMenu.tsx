import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';

export interface ItemMenuAction {
  readonly label: string;
  readonly onSelect: () => void;
  readonly danger?: boolean;
}

export function useItemContextMenu(
  itemLabel: string,
  actions: readonly ItemMenuAction[],
) {
  const menuId = useId();
  const [position, setPosition] = useState<{ x: number; y: number }>();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOtherMenu = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== menuId) {
        setPosition(undefined);
      }
    };
    document.addEventListener('bookmark-context-menu-open', closeOtherMenu);
    return () => document.removeEventListener('bookmark-context-menu-open', closeOtherMenu);
  }, [menuId]);

  useEffect(() => {
    if (!position) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const close = () => setPosition(undefined);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('scroll', close, true);
    window.addEventListener('scroll', close);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('scroll', close, true);
      window.removeEventListener('scroll', close);
      window.removeEventListener('resize', close);
    };
  }, [position]);

  return {
    onContextMenu(event: MouseEvent<HTMLElement>) {
      event.preventDefault();
      document.dispatchEvent(
        new CustomEvent('bookmark-context-menu-open', { detail: menuId }),
      );
      const menuWidth = 220;
      const menuHeight = Math.max(48, actions.length * 40 + 12);
      setPosition({
        x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
        y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
      });
    },
    contextMenu: position ? (
      <div
        aria-label={`${itemLabel} 操作`}
        className="item-context-menu"
        ref={menuRef}
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
