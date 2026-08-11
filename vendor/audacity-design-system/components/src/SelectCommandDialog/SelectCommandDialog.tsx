/**
 * SelectCommandDialog - Modal for selecting macro commands
 * Based on Figma design: node-id=6516-10614
 */

import React, { useState } from 'react';
import { Dialog } from '../Dialog';
import { Button } from '../Button';
import { Icon } from '../Icon';
import './SelectCommandDialog.css';

export interface Command {
  id: string;
  name: string;
  category: string;
}

export interface SelectCommandDialogProps {
  /**
   * Whether the dialog is open
   */
  isOpen: boolean;
  /**
   * Callback when dialog should close
   */
  onClose?: () => void;
  /**
   * Callback when a command is selected
   */
  onSelectCommand?: (command: Command) => void;
  /**
   * Available commands
   */
  commands: Command[];
  /**
   * Operating system for platform-specific header controls
   */
  os?: 'macos' | 'windows';
}

/**
 * SelectCommandDialog component
 */
export function SelectCommandDialog({
  isOpen,
  onClose,
  onSelectCommand,
  commands,
  os = 'macos',
}: SelectCommandDialogProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCommand, setSelectedCommand] = useState<Command | null>(null);

  // Filter commands based on search query
  const filteredCommands = commands.filter(cmd =>
    cmd.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Group commands by first letter
  const groupedCommands = filteredCommands.reduce((acc, cmd) => {
    const firstLetter = cmd.name[0].toUpperCase();
    if (!acc[firstLetter]) {
      acc[firstLetter] = [];
    }
    acc[firstLetter].push(cmd);
    return acc;
  }, {} as Record<string, Command[]>);

  // Sort letters alphabetically
  const sortedLetters = Object.keys(groupedCommands).sort();

  const handleCommandClick = (command: Command) => {
    setSelectedCommand(command);
  };

  const handleAddCommand = () => {
    if (selectedCommand) {
      onSelectCommand?.(selectedCommand);
      setSelectedCommand(null);
      setSearchQuery('');
      onClose?.();
    }
  };

  const handleClearSearch = () => {
    setSearchQuery('');
  };

  const handleClose = () => {
    setSelectedCommand(null);
    setSearchQuery('');
    onClose?.();
  };

  return (
    <Dialog
      isOpen={isOpen}
      title="Select command"
      onClose={handleClose}
      os={os}
      width={720}
      minHeight={600}
      customLayout
      className="select-command-dialog"
    >
      {/* Header with search */}
      <div className="select-command-dialog__header">
        <div className="select-command-dialog__search-container">
          <Icon name="zoom-in" size={16} />
          <input
            type="text"
            className="select-command-dialog__search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder=""
            autoFocus
          />
          {searchQuery && (
            <button
              className="select-command-dialog__clear-button"
              onClick={handleClearSearch}
              aria-label="Clear search"
            >
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Command list */}
      <div className="select-command-dialog__body">
        <div className="select-command-dialog__command-list">
          {sortedLetters.map((letter) => (
            <div key={letter} className="select-command-dialog__group">
              <div className="select-command-dialog__divider">
                <span className="select-command-dialog__divider-label">{letter}</span>
              </div>
              <div className="select-command-dialog__commands">
                {groupedCommands[letter].map((command) => (
                  <div
                    key={command.id}
                    className={`select-command-dialog__command-item ${
                      selectedCommand?.id === command.id ? 'select-command-dialog__command-item--selected' : ''
                    }`}
                    onClick={() => handleCommandClick(command)}
                  >
                    {command.name}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="select-command-dialog__footer">
        <Button
          variant="secondary"
          size="default"
          onClick={() => {}}
          disabled={!selectedCommand}
        >
          Edit parameters
        </Button>
        <Button
          variant="primary"
          size="default"
          onClick={handleAddCommand}
          disabled={!selectedCommand}
        >
          Add command
        </Button>
      </div>
    </Dialog>
  );
}

export default SelectCommandDialog;
