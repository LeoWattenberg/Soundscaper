import React from 'react';
import { Icon } from '../Icon/Icon';
import './AddTrackFlyout.css';

export type TrackType = 'mono' | 'stereo' | 'label' | 'midi';

export interface TrackTypeOption {
  type: TrackType;
  label: string;
  icon: 'microphone' | 'label' | 'midi';
}

export interface AddTrackFlyoutProps {
  /**
   * Whether the flyout is open
   */
  isOpen: boolean;

  /**
   * Callback when a track type is selected
   */
  onSelectTrackType: (type: TrackType) => void;

  /**
   * Callback when flyout should close
   */
  onClose: () => void;

  /**
   * X position for the flyout (in pixels)
   */
  x: number;

  /**
   * Y position for the flyout (in pixels)
   */
  y: number;

  /**
   * Whether to show the MIDI option (default: false)
   */
  showMidiOption?: boolean;

  /**
   * Whether to auto-focus the first option when opened (e.g., via keyboard)
   */
  autoFocus?: boolean;

  /**
   * Ref to the trigger button (for focus restoration)
   */
  triggerRef?: React.RefObject<HTMLElement>;

  /**
   * Optional CSS class name
   */
  className?: string;
}

/**
 * AddTrackFlyout - A popover menu for creating new tracks
 * Appears when the "Add Track" button is clicked
 */
export const AddTrackFlyout: React.FC<AddTrackFlyoutProps> = ({
  isOpen,
  onSelectTrackType,
  onClose,
  x,
  y,
  showMidiOption = false,
  autoFocus = false,
  triggerRef,
  className = '',
}) => {
  const flyoutRef = React.useRef<HTMLDivElement>(null);
  const firstOptionRef = React.useRef<HTMLButtonElement>(null);

  // Handle click outside to close
  React.useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (flyoutRef.current && !flyoutRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // Add slight delay to prevent immediate close from the button click that opened it
    setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  // Handle escape key to close and restore focus
  React.useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        // Restore focus to trigger button
        if (triggerRef?.current) {
          setTimeout(() => {
            triggerRef.current?.focus();
          }, 0);
        }
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose, triggerRef]);

  // Auto-focus first option when opened via keyboard
  React.useEffect(() => {
    if (isOpen && autoFocus && firstOptionRef.current) {
      setTimeout(() => {
        firstOptionRef.current?.focus();
      }, 0);
    }
  }, [isOpen, autoFocus]);

  // Handle keyboard navigation within the menu
  React.useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const options = flyoutRef.current?.querySelectorAll('.add-track-flyout__option');
      if (!options || options.length === 0) return;

      const currentIndex = Array.from(options).indexOf(document.activeElement as HTMLButtonElement);

      // Only handle keys if focus is inside the flyout
      if (currentIndex === -1) return;

      // Arrow keys: navigate between items (Left/Right or Up/Down)
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();

        let nextIndex: number;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          nextIndex = (currentIndex + 1) % options.length;
        } else {
          nextIndex = (currentIndex - 1 + options.length) % options.length;
        }

        // Update roving tabindex
        (options[currentIndex] as HTMLButtonElement).tabIndex = -1;
        (options[nextIndex] as HTMLButtonElement).tabIndex = 0;
        (options[nextIndex] as HTMLButtonElement).focus();
      }
      // Enter: select current item
      else if (e.key === 'Enter') {
        e.preventDefault();
        const currentOption = options[currentIndex] as HTMLButtonElement;
        currentOption.click();
      }
      // Space: prevent default (don't select, don't scroll page)
      else if (e.key === ' ') {
        e.preventDefault();
      }
      // Tab: close menu and let browser handle tab navigation
      else if (e.key === 'Tab') {
        onClose();
        // Don't preventDefault - let Tab continue to next element
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Adjust position if flyout would go off-screen
  React.useEffect(() => {
    if (!isOpen || !flyoutRef.current) return;

    const flyout = flyoutRef.current;
    const rect = flyout.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedX = x;
    let adjustedY = y;

    // Check if flyout goes off right edge
    if (rect.right > viewportWidth) {
      adjustedX = viewportWidth - rect.width - 10;
    }

    // Check if flyout goes off bottom edge
    if (rect.bottom > viewportHeight) {
      adjustedY = viewportHeight - rect.height - 10;
    }

    // Check if flyout goes off left edge
    if (adjustedX < 0) {
      adjustedX = 10;
    }

    // Check if flyout goes off top edge
    if (adjustedY < 0) {
      adjustedY = 10;
    }

    if (adjustedX !== x || adjustedY !== y) {
      flyout.style.left = `${adjustedX}px`;
      flyout.style.top = `${adjustedY}px`;
    }
  }, [isOpen, x, y]);

  const handleOptionClick = (type: TrackType) => {
    onSelectTrackType(type);
    // Don't close - let user add multiple tracks or close manually
  };

  if (!isOpen) return null;

  const options: TrackTypeOption[] = [
    { type: 'mono', label: 'Mono', icon: 'microphone' },
    { type: 'stereo', label: 'Stereo', icon: 'microphone' },
    { type: 'label', label: 'Label', icon: 'label' },
  ];

  if (showMidiOption) {
    options.push({ type: 'midi', label: 'MIDI', icon: 'midi' });
  }

  return (
    <div
      ref={flyoutRef}
      className={`add-track-flyout ${className}`}
      style={{
        position: 'fixed',
        left: `${x}px`,
        top: `${y}px`,
        zIndex: 10000,
      }}
    >
      <div className="add-track-flyout__triangle" />
      <div
        className="add-track-flyout__body"
        role="menu"
        aria-label="Add track type"
      >
        {options.map((option, index) => (
          <button
            key={option.type}
            ref={index === 0 ? firstOptionRef : undefined}
            className="add-track-flyout__option"
            role="menuitem"
            tabIndex={index === 0 ? 0 : -1}
            onClick={() => handleOptionClick(option.type)}
          >
            <Icon name={option.icon} size={16} />
            <span className="add-track-flyout__option-label">{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default AddTrackFlyout;
