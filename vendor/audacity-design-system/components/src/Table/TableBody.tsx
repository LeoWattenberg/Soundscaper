/**
 * TableBody - Table body container with scroll support
 */

import React from 'react';
import './Table.css';

export interface TableBodyProps {
  /**
   * Table rows
   */
  children: React.ReactNode;
  /**
   * Optional className
   */
  className?: string;
}

/**
 * TableBody component
 */
export function TableBody({ children, className = '' }: TableBodyProps) {
  return (
    <div className={`table__body ${className}`}>
      {children}
    </div>
  );
}

export default TableBody;
