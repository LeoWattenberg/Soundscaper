import React from 'react';

interface ClipHeaderBadgeProps {
  label: string;
  icon: React.ReactNode;
  value: string;
  onClick?: () => void;
  onReset?: () => void;
}

/** Existing indicators also open properties and accept double-click reset. */
export function ClipHeaderBadge({ label, icon, value, onClick, onReset }: ClipHeaderBadgeProps) {
  const pendingClick = React.useRef<number | null>(null);
  const cancelPendingClick = () => {
    if (pendingClick.current === null) return;
    window.clearTimeout(pendingClick.current);
    pendingClick.current = null;
  };
  React.useEffect(() => () => {
    if (pendingClick.current !== null) window.clearTimeout(pendingClick.current);
  }, []);

  return (
    <button
      type="button"
      className="clip-header__badge"
      aria-label={label}
      aria-description={value}
      disabled={!onClick && !onReset}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Tab') event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        cancelPendingClick();
        if (event.detail === 0 || !onReset) {
          onClick?.();
        } else if (event.detail === 1) {
          // Opening the modal immediately would consume the second click.
          pendingClick.current = window.setTimeout(() => {
            pendingClick.current = null;
            onClick?.();
          }, 400);
        }
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        cancelPendingClick();
        onReset?.();
      }}
    >
      {icon}
      <span className="clip-header__badge-value">{value}</span>
    </button>
  );
}
