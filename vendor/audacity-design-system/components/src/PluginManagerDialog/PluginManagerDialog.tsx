/**
 * PluginManagerDialog - Dialog for managing audio plugins
 */

import React, { useState } from 'react';
import { Dialog } from '../Dialog';
import { Button } from '../Button';
import { Checkbox } from '../Checkbox';
import { SearchField } from '../SearchField';
import { Dropdown } from '../Dropdown';
import { Footer } from '../Footer';
import { Table } from '../Table/Table';
import { TableHeader } from '../Table/TableHeader';
import { TableHeaderCell } from '../Table/TableHeaderCell';
import { TableBody } from '../Table/TableBody';
import { TableRow } from '../Table/TableRow';
import { TableCell } from '../Table/TableCell';
import type { SortDirection } from '../Table/TableHeaderCell';
import { useTheme } from '../ThemeProvider';
import './PluginManagerDialog.css';

export type PluginType = 'Internal effect' | 'VST' | 'VST3' | 'LV2' | 'LADSPA' | 'Nyquist' | 'Audio unit';
export type PluginCategory = 'Effect' | 'Generator' | 'Analyzer' | 'Tool';

export interface Plugin {
  id: string;
  name: string;
  type: PluginType;
  category: PluginCategory;
  path: string;
  enabled: boolean;
}

export interface PluginManagerDialogProps {
  /**
   * Whether the dialog is open
   */
  isOpen: boolean;
  /**
   * Plugins to display
   */
  plugins: Plugin[];
  /**
   * Callback when plugins change
   */
  onChange?: (plugins: Plugin[]) => void;
  /**
   * Callback when dialog should close
   */
  onClose?: () => void;
  /**
   * Operating system for platform-specific header controls
   * @default 'macos'
   */
  os?: 'macos' | 'windows';
}

type SortColumn = 'name' | 'type' | null;

/**
 * PluginManagerDialog component
 */
export function PluginManagerDialog({
  isOpen,
  plugins,
  onChange,
  onClose,
  os = 'macos',
}: PluginManagerDialogProps) {
  const { theme } = useTheme();
  const [sortColumn, setSortColumn] = useState<SortColumn>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<PluginType | 'All'>('All');
  const [showFilter, setShowFilter] = useState<'All' | 'Enabled' | 'Disabled'>('All');

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      // Toggle direction if clicking same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new column with ascending direction
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const handleToggleEnabled = (pluginId: string) => {
    if (!onChange) return;

    const newPlugins = plugins.map(plugin =>
      plugin.id === pluginId ? { ...plugin, enabled: !plugin.enabled } : plugin
    );
    onChange(newPlugins);
  };

  // Filter and sort plugins
  const filteredPlugins = plugins.filter(plugin => {
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesSearch = (
        plugin.name.toLowerCase().includes(query) ||
        plugin.type.toLowerCase().includes(query) ||
        plugin.path.toLowerCase().includes(query)
      );
      if (!matchesSearch) return false;
    }

    // Type filter
    if (typeFilter !== 'All' && plugin.type !== typeFilter) {
      return false;
    }

    // Show filter
    if (showFilter === 'Enabled' && !plugin.enabled) {
      return false;
    }
    if (showFilter === 'Disabled' && plugin.enabled) {
      return false;
    }

    return true;
  });

  const sortedPlugins = [...filteredPlugins].sort((a, b) => {
    if (!sortColumn) return 0;

    let comparison = 0;
    if (sortColumn === 'name') {
      comparison = a.name.localeCompare(b.name);
    } else if (sortColumn === 'type') {
      comparison = a.type.localeCompare(b.type);
    }

    return sortDirection === 'asc' ? comparison : -comparison;
  });

  return (
    <Dialog
      isOpen={isOpen}
      title="Manage Plugins"
      onClose={onClose}
      width={800}
      minHeight={0}
      os={os}
      noPadding
      footer={
        <Footer
          leftContent={
            <>
              <Button variant="secondary" onClick={() => console.log('Rescan')}>
                Rescan
              </Button>
              <Button variant="secondary" onClick={() => console.log('Get more effects')}>
                Get more effects...
              </Button>
            </>
          }
          secondaryText="Cancel"
          primaryText="OK"
          onSecondaryClick={onClose}
          onPrimaryClick={onClose}
        />
      }
    >
      <div className="plugin-manager-filters" style={{ '--border-on-elevated': theme.border.onElevated } as React.CSSProperties}>
        <div className="plugin-manager-filters__row">
          <div className="plugin-manager-filters__left">
            <div className="plugin-manager-filter">
              <label className="plugin-manager-filter__label">Show:</label>
              <Dropdown
                value={showFilter}
                onChange={(value) => setShowFilter(value as 'All' | 'Enabled' | 'Disabled')}
                options={[
                  { value: 'All', label: 'All' },
                  { value: 'Enabled', label: 'Enabled' },
                  { value: 'Disabled', label: 'Disabled' },
                ]}
                width="88px"
              />
            </div>
            <div className="plugin-manager-filter">
              <label className="plugin-manager-filter__label">Type:</label>
              <Dropdown
                value={typeFilter}
                onChange={(value) => setTypeFilter(value as PluginType | 'All')}
                options={[
                  { value: 'All', label: 'All' },
                  { value: 'Internal effect', label: 'Internal effect' },
                  { value: 'VST', label: 'VST' },
                  { value: 'VST3', label: 'VST3' },
                  { value: 'LV2', label: 'LV2' },
                  { value: 'LADSPA', label: 'LADSPA' },
                  { value: 'Nyquist', label: 'Nyquist' },
                  { value: 'Audio unit', label: 'Audio unit' },
                ]}
                width="120px"
              />
            </div>
          </div>
          <SearchField
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search plugins..."
            width={240}
          />
        </div>
      </div>
      <Table minBodyHeight={480} maxBodyHeight={480}>
        <TableHeader>
          <TableHeaderCell width={80} align="center">
            Enabled
          </TableHeaderCell>
          <TableHeaderCell
            sortable
            sortDirection={sortColumn === 'name' ? sortDirection : null}
            onSort={() => handleSort('name')}
            width={250}
          >
            Name
          </TableHeaderCell>
          <TableHeaderCell flexGrow>
            Path
          </TableHeaderCell>
          <TableHeaderCell
            sortable
            sortDirection={sortColumn === 'type' ? sortDirection : null}
            onSort={() => handleSort('type')}
            width={120}
          >
            Type
          </TableHeaderCell>
        </TableHeader>
        <TableBody>
          {sortedPlugins.map((plugin) => (
            <TableRow key={plugin.id}>
              <TableCell width={80} align="center">
                <Checkbox
                  checked={plugin.enabled}
                  onChange={() => handleToggleEnabled(plugin.id)}
                />
              </TableCell>
              <TableCell width={250}>
                {plugin.name}
              </TableCell>
              <TableCell flexGrow>
                {plugin.path}
              </TableCell>
              <TableCell width={120}>
                {plugin.type}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Dialog>
  );
}

export default PluginManagerDialog;
