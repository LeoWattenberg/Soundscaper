import React from 'react';
import { useTheme } from '../ThemeProvider';
import './Flyout.css';

export type FlyoutDirection = 'down' | 'up' | 'left' | 'right';

export interface FlyoutProps {
  /** Optional DOM id for associating the flyout with its trigger. */
  id?: string;
  /** Whether the flyout is open. */
  isOpen: boolean;
  /** Called when the flyout should close. */
  onClose: () => void;
  /** Horizontal position of the anchor point, in viewport pixels. */
  x: number;
  /** Vertical position of the anchor point, in viewport pixels. */
  y: number;
  /** Edge from which the flyout expands. Defaults to downward. */
  direction?: FlyoutDirection;
  /** Arbitrary flyout content. */
  children: React.ReactNode;
  /** Whether to render an arrow that points to the anchor. */
  showArrow?: boolean;
  /** Whether a pointer press outside the flyout closes it. */
  closeOnOutsideClick?: boolean;
  /** Whether Escape closes the flyout. */
  closeOnEscape?: boolean;
  /** Whether to focus the first focusable child when the flyout opens. */
  autoFocus?: boolean;
  /** Trigger to restore focus to after pressing Escape. */
  triggerRef?: React.RefObject<HTMLElement>;
  /** Accessible name for the flyout. */
  ariaLabel?: string;
  /** ARIA role applied to the flyout container. */
  role?: React.AriaRole;
  /** Optional CSS class name. */
  className?: string;
  /** Optional inline styles. */
  style?: React.CSSProperties;
}

interface FlyoutPosition {
  left: number;
  top: number;
  arrowOffset: number;
}

const ARROW_SIZE = 8;
const VIEWPORT_MARGIN = 10;
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * A floating surface for arbitrary content, anchored to viewport coordinates.
 * It supports all four expansion directions while keeping the surface inside
 * the viewport where possible.
 */
export const Flyout: React.FC<FlyoutProps> = ({
  id,
  isOpen,
  onClose,
  x,
  y,
  direction = 'down',
  children,
  showArrow = true,
  closeOnOutsideClick = true,
  closeOnEscape = true,
  autoFocus = false,
  triggerRef,
  ariaLabel = 'Flyout',
  role = 'dialog',
  className = '',
  style: externalStyle,
}) => {
  const { theme } = useTheme();
  const flyoutRef = React.useRef<HTMLDivElement>(null);
  const [position, setPosition] = React.useState<FlyoutPosition | null>(null);

  const updatePosition = React.useCallback(() => {
    const flyout = flyoutRef.current;
    if (!flyout) return;

    const { width, height } = flyout.getBoundingClientRect();
    let left = x;
    let top = y;

    switch (direction) {
      case 'up':
        left -= width / 2;
        top -= height + ARROW_SIZE;
        break;
      case 'left':
        left -= width + ARROW_SIZE;
        top -= height / 2;
        break;
      case 'right':
        left += ARROW_SIZE;
        top -= height / 2;
        break;
      case 'down':
        left -= width / 2;
        top += ARROW_SIZE;
        break;
    }

    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
    const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
    const clampedLeft = clamp(left, VIEWPORT_MARGIN, maxLeft);
    const clampedTop = clamp(top, VIEWPORT_MARGIN, maxTop);
    const arrowOffset = direction === 'up' || direction === 'down'
      ? clamp(x - clampedLeft, ARROW_SIZE, Math.max(ARROW_SIZE, width - ARROW_SIZE))
      : clamp(y - clampedTop, ARROW_SIZE, Math.max(ARROW_SIZE, height - ARROW_SIZE));

    setPosition(current => (
      current?.left === clampedLeft &&
      current.top === clampedTop &&
      current.arrowOffset === arrowOffset
        ? current
        : { left: clampedLeft, top: clampedTop, arrowOffset }
    ));
  }, [direction, x, y]);

  React.useLayoutEffect(() => {
    if (!isOpen) {
      setPosition(null);
      return;
    }

    updatePosition();
    window.addEventListener('resize', updatePosition);

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(updatePosition);
    if (resizeObserver && flyoutRef.current) resizeObserver.observe(flyoutRef.current);

    return () => {
      window.removeEventListener('resize', updatePosition);
      resizeObserver?.disconnect();
    };
  }, [children, isOpen, updatePosition]);

  React.useEffect(() => {
    if (!isOpen || !closeOnOutsideClick) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!flyoutRef.current?.contains(event.target as Node)) onClose();
    };
    const timeout = window.setTimeout(() => {
      document.addEventListener('pointerdown', handlePointerDown);
    }, 0);

    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [closeOnOutsideClick, isOpen, onClose]);

  React.useEffect(() => {
    if (!isOpen || !closeOnEscape) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
      window.setTimeout(() => triggerRef?.current?.focus(), 0);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeOnEscape, isOpen, onClose, triggerRef]);

  React.useEffect(() => {
    if (!isOpen || !autoFocus) return;

    const timeout = window.setTimeout(() => {
      const firstFocusable = flyoutRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (firstFocusable ?? flyoutRef.current)?.focus();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [autoFocus, isOpen]);

  if (!isOpen) return null;

  const style = {
    '--flyout-bg': theme.background.surface.default,
    '--flyout-border': theme.border.default,
    '--flyout-arrow-offset': `${position?.arrowOffset ?? 0}px`,
    left: `${position?.left ?? x}px`,
    top: `${position?.top ?? y}px`,
    visibility: position ? undefined : 'hidden',
    ...externalStyle,
  } as React.CSSProperties;

  return (
    <div
      id={id}
      ref={flyoutRef}
      className={`flyout flyout--${direction} ${className}`}
      data-direction={direction}
      role={role}
      aria-label={ariaLabel}
      tabIndex={autoFocus ? -1 : undefined}
      style={style}
    >
      {showArrow && <div className="flyout__arrow" aria-hidden="true" />}
      <div className="flyout__content">{children}</div>
    </div>
  );
};

export default Flyout;
