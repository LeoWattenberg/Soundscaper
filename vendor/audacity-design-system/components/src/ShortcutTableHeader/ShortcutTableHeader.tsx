import React from 'react';
import './ShortcutTableHeader.css';

export interface ShortcutTableHeaderProps {
  /**
   * Additional CSS classes
   */
  className?: string;
}

export const ShortcutTableHeader: React.FC<ShortcutTableHeaderProps> = ({
  className = '',
}) => {
  return (
    <div className={`shortcut-table-header ${className}`}>
      <div className="shortcut-table-header__cell">Action</div>
      <div className="shortcut-table-header__cell">Shortcut</div>
      <div className="shortcut-table-header__scrollbar-spacer"></div>
    </div>
  );
};

export default ShortcutTableHeader;
