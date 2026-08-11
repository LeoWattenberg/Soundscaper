/**
 * TableHeaderCell - Table header cell with optional sorting
 */

import React from 'react';
import { Icon } from '../Icon';
import './Table.css';

export type SortDirection = 'asc' | 'desc' | null;

export interface TableHeaderCellProps {
  /**
   * Cell content
   */
  children?: React.ReactNode;
  /**
   * Whether this column is sortable
   */
  sortable?: boolean;
  /**
   * Current sort direction
   */
  sortDirection?: SortDirection;
  /**
   * Callback when sort is requested
   */
  onSort?: () => void;
  /**
   * Column width (flex-basis)
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
   * Optional className
   */
  className?: string;
}

/**
 * TableHeaderCell component
 */
export function TableHeaderCell({
  children,
  sortable = false,
  sortDirection = null,
  onSort,
  width,
  flexGrow = false,
  align = 'left',
  className = '',
}: TableHeaderCellProps) {
  const style: React.CSSProperties = {
    ...(width && { flex: `0 0 ${typeof width === 'number' ? `${width}px` : width}`, width: typeof width === 'number' ? `${width}px` : width }),
    ...(flexGrow && !width && { flex: 1, minWidth: 0 }),
    textAlign: align,
  };

  const cellClasses = [
    'table__header-cell',
    sortable && 'table__header-cell--sortable',
    sortDirection && 'table__header-cell--sorted',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div
      className={cellClasses}
      style={style}
      onClick={sortable ? onSort : undefined}
    >
      {children}
      {sortable && (
        <span
          className="table__sort-indicator"
          style={{
            ...(sortDirection === 'asc' && { transform: 'rotate(180deg)' }),
          }}
        >
          <Icon name="caret-down" size={16} />
        </span>
      )}
    </div>
  );
}

export default TableHeaderCell;
