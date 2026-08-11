/**
 * Table - Generic table component
 */

import React from 'react';
import { useTheme } from '../ThemeProvider';
import './Table.css';

export interface TableProps {
  /**
   * Table content (TableHeader and TableBody)
   */
  children: React.ReactNode;
  /**
   * Optional className
   */
  className?: string;
  /**
   * Minimum height for table body
   */
  minBodyHeight?: string | number;
  /**
   * Maximum height for table body
   */
  maxBodyHeight?: string | number;
}

/**
 * Table component - Container for table structure
 */
export function Table({
  children,
  className = '',
  minBodyHeight,
  maxBodyHeight,
}: TableProps) {
  const { theme } = useTheme();

  const style = {
    '--table-bg': theme.background.table.background,
    '--table-header-bg': theme.background.table.header.background,
    '--table-header-text': theme.background.table.header.text,
    '--table-header-border': theme.background.table.header.border,
    '--table-row-bg': theme.background.table.row.idle,
    '--table-row-hover-bg': theme.background.table.row.hover,
    '--table-row-text': theme.background.table.row.text,
    '--table-row-border': theme.background.table.row.border,
    '--table-cell-secondary-text': theme.background.table.cell.textSecondary,
    ...(minBodyHeight && { '--table-body-min-height': typeof minBodyHeight === 'number' ? `${minBodyHeight}px` : minBodyHeight }),
    ...(maxBodyHeight && { '--table-body-max-height': typeof maxBodyHeight === 'number' ? `${maxBodyHeight}px` : maxBodyHeight }),
  } as React.CSSProperties;

  return (
    <div className={`table ${className}`} style={style}>
      {children}
    </div>
  );
}

export default Table;
