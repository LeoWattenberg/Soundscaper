import React from 'react';
import './ShortcutTableRow.css';

export interface ShortcutTableRowProps {
  /**
   * Action/command name
   */
  action: string;
  /**
   * Keyboard shortcut
   */
  shortcut: string;
  /**
   * Whether this row is selected
   */
  selected?: boolean;
  /**
   * Click handler
   */
  onClick?: () => void;
  /**
   * Additional CSS classes
   */
  className?: string;
}

export const ShortcutTableRow: React.FC<ShortcutTableRowProps> = ({
  action,
  shortcut,
  selected = false,
  onClick,
  className = '',
}) => {
  return (
    <div
      className={`shortcut-table-row ${selected ? 'shortcut-table-row--selected' : ''} ${className}`}
      onClick={onClick}
    >
      <div className="shortcut-table-row__action">{action}</div>
      <div className="shortcut-table-row__shortcut">{shortcut}</div>
    </div>
  );
};

export default ShortcutTableRow;
