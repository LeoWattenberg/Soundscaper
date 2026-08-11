import React, { useState } from 'react';
import { TabItem } from '../TabItem';
import './TabList.css';

export interface TabConfig {
  /**
   * Unique identifier for the tab
   */
  id: string;
  /**
   * Display label for the tab
   */
  label: string;
  /**
   * Optional icon element
   */
  icon?: React.ReactNode;
  /**
   * Whether this tab is disabled
   */
  disabled?: boolean;
}

export interface TabListProps {
  /**
   * Array of tab configurations
   */
  tabs: TabConfig[];
  /**
   * Currently selected tab ID
   */
  selectedTabId?: string;
  /**
   * Callback when a tab is selected
   */
  onTabSelect?: (tabId: string) => void;
  /**
   * Additional CSS class names
   */
  className?: string;
  /**
   * ARIA label for the tab list
   */
  ariaLabel?: string;
}

export const TabList: React.FC<TabListProps> = ({
  tabs,
  selectedTabId,
  onTabSelect,
  className = '',
  ariaLabel = 'Navigation tabs',
}) => {
  const [internalSelectedId, setInternalSelectedId] = useState<string>(
    selectedTabId || tabs[0]?.id || ''
  );

  // Use controlled or uncontrolled behavior
  const currentSelectedId = selectedTabId !== undefined ? selectedTabId : internalSelectedId;

  const handleTabClick = (tabId: string) => {
    if (selectedTabId === undefined) {
      setInternalSelectedId(tabId);
    }
    onTabSelect?.(tabId);
  };

  return (
    <div
      className={`tab-list ${className}`}
      role="tablist"
      aria-label={ariaLabel}
    >
      {tabs.map((tab) => (
        <TabItem
          key={tab.id}
          label={tab.label}
          icon={tab.icon}
          selected={currentSelectedId === tab.id}
          disabled={tab.disabled}
          onClick={() => !tab.disabled && handleTabClick(tab.id)}
          ariaLabel={tab.label}
        />
      ))}
    </div>
  );
};

export default TabList;
