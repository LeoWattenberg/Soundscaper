import React, { useRef, Children, cloneElement, isValidElement } from 'react';
import { useAccessibilityProfile } from '../contexts/AccessibilityProfileContext';
import './ToolbarGroup.css';

export interface ToolbarGroupProps {
  /**
   * Children elements (buttons) to be grouped
   */
  children: React.ReactNode;
  /**
   * Label for the group (for screen readers)
   */
  ariaLabel: string;
  /**
   * Optional className for custom styling
   */
  className?: string;
  /**
   * Starting tabIndex for the first element in the group.
   * When omitted, resolved from the active profile's tabOrder[tabGroupId].
   */
  startTabIndex?: number;
  /**
   * Tab group ID for resolving startTabIndex from the active profile
   */
  tabGroupId?: string;
}

/**
 * ToolbarGroup - Groups toolbar items with keyboard navigation
 * - First item has tabIndex={0}, others have tabIndex={-1}
 * - Arrow Left/Right/Up/Down moves focus within the group
 * - Enter/Space activates the focused item
 */
export function ToolbarGroup({
  children,
  ariaLabel,
  className = '',
  startTabIndex: startTabIndexProp,
  tabGroupId,
}: ToolbarGroupProps) {
  const groupRef = useRef<HTMLDivElement>(null);
  const { activeProfile } = useAccessibilityProfile();

  // Resolve startTabIndex from profile when not explicitly passed
  const startTabIndex = startTabIndexProp ?? (tabGroupId ? activeProfile.config.tabOrder?.[tabGroupId] ?? 0 : 0);

  // Check if we're in flat navigation mode
  const isFlatNavigation = activeProfile.config.tabNavigation === 'sequential';

  // Reset tabIndex to first element when focus leaves the group (only in tab group mode)
  const handleBlur = (e: React.FocusEvent) => {
    if (isFlatNavigation) return; // No tab group behavior in flat mode

    // Check if focus is moving outside the group
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    if (!groupRef.current?.contains(relatedTarget)) {
      // Focus left the group - reset tabIndex to first element
      const focusables = groupRef.current?.querySelectorAll('button, select, input, [tabindex]');
      if (focusables) {
        focusables.forEach((el, index) => {
          (el as HTMLElement).tabIndex = index === 0 ? startTabIndex : -1;
        });
      }
    }
  };

  // Handle keyboard navigation within the group
  const handleKeyDown = (e: React.KeyboardEvent, currentIndex: number, totalItems: number) => {
    // Only handle arrow keys - Tab/Shift+Tab should work naturally with roving tabindex
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) {
      return;
    }

    e.preventDefault();
    const focusables = groupRef.current?.querySelectorAll('button, select, input, [tabindex]');
    if (!focusables) return;

    let nextIndex: number;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % totalItems;
    } else {
      nextIndex = (currentIndex - 1 + totalItems) % totalItems;
    }

    // Update tabIndex: current element gets -1, next element gets startTabIndex
    (focusables[currentIndex] as HTMLElement).tabIndex = -1;
    (focusables[nextIndex] as HTMLElement).tabIndex = startTabIndex;
    (focusables[nextIndex] as HTMLElement).focus();
  };

  // Clone children and add keyboard navigation props
  const childArray = Children.toArray(children);
  const enhancedChildren = childArray.map((child, index) => {
    if (isValidElement(child)) {
      // In flat navigation, all elements get tabIndex=0
      // In grouped navigation, only first gets startTabIndex, others get -1
      const tabIndexValue = isFlatNavigation ? 0 : (index === 0 ? startTabIndex : -1);

      return cloneElement(child as React.ReactElement<any>, {
        tabIndex: tabIndexValue,
        onKeyDown: isFlatNavigation ? undefined : (e: React.KeyboardEvent) => {
          // Call original onKeyDown if it exists
          const originalOnKeyDown = (child as any).props?.onKeyDown;
          if (originalOnKeyDown) {
            originalOnKeyDown(e);
          }
          // Then handle group navigation (only in grouped mode)
          handleKeyDown(e, index, childArray.length);
        },
      });
    }
    return child;
  });

  return (
    <div
      ref={groupRef}
      className={`toolbar-group ${className}`}
      role="group"
      aria-label={ariaLabel}
      onBlur={handleBlur}
    >
      {enhancedChildren}
    </div>
  );
}
