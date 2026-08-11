import { useEffect, RefObject } from 'react';

/**
 * Hook to trap focus within a container element
 * Ensures Tab navigation stays within the container
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement>,
  isActive: boolean = true
) {
  useEffect(() => {
    if (!isActive || !containerRef.current) return;

    const container = containerRef.current;

    // Get all tabbable elements within the container (tabindex >= 0)
    const getTabbableElements = (): HTMLElement[] => {
      const focusableSelectors = [
        'a[href]',
        'button:not([disabled])',
        'textarea:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        '[tabindex]',
      ];

      const elements = container.querySelectorAll<HTMLElement>(
        focusableSelectors.join(',')
      );

      return Array.from(elements).filter((el) => {
        if (el.hasAttribute('disabled') || el.offsetParent === null) return false;

        // Only include elements that are tabbable (tabindex >= 0)
        const tabindex = el.getAttribute('tabindex');
        if (tabindex !== null) {
          return parseInt(tabindex) >= 0;
        }

        // Default tabbable elements (buttons, inputs, etc without explicit tabindex)
        return true;
      });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const tabbableElements = getTabbableElements();
      if (tabbableElements.length === 0) return;

      const firstElement = tabbableElements[0];
      const lastElement = tabbableElements[tabbableElements.length - 1];
      const activeElement = document.activeElement as HTMLElement;

      // Check if active element is within the container
      if (!container.contains(activeElement)) return;

      // If shift+tab on first element, focus last element
      if (e.shiftKey && activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      }
      // If tab on last element, focus first element
      else if (!e.shiftKey && activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    };

    // Focus first element when dialog opens (without showing focus indicator)
    const tabbableElements = getTabbableElements();
    if (tabbableElements.length > 0) {
      // Small delay to ensure the dialog is fully rendered
      setTimeout(() => {
        const firstElement = tabbableElements[0];
        // Mark as programmatically focused to hide focus outline
        firstElement.setAttribute('data-focus-method', 'auto');
        firstElement.focus();
        // Remove the attribute on any user interaction
        const removeAutoFocus = () => {
          firstElement.removeAttribute('data-focus-method');
          firstElement.removeEventListener('keydown', removeAutoFocus);
          firstElement.removeEventListener('mousedown', removeAutoFocus);
        };
        firstElement.addEventListener('keydown', removeAutoFocus);
        firstElement.addEventListener('mousedown', removeAutoFocus);
      }, 10);
    }

    // Listen on document to catch all tab events
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [containerRef, isActive]);
}
