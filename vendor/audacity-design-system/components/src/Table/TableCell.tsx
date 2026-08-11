/**
 * TableCell - Table cell component
 */

import React from 'react';
import './Table.css';

export interface TableCellProps {
  /**
   * Cell content
   */
  children: React.ReactNode;
  /**
   * Column width (should match header width)
   */
  width?: string | number;
  /**
   * Whether column should grow to fill space
   */
  flexGrow?: boolean;
  /**
   * Text alignment
   */
  align?: 'left' | 'center' | 'right';
  /**
   * Use secondary text color
   */
  secondary?: boolean;
  /**
   * Optional className
   */
  className?: string;
}

/**
 * TableCell component
 */
export function TableCell({
  children,
  width,
  flexGrow = false,
  align = 'left',
  secondary = false,
  className = '',
}: TableCellProps) {
  const style: React.CSSProperties = {
    ...(width && { flex: `0 0 ${typeof width === 'number' ? `${width}px` : width}`, width: typeof width === 'number' ? `${width}px` : width }),
    ...(flexGrow && !width && { flex: 1, minWidth: 0 }),
    textAlign: align,
  };

  const cellClasses = [
    'table__cell',
    secondary && 'table__cell--secondary',
    align === 'center' && 'table__cell--center',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={cellClasses} style={style}>
      {children}
    </div>
  );
}

export default TableCell;
