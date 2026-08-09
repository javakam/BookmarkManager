import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
} from 'react';

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
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
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
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setPosition(undefined);
          }
        }}
      >
        {actions.map((action) => (
          <button
            className={action.danger ? 'item-context-menu__danger' : undefined}
            key={action.label}
            onClick={() => {
              const opener = openerRef.current;
              setPosition(undefined);
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
