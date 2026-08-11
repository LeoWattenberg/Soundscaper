import * as React from 'react';
import { useTabGroup } from '../hooks/useTabGroup';
import './DialogSideNav.css';

export interface DialogSideNavItem<T extends string = string> {
  id: T;
  label: string;
  icon: string;
}

export interface DialogSideNavProps<T extends string = string> {
  /** Array of navigation items */
  items: DialogSideNavItem<T>[];
  /** Currently selected item ID */
  selectedId: T;
  /** Callback when an item is selected */
  onSelectId: (id: T) => void;
  /** ARIA label for the navigation */
  ariaLabel?: string;
  /** Custom className */
  className?: string;
}

interface DialogSideNavButtonProps<T extends string = string> {
  item: DialogSideNavItem<T>;
  itemIndex: number;
  totalItems: number;
  isSelected: boolean;
  onSelect: (id: T) => void;
  buttonRef: (el: HTMLButtonElement | null) => void;
  itemRefs: React.MutableRefObject<(HTMLButtonElement | null)[]>;
  activeIndexRef: React.MutableRefObject<number>;
}

function DialogSideNavButton<T extends string = string>({
  item,
  itemIndex,
  totalItems,
  isSelected,
  onSelect,
  buttonRef,
  itemRefs,
  activeIndexRef,
}: DialogSideNavButtonProps<T>) {
  const { tabIndex, onKeyDown, onFocus, onBlur } = useTabGroup({
    groupId: 'dialog-sidenav',
    itemIndex,
    totalItems,
    itemRefs,
    activeIndexRef,
  });

  const handleClick = () => {
    onSelect(item.id);
  };

  return (
    <button
      ref={buttonRef}
      role="tab"
      aria-selected={isSelected}
      aria-controls={`dialog-panel-${item.id}`}
      tabIndex={tabIndex}
      className={`dialog-sidenav__button ${isSelected ? 'dialog-sidenav__button--selected' : ''}`}
      onClick={handleClick}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <span className="dialog-sidenav__icon musescore-icon">{item.icon}</span>
      <span className="dialog-sidenav__label">{item.label}</span>
      {isSelected && <div className="dialog-sidenav__indicator" />}
    </button>
  );
}

export function DialogSideNav<T extends string = string>({
  items,
  selectedId,
  onSelectId,
  ariaLabel = 'Navigation',
  className = '',
}: DialogSideNavProps<T>) {
  const sidebarRef = React.useRef<HTMLElement>(null);
  const itemRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndexRef = React.useRef(0);

  // Initialize itemRefs array
  React.useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, items.length);
  }, [items.length]);

  // Update active index when selected ID changes
  React.useEffect(() => {
    const selectedIndex = items.findIndex((item) => item.id === selectedId);
    if (selectedIndex !== -1) {
      activeIndexRef.current = selectedIndex;
    }
  }, [selectedId, items]);

  return (
    <nav
      ref={sidebarRef}
      className={`dialog-sidenav ${className}`}
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation="vertical"
    >
      {items.map((item, index) => {
        const isSelected = selectedId === item.id;
        return (
          <DialogSideNavButton
            key={item.id}
            item={item}
            itemIndex={index}
            totalItems={items.length}
            isSelected={isSelected}
            onSelect={onSelectId}
            buttonRef={(el: HTMLButtonElement | null) => {
              itemRefs.current[index] = el;
            }}
            itemRefs={itemRefs}
            activeIndexRef={activeIndexRef}
          />
        );
      })}
    </nav>
  );
}

export default DialogSideNav;
