/**
 * TableRow - Table row component
 */

import React from 'react';
import './Table.css';

export interface TableRowProps {
  /**
   * Row cells
   */
  children: React.ReactNode;
  /**
   * Whether row is selected
   */
  selected?: boolean;
  /**
   * Click handler
   */
  onClick?: () => void;
  /**
   * Optional className
   */
  className?: string;
}

/**
 * TableRow component
 */
export function TableRow({
  children,
  selected = false,
  onClick,
  className = '',
}: TableRowProps) {
  const rowClasses = [
    'table__row',
    selected && 'table__row--selected',
    onClick && 'table__row--clickable',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={rowClasses} onClick={onClick}>
      {children}
    </div>
  );
}

export default TableRow;
