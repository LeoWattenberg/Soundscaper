/**
 * TableHeader - Table header container
 */

import React from 'react';
import './Table.css';

export interface TableHeaderProps {
  /**
   * Header cells
   */
  children: React.ReactNode;
  /**
   * Optional className
   */
  className?: string;
}

/**
 * TableHeader component
 */
export function TableHeader({ children, className = '' }: TableHeaderProps) {
  return (
    <div className={`table__header ${className}`}>
      <div className="table__header-row">
        {children}
      </div>
    </div>
  );
}

export default TableHeader;
