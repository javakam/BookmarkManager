import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';

export interface PopupProps {
  readonly openManager: () => Promise<void>;
  readonly closePopup?: () => void;
}

export function Popup({ openManager, closePopup }: PopupProps) {
  const mountedRef = useRef(false);
  const openingRef = useRef(false);
  const [isOpening, setIsOpening] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleOpen = async () => {
    if (openingRef.current) {
      return;
    }

    openingRef.current = true;
    setIsOpening(true);
    setHasError(false);

    try {
      await openManager();
    } catch {
      if (!mountedRef.current) {
        return;
      }
      openingRef.current = false;
      setIsOpening(false);
      setHasError(true);
      return;
    }

    if (!mountedRef.current) {
      return;
    }

    try {
      closePopup?.();
    } catch {
      // The manager tab is already open; keep the command locked.
    }
  };

  return (
    <main className="popup-shell">
      <h1 className="popup-title">书签工作台</h1>
      <button
        aria-busy={isOpening}
        className="popup-command"
        disabled={isOpening}
        onClick={handleOpen}
        type="button"
      >
        <ExternalLink aria-hidden="true" size={18} strokeWidth={2} />
        <span>打开书签工作台</span>
      </button>
      {hasError ? (
        <p className="popup-error" role="alert">
          无法打开书签工作台，请重试
        </p>
      ) : null}
    </main>
  );
}
