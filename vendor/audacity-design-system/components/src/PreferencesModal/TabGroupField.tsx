import React, { useRef, useEffect } from 'react';
import { Button } from '../Button';
import { Dropdown } from '../Dropdown';
import { LabeledCheckbox } from '../LabeledCheckbox';
import { LabeledInput } from '../LabeledInput';
import { LabeledRadio } from '../LabeledRadio';
import { useTabGroup } from '../hooks/useTabGroup';

interface TabGroupFieldProps {
  groupId: string;
  itemIndex: number;
  totalItems: number;
  itemRefs: React.RefObject<(HTMLElement | null)[]>;
  activeIndexRef: React.MutableRefObject<number>;
  activeIndex?: number;
  onActiveIndexChange?: (index: number) => void;
  resetKey?: string | number;
  children: React.ReactNode;
}

/**
 * Wrapper component that applies tab group behavior to form fields
 */
export function TabGroupField({
  groupId,
  itemIndex,
  totalItems,
  itemRefs,
  activeIndexRef,
  activeIndex = 0,
  onActiveIndexChange,
  resetKey,
  children,
}: TabGroupFieldProps) {
  const fieldRef = useRef<HTMLDivElement>(null);

  const { tabIndex, onKeyDown, onFocus, onBlur } = useTabGroup({
    groupId,
    itemIndex,
    totalItems,
    itemRefs,
    activeIndexRef,
    activeIndex,
    resetKey,
    onItemActivate: (newIndex) => {
      onActiveIndexChange?.(newIndex);
    },
  });

  // Store ref to focusable element for navigation
  useEffect(() => {
    if (!fieldRef.current || !itemRefs.current) return;

    const focusableElement = fieldRef.current.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [role="checkbox"], [role="radio"]'
    );

    if (focusableElement) {
      // Store the fieldRef wrapper so blur handler can detect focus within descendants
      // (e.g., dropdown menus), but attach event listeners to the focusable element
      itemRefs.current[itemIndex] = fieldRef.current;

      const handlers: Array<{ type: string; handler: (e: Event) => void }> = [];

      // Add keyboard handler
      if (onKeyDown) {
        const keydownHandler = (e: Event) => {
          const keyEvent = e as KeyboardEvent;
          // Don't handle Space/Enter - let the element's own handler deal with it
          if (keyEvent.key === ' ' || keyEvent.key === 'Enter') {
            return;
          }
          onKeyDown(e as any); // justified: native Event → React.KeyboardEvent bridge — pending components sweep
        };
        focusableElement.addEventListener('keydown', keydownHandler);
        handlers.push({ type: 'keydown', handler: keydownHandler });
      }

      // Add focus handler
      if (onFocus) {
        const focusHandler = (e: Event) => {
          onFocus(e as any); // justified: native Event → React.FocusEvent bridge — pending components sweep
        };
        focusableElement.addEventListener('focus', focusHandler);
        handlers.push({ type: 'focus', handler: focusHandler });
      }

      // Add blur handler
      if (onBlur) {
        const blurHandler = (e: Event) => {
          onBlur(e as any); // justified: native Event → React.FocusEvent bridge — pending components sweep
        };
        focusableElement.addEventListener('blur', blurHandler);
        handlers.push({ type: 'blur', handler: blurHandler });
      }

      return () => {
        handlers.forEach(({ type, handler }) => {
          focusableElement.removeEventListener(type, handler);
        });
      };
    }
  }, [onKeyDown, onFocus, onBlur, itemIndex, itemRefs]);

  // Clone children and inject tabIndex prop into interactive components
  const childrenWithProps = React.Children.map(children, (child) => {
    if (React.isValidElement(child)) {
      // Check if it's a Dropdown, LabeledInput, LabeledCheckbox, LabeledRadio, NumberStepper, or Button component
      if (child.type === Dropdown) {
        return React.cloneElement(child as React.ReactElement<any>, { tabIndex }); // justified: cloneElement with extra props needs <any> — pending components sweep
      }
      // For LabeledInput, we need to pass tabIndex to the underlying input
      if ((child.type as any).name === 'LabeledInput' || child.type === LabeledInput) { // justified: runtime displayName check — pending components sweep
        return React.cloneElement(child as React.ReactElement<any>, { tabIndex }); // justified: cloneElement with extra props needs <any> — pending components sweep
      }
      // For LabeledCheckbox components
      if ((child.type as any).name === 'LabeledCheckbox' || child.type === LabeledCheckbox) { // justified: runtime displayName check — pending components sweep
        return React.cloneElement(child as React.ReactElement<any>, { tabIndex }); // justified: cloneElement with extra props needs <any> — pending components sweep
      }
      // For LabeledRadio components
      if ((child.type as any).name === 'LabeledRadio' || child.type === LabeledRadio) { // justified: runtime displayName check — pending components sweep
        return React.cloneElement(child as React.ReactElement<any>, { tabIndex }); // justified: cloneElement with extra props needs <any> — pending components sweep
      }
      // For NumberStepper components
      if ((child.type as any).name === 'NumberStepper') { // justified: runtime displayName check — pending components sweep
        return React.cloneElement(child as React.ReactElement<any>, { tabIndex }); // justified: cloneElement with extra props needs <any> — pending components sweep
      }
      // For Button components
      if (child.type === Button || (child.type as any).name === 'Button') { // justified: runtime displayName check — pending components sweep
        return React.cloneElement(child as React.ReactElement<any>, { tabIndex }); // justified: cloneElement with extra props needs <any> — pending components sweep
      }
    }
    return child;
  });

  // Check if children contain LabeledRadio - if so, don't add field classes
  const hasRadio = React.Children.toArray(children).some((child) => {
    if (React.isValidElement(child)) {
      return (child.type as any).name === 'LabeledRadio' || child.type === LabeledRadio; // justified: runtime displayName check — pending components sweep
    }
    return false;
  });

  return (
    <div ref={fieldRef} className={hasRadio ? '' : 'preferences-page__field preferences-page__field--small'}>
      {childrenWithProps}
    </div>
  );
}
