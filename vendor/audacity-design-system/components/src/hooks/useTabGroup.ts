/**
 * useTabGroup Hook
 *
 * Manages keyboard navigation within a tab group based on active accessibility profile
 */

import React, { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { useAccessibilityProfile } from '../contexts/AccessibilityProfileContext';

export interface UseTabGroupOptions {
  /**
   * Unique identifier for this tab group
   */
  groupId: string;

  /**
   * Index of this item within the group
   */
  itemIndex: number;

  /**
   * Total number of items in the group
   */
  totalItems: number;

  /**
   * Callback when this item receives focus
   */
  onFocus?: () => void;

  /**
   * Ref to the element array for focusing
   */
  itemRefs?: React.RefObject<(HTMLElement | null)[]>;

  /**
   * Callback when an item is activated (e.g., by arrow keys in sidebar)
   * Used for sidebar navigation that changes pages
   */
  onItemActivate?: (index: number) => void;

  /**
   * Shared ref for tracking active index across all items in the group
   */
  activeIndexRef?: React.MutableRefObject<number>;

  /**
   * Active index state (for triggering re-renders)
   */
  activeIndex?: number;

  /**
   * Reset key - when this changes, active index resets to 0
   */
  resetKey?: string | number;

  /**
   * Base tabIndex for the active item in roving mode.
   * When omitted, auto-resolved from the active profile's tabOrder[groupId].
   */
  baseTabIndex?: number;
}

export interface UseTabGroupReturn {
  /**
   * tabIndex value for this element
   */
  tabIndex: number;

  /**
   * Keyboard event handler
   */
  onKeyDown?: (e: React.KeyboardEvent) => void;

  /**
   * Focus event handler
   */
  onFocus?: (e: React.FocusEvent) => void;

  /**
   * Blur event handler
   */
  onBlur?: (e: React.FocusEvent) => void;

  /**
   * Whether this item is the active item in the group
   */
  isActive: boolean;

  /**
   * Active index within the group
   */
  activeIndex: number;

  /**
   * Set the active index
   */
  setActiveIndex: (index: number) => void;
}

/**
 * Hook for managing tab group keyboard navigation
 */
export function useTabGroup({
  groupId,
  itemIndex,
  totalItems,
  onFocus,
  itemRefs,
  onItemActivate,
  activeIndexRef: providedActiveIndexRef,
  activeIndex: providedActiveIndex,
  resetKey,
  baseTabIndex: baseTabIndexProp,
}: UseTabGroupOptions): UseTabGroupReturn {
  const { activeProfile } = useAccessibilityProfile();
  const groupConfig = activeProfile.config.tabGroups[groupId];

  // Auto-resolve baseTabIndex from profile when not explicitly provided
  const baseTabIndex = baseTabIndexProp ?? activeProfile.config.tabOrder?.[groupId] ?? 0;

  // Track active index for roving tabindex
  // Use provided ref if available, otherwise create a local one
  const localActiveIndexRef = useRef(0);
  const activeIndexRef = providedActiveIndexRef || localActiveIndexRef;

  // Local state to trigger re-renders when active index changes
  const [localActiveIndex, setLocalActiveIndex] = useState(0);

  // Reset to first item when resetKey changes
  useEffect(() => {
    if (resetKey !== undefined) {
      activeIndexRef.current = 0;
      setLocalActiveIndex(0);
    }
  }, [resetKey]);

  // Use provided active index state if available, otherwise use local state
  const currentActiveIndex = providedActiveIndex !== undefined ? providedActiveIndex : localActiveIndex;

  // Determine tabIndex for this item
  const tabIndex = useMemo(() => {
    if (!groupConfig) {
      return 0;
    }

    if (groupConfig.tabindex === 'roving') {
      // Only the active item gets the baseTabIndex
      return itemIndex === currentActiveIndex ? baseTabIndex : -1;
    }

    // Sequential: all items get tabindex="0"
    return 0;
  }, [groupConfig, itemIndex, currentActiveIndex, baseTabIndex]);

  // Focus an item by index
  // Check if an element is hidden
  const isElementHidden = useCallback((element: HTMLElement): boolean => {
    let currentEl: HTMLElement | null = element;
    while (currentEl && currentEl !== document.body) {
      const style = window.getComputedStyle(currentEl);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return true;
      }
      currentEl = currentEl.parentElement;
    }
    return false;
  }, []);

  const focusItem = useCallback(
    (index: number, skipHidden: boolean = false): boolean => {
      if (!itemRefs?.current) return false;

      const element = itemRefs.current[index];
      if (element) {
        // Check if element or any of its parents are hidden
        if (skipHidden && isElementHidden(element)) {
          return false;
        }

        // If element has a querySelector method, it's likely a wrapper div
        // Find the focusable element within it
        if ('querySelector' in element && typeof element.querySelector === 'function') {
          const focusableElement = element.querySelector<HTMLElement>(
            'button, [href], input, select, textarea, [role="checkbox"], [role="radio"]'
          );
          if (focusableElement) {
            focusableElement.focus();
            return true;
          }
        }
        // Otherwise, focus the element directly
        element.focus();
        return true;
      }
      return false;
    },
    [itemRefs, isElementHidden]
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!groupConfig || !groupConfig.arrows) return;

      let handled = false;
      let newIndex = activeIndexRef.current;

      // Arrow key navigation
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        newIndex = activeIndexRef.current + 1;
        if (groupConfig.wrap) {
          newIndex = newIndex % totalItems;
        } else {
          newIndex = Math.min(newIndex, totalItems - 1);
        }
        handled = true;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        newIndex = activeIndexRef.current - 1;
        if (groupConfig.wrap) {
          newIndex = (newIndex + totalItems) % totalItems;
        } else {
          newIndex = Math.max(newIndex, 0);
        }
        handled = true;
      } else if (e.key === 'Home') {
        newIndex = 0;
        handled = true;
      } else if (e.key === 'End') {
        newIndex = totalItems - 1;
        handled = true;
      }

      if (handled) {
        e.preventDefault();

        // Try to focus the item, skipping if it's hidden
        let finalIndex = newIndex;
        let focused = focusItem(newIndex, true);

        // If the item is hidden, try to find the next visible item in the direction we're moving
        if (!focused) {
          const direction = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
          let attempts = 0;
          const maxAttempts = totalItems;

          while (!focused && attempts < maxAttempts) {
            finalIndex += direction;

            // Handle wrapping
            if (groupConfig.wrap) {
              finalIndex = (finalIndex + totalItems) % totalItems;
            } else {
              // If not wrapping and we've reached the edge, stop
              if (finalIndex < 0 || finalIndex >= totalItems) {
                // Stay at current index if no visible item found
                finalIndex = activeIndexRef.current;
                break;
              }
            }

            focused = focusItem(finalIndex, true);
            attempts++;
          }
        }

        activeIndexRef.current = finalIndex;
        setLocalActiveIndex(finalIndex);

        // Notify parent that item was activated (e.g., for changing pages)
        if (onItemActivate) {
          onItemActivate(finalIndex);
        }
      }
    },
    [groupConfig, totalItems, focusItem, onItemActivate]
  );

  // Set active index programmatically
  const setActiveIndex = useCallback(
    (index: number) => {
      activeIndexRef.current = index;
      setLocalActiveIndex(index);
      focusItem(index);
    },
    [focusItem]
  );

  // Track if focus is currently within this group
  const groupHasFocusRef = useRef(false);
  // Track the last focused element to prevent unwanted resets
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);

  // Update active index when this item receives focus
  useEffect(() => {
    if (itemIndex === activeIndexRef.current && onFocus) {
      onFocus();
    }
  }, [itemIndex, onFocus]);

  // Focus handler to update active index and reset when entering from outside
  const handleFocus = useCallback((e: React.FocusEvent) => {
    const currentElement = e.currentTarget as HTMLElement;
    const relatedTarget = e.relatedTarget as HTMLElement | null;

    // If focus is returning to the same element that just had it (e.g., dropdown closing),
    // don't reset to first item
    if (lastFocusedElementRef.current === currentElement) {
      lastFocusedElementRef.current = currentElement;
      // Just ensure activeIndex is correct
      activeIndexRef.current = itemIndex;
      setLocalActiveIndex(itemIndex);
      return;
    }

    // If focus came from a descendant (e.g., dropdown menu closing and returning to trigger),
    // don't reset to first item - just maintain current position
    if (relatedTarget && currentElement.contains(relatedTarget)) {
      lastFocusedElementRef.current = currentElement;
      activeIndexRef.current = itemIndex;
      setLocalActiveIndex(itemIndex);
      return;
    }

    // If the group already has focus and we're focusing an element at the SAME index
    // that's currently active (e.g., dropdown menu closing and programmatically returning
    // focus to its trigger), don't reset to first item
    if (groupHasFocusRef.current && activeIndexRef.current === itemIndex) {
      lastFocusedElementRef.current = currentElement;
      // Just maintain the active index
      return;
    }

    // If this is the first focus event for the group (coming from outside)
    if (!groupHasFocusRef.current) {
      groupHasFocusRef.current = true;

      // Check if focus came from outside the group
      const cameFromOutside = !relatedTarget || !itemRefs?.current?.some(el => el === relatedTarget || el?.contains(relatedTarget));

      // If entering from outside the group, reset to first item
      if (cameFromOutside && itemIndex !== 0 && itemRefs?.current) {
        // Reset to first item
        activeIndexRef.current = 0;
        setLocalActiveIndex(0);
        lastFocusedElementRef.current = currentElement;

        // Notify parent to update state
        if (onItemActivate) {
          onItemActivate(0);
        }

        focusItem(0);
        return;
      }
    }

    // Update active index to the item that received focus
    activeIndexRef.current = itemIndex;
    setLocalActiveIndex(itemIndex);
    lastFocusedElementRef.current = currentElement;
  }, [itemIndex, itemRefs, focusItem, onItemActivate]);

  // Blur handler to track when focus leaves the group
  const handleBlur = useCallback((e: React.FocusEvent) => {
    console.log(`[useTabGroup handleBlur] groupId=${groupId}, itemIndex=${itemIndex}`);
    // Use setTimeout to check if focus moved to another item in the group
    setTimeout(() => {
      if (itemRefs?.current) {
        const hasFocus = itemRefs.current.some(el => el && document.activeElement === el);

        // Also check if focus moved to a descendant of any group item (e.g., dropdown menu)
        const focusInDescendant = itemRefs.current.some(el => el && el.contains(document.activeElement));

        console.log(`[useTabGroup handleBlur setTimeout] groupId=${groupId}, itemIndex=${itemIndex}, hasFocus=${hasFocus}, focusInDescendant=${focusInDescendant}, document.activeElement=`, document.activeElement);

        if (!hasFocus && !focusInDescendant) {
          console.log(`[useTabGroup handleBlur] Clearing groupHasFocusRef`);
          groupHasFocusRef.current = false;
          lastFocusedElementRef.current = null;
        }
      }
    }, 0);
  }, [itemRefs, groupId, itemIndex]);

  return {
    tabIndex,
    onKeyDown: groupConfig?.arrows ? handleKeyDown : undefined,
    onFocus: groupConfig?.tabindex === 'roving' ? handleFocus : undefined,
    onBlur: groupConfig?.tabindex === 'roving' ? handleBlur : undefined,
    isActive: itemIndex === activeIndexRef.current,
    activeIndex: activeIndexRef.current,
    setActiveIndex,
  };
}
