import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
} from 'react';

interface ActiveMenu {
  readonly id: string;
  readonly close: () => void;
}

let activeMenu: ActiveMenu | undefined;

function closeActiveMenu(exceptId?: string): void {
  if (!activeMenu || activeMenu.id === exceptId) {
    return;
  }
  const previous = activeMenu;
  activeMenu = undefined;
  previous.close();
}

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
  const openerRef = useRef<HTMLElement | undefined>(undefined);

  const closeMenu = useCallback(() => {
    setPosition(undefined);
    if (activeMenu?.id === menuId) {
      activeMenu = undefined;
    }
  }, [menuId]);

  useEffect(() => {
    return () => {
      if (activeMenu?.id === menuId) {
        activeMenu = undefined;
      }
    };
  }, [menuId]);

  useEffect(() => {
    if (!position) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
        queueMicrotask(() => openerRef.current?.focus());
        return;
      }
      if (
        event.key !== 'ArrowDown' &&
        event.key !== 'ArrowUp' &&
        event.key !== 'Home' &&
        event.key !== 'End'
      ) {
        return;
      }
      const buttons = [
        ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []),
      ];
      if (buttons.length === 0) {
        return;
      }
      event.preventDefault();
      const currentIndex = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      const nextIndex =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : event.key === 'ArrowUp'
              ? (currentIndex - 1 + buttons.length) % buttons.length
              : (currentIndex + 1) % buttons.length;
      buttons[nextIndex]?.focus();
    };
    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('scroll', closeMenu, true);
    window.addEventListener('scroll', closeMenu);
    window.addEventListener('resize', closeMenu);
    return () => {
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('scroll', closeMenu);
      window.removeEventListener('resize', closeMenu);
    };
  }, [closeMenu, position]);

  useLayoutEffect(() => {
    if (!position || !menuRef.current) {
      return;
    }
    const rect = menuRef.current.getBoundingClientRect();
    const next = {
      x: Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8)),
    };
    if (next.x !== position.x || next.y !== position.y) {
      setPosition(next);
    }
  }, [actions.length, position]);

  return {
    close: closeMenu,
    onContextMenu(event: MouseEvent<HTMLElement>) {
      event.preventDefault();
      const eventTarget = event.target;
      openerRef.current =
        eventTarget instanceof HTMLElement
          ? (eventTarget.closest<HTMLElement>(
              'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
            ) ??
            event.currentTarget.querySelector<HTMLElement>(
              'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
            ) ??
            undefined)
          : undefined;
      closeActiveMenu(menuId);
      activeMenu = { id: menuId, close: closeMenu };
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
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            closeMenu();
          }
        }}
      >
        {actions.map((action) => (
          <button
            className={action.danger ? 'item-context-menu__danger' : undefined}
            key={action.label}
            onClick={() => {
              const opener = openerRef.current;
              closeMenu();
              opener?.focus();
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
