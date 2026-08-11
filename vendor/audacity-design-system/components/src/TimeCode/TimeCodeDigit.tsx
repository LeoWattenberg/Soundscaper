import React from 'react';
import './TimeCodeDigit.css';

export type TimeCodeDigitState = 'default' | 'hover' | 'active';

export interface TimeCodeDigitProps {
  /**
   * The digit value to display (0-9)
   */
  value: string;
  /**
   * Current state of the digit
   * @default 'default'
   */
  state?: TimeCodeDigitState;
  /**
   * Whether the digit is editable
   * @default true
   */
  editable?: boolean;
  /**
   * Click handler
   */
  onClick?: () => void;
  /**
   * Mouse enter handler
   */
  onMouseEnter?: () => void;
  /**
   * Mouse leave handler
   */
  onMouseLeave?: () => void;
  /**
   * Optional className
   */
  className?: string;
  /**
   * Tab index for keyboard navigation
   */
  tabIndex?: number;
}

/**
 * TimeCodeDigit - Individual digit component for timecode display
 * States: default (idle), hover, active (editing)
 */
export const TimeCodeDigit = React.forwardRef<HTMLSpanElement, TimeCodeDigitProps>(
  function TimeCodeDigit(
    {
      value,
      state = 'default',
      editable = true,
      onClick,
      onMouseEnter,
      onMouseLeave,
      className = '',
      tabIndex,
    },
    ref
  ) {
    const stateClass = `timecode-digit--${state}`;
    const editableClass = !editable ? 'timecode-digit--readonly' : '';

    return (
      <span
        ref={ref}
        className={`timecode-digit ${stateClass} ${editableClass} ${className}`}
        onClick={editable ? onClick : undefined}
        onMouseEnter={editable ? onMouseEnter : undefined}
        onMouseLeave={editable ? onMouseLeave : undefined}
        data-state={state}
        tabIndex={tabIndex}
      >
        {value}
      </span>
    );
  }
);
