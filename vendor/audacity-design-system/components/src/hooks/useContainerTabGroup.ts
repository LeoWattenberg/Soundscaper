/**
 * useContainerTabGroup Hook
 *
 * Container-level roving tabindex that discovers focusable elements via DOM queries.
 * Companion to useTabGroup (per-item hook) — shares the same AccessibilityProfileContext
 * and profile config, but operates on a container ref instead of per-item refs.
 *
 * Use this when the container receives dynamic children and focusable elements
 * are discovered at runtime (e.g., Toolbar, SelectionToolbar, TrackNew clips).
 */

import React, { useCallback, useRef } from 'react';
import { useAccessibilityProfile } from '../contexts/AccessibilityProfileContext';

const DEFAULT_SELECTOR = 'button, select, input, [role="group"]';

export interface UseContainerTabGroupOptions {
  /** Ref to the container element */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Tab group ID — looked up in the active profile's tabGroups config */
  groupId: string;
  /** CSS selector for focusable elements */
  selector?: string;
  /** Optional filter to exclude elements (return false to skip) */
  filter?: (el: HTMLElement) => boolean;
  /** aria-label for the container */
  ariaLabel?: string;
  /** Override startTabIndex (default: resolved from profile tabOrder[groupId], then 0) */
  startTabIndex?: number;
}

export interface UseContainerTabGroupReturn {
  /** Keyboard handler — spread onto the container */
  onKeyDown: (e: React.KeyboardEvent) => void;
  /** Blur handler — spread onto the container */
  onBlur: (e: React.FocusEvent) => void;
  /** Focus handler — updates roving tabindex when a child receives focus (e.g. programmatic focus restoration) */
  onFocus: (e: React.FocusEvent) => void;
  /** Click capture handler — updates roving tabindex when a child is clicked (without focusing) */
  onClickCapture: (e: React.MouseEvent) => void;
  /** Resolved startTabIndex from profile tabOrder[groupId] */
  startTabIndex: number;
  /** Props to spread on the container element */
  containerProps: {
    role: string | undefined;
    'aria-label': string | undefined;
  };
  /** Call after mount and when children change to set initial tabIndex values */
  initTabIndices: () => void;
}

/** Check if an element or any ancestor is hidden */
function isElementHidden(el: HTMLElement): boolean {
  let current: HTMLElement | null = el;
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

/** Query visible focusable elements inside the container */
function getFocusables(
  container: HTMLElement,
  selector: string,
  filter?: (el: HTMLElement) => boolean,
): HTMLElement[] {
  const all = container.querySelectorAll<HTMLElement>(selector);
  return Array.from(all).filter((el) => {
    if (filter && !filter(el)) return false;
    return !isElementHidden(el);
  });
}

export function useContainerTabGroup({
  containerRef,
  groupId,
  selector = DEFAULT_SELECTOR,
  filter,
  ariaLabel,
  startTabIndex: startTabIndexProp,
}: UseContainerTabGroupOptions): UseContainerTabGroupReturn {
  const { activeProfile } = useAccessibilityProfile();
  const groupConfig = activeProfile.config.tabGroups[groupId];

  // Resolve startTabIndex: explicit prop > profile tabOrder > 0
  const startTabIndex = startTabIndexProp ?? activeProfile.config.tabOrder?.[groupId] ?? 0;

  // Fall back to default roving behavior when groupId isn't in profile
  const isRoving = groupConfig ? groupConfig.tabindex === 'roving' : true;
  const useArrows = groupConfig ? groupConfig.arrows : true;
  const wrap = groupConfig ? groupConfig.wrap : true;

  // Track whether we're inside a programmatic focus to avoid re-entrant blur resets
  const focusingRef = useRef(false);

  // Persisted active roving index — survives re-renders triggered by selection changes
  const activeIndexRef = useRef(0);

  /** Set initial tabIndex values on all focusable children */
  const initTabIndices = useCallback(() => {
    if (!containerRef.current) return;
    const focusables = getFocusables(containerRef.current, selector, filter);
    const active = Math.min(activeIndexRef.current, Math.max(0, focusables.length - 1));

    focusables.forEach((el, index) => {
      if (isRoving) {
        el.setAttribute('tabindex', index === active ? String(startTabIndex) : '-1');
      } else {
        el.setAttribute('tabindex', '0');
      }
    });
  }, [containerRef, selector, filter, isRoving, startTabIndex]);

  /** Arrow key + Home/End navigation */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!useArrows) return;
      if (e.defaultPrevented) return;

      const arrowKeys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
      const navKeys = [...arrowKeys, 'Home', 'End'];

      if (!navKeys.includes(e.key)) return;
      if (!containerRef.current) return;

      const focusables = getFocusables(containerRef.current, selector, filter);
      if (focusables.length === 0) return;

      const currentIndex = focusables.indexOf(document.activeElement as HTMLElement);
      if (currentIndex === -1) return;

      let nextIndex: number;

      if (e.key === 'Home') {
        nextIndex = 0;
      } else if (e.key === 'End') {
        nextIndex = focusables.length - 1;
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        nextIndex = wrap
          ? (currentIndex + 1) % focusables.length
          : Math.min(currentIndex + 1, focusables.length - 1);
      } else {
        // ArrowLeft / ArrowUp
        nextIndex = wrap
          ? (currentIndex - 1 + focusables.length) % focusables.length
          : Math.max(currentIndex - 1, 0);
      }

      if (nextIndex === currentIndex) return;

      e.preventDefault();

      if (isRoving) {
        focusables[currentIndex].tabIndex = -1;
        focusables[nextIndex].tabIndex = startTabIndex;
        activeIndexRef.current = nextIndex;
      }

      focusingRef.current = true;
      focusables[nextIndex].focus({ preventScroll: true });
      focusingRef.current = false;
    },
    [containerRef, selector, filter, useArrows, wrap, isRoving, startTabIndex],
  );

  /** Update roving tabindex when a focusable child is clicked (without moving DOM focus).
   *  Sets the *next* sibling as the active tab stop so Tab advances past the clicked item. */
  const onClickCapture = useCallback(
    (e: React.MouseEvent) => {
      if (!isRoving || !containerRef.current) return;
      const target = (e.target as HTMLElement).closest(selector);
      if (!target || !containerRef.current.contains(target as HTMLElement)) return;

      const focusables = getFocusables(containerRef.current, selector, filter);
      const targetIndex = focusables.indexOf(target as HTMLElement);
      if (targetIndex === -1) return;

      activeIndexRef.current = targetIndex;

      focusables.forEach((el, i) => {
        el.tabIndex = i === targetIndex ? startTabIndex : -1;
      });
    },
    [containerRef, selector, filter, isRoving, startTabIndex],
  );

  /** Reset first element to startTabIndex when focus leaves the container */
  const onBlur = useCallback(
    (e: React.FocusEvent) => {
      if (!isRoving) return;
      if (focusingRef.current) return;

      const relatedTarget = e.relatedTarget as HTMLElement | null;
      if (containerRef.current?.contains(relatedTarget)) return;

      // Focus left the container — reset
      activeIndexRef.current = 0;
      const focusables = getFocusables(containerRef.current!, selector, filter);
      focusables.forEach((el, index) => {
        el.tabIndex = index === 0 ? startTabIndex : -1;
      });
    },
    [containerRef, selector, filter, isRoving, startTabIndex],
  );

  /** Update roving tabindex when a child receives focus (e.g. programmatic focus restoration) */
  const onFocus = useCallback(
    (e: React.FocusEvent) => {
      if (!isRoving || !containerRef.current) return;
      if (focusingRef.current) return;

      const target = e.target as HTMLElement;
      // Ignore focus on the container itself
      if (target === containerRef.current) return;

      const focusables = getFocusables(containerRef.current, selector, filter);
      const targetIndex = focusables.indexOf(target);
      if (targetIndex === -1) return;

      activeIndexRef.current = targetIndex;
      focusables.forEach((el, i) => {
        el.tabIndex = i === targetIndex ? startTabIndex : -1;
      });
    },
    [containerRef, selector, filter, isRoving, startTabIndex],
  );

  const containerProps = {
    role: isRoving ? 'toolbar' as string | undefined : undefined,
    'aria-label': isRoving ? ariaLabel : undefined,
  };

  return {
    onKeyDown,
    onBlur,
    onFocus,
    onClickCapture,
    startTabIndex,
    containerProps,
    initTabIndices,
  };
}
