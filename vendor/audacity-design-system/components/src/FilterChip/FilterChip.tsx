import React from 'react';
import './FilterChip.css';

export interface FilterChipProps {
  /**
   * The label text to display
   */
  label: string;
  /**
   * Whether the chip is selected/active
   * @default false
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

export const FilterChip: React.FC<FilterChipProps> = ({
  label,
  selected = false,
  onClick,
  className = '',
}) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick?.();
    }
  };

  return (
    <button
      type="button"
      className={`filter-chip ${selected ? 'filter-chip--selected' : ''} ${className}`}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role="checkbox"
      aria-checked={selected}
    >
      <span className="filter-chip__label">{label}</span>
    </button>
  );
};

export default FilterChip;
