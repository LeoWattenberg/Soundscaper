import React from 'react';
import { ContextMenu } from '../ContextMenu/ContextMenu';
import { ContextMenuItem } from '../ContextMenuItem/ContextMenuItem';
import { useTheme } from '../ThemeProvider';
import './ClipContextMenu.css';

export interface ClipContextMenuProps {
  /**
   * Whether the menu is open
   */
  isOpen: boolean;

  /**
   * Callback when menu should close
   */
  onClose: () => void;

  /**
   * X position for the menu (in pixels)
   */
  x: number;

  /**
   * Y position for the menu (in pixels)
   */
  y: number;

  /**
   * Callback for renaming the clip
   */
  onRename?: () => void;

  /**
   * Callback for changing clip color (submenu will handle color selection)
   */
  onColorChange?: (color: string) => void;

  /**
   * Callback for cut action
   */
  onCut?: () => void;

  /**
   * Callback for copy action
   */
  onCopy?: () => void;

  /**
   * Callback for duplicate action
   */
  onDuplicate?: () => void;

  /**
   * Callback for delete action
   */
  onDelete?: () => void;

  /**
   * Callback for split action
   */
  onSplit?: () => void;

  /**
   * Callback for export clip action
   */
  onExport?: () => void;

  /**
   * Whether "Stretch with tempo changes" is enabled
   */
  stretchWithTempo?: boolean;

  /**
   * Callback for toggling stretch with tempo changes
   */
  onToggleStretchWithTempo?: () => void;

  /**
   * Callback for opening pitch and speed dialog
   */
  onOpenPitchSpeedDialog?: () => void;

  /**
   * Callback for rendering pitch and speed
   */
  onRenderPitchSpeed?: () => void;

  /**
   * Whether the "Group clips" item is enabled (≥2 clips selected).
   */
  canGroup?: boolean;

  /**
   * Whether the "Ungroup clips" item is enabled (right-click target is in a group).
   */
  canUngroup?: boolean;

  /**
   * Callback for grouping the currently-selected clips.
   */
  onGroup?: () => void;

  /**
   * Callback for ungrouping the right-clicked clip's group.
   */
  onUngroup?: () => void;

  /**
   * Whether to auto-focus first menu item (when opened via keyboard)
   */
  autoFocus?: boolean;
}

/**
 * ClipContextMenu - Context menu for audio clips
 * Shows options for clip manipulation like rename, color, cut, copy, etc.
 */
export const ClipContextMenu: React.FC<ClipContextMenuProps> = ({
  isOpen,
  onClose,
  x,
  y,
  onRename,
  onColorChange,
  onCut,
  onCopy,
  onDuplicate,
  onDelete,
  onSplit,
  onExport,
  stretchWithTempo = false,
  onToggleStretchWithTempo,
  onOpenPitchSpeedDialog,
  onRenderPitchSpeed,
  canGroup,
  canUngroup,
  onGroup,
  onUngroup,
  autoFocus = false,
}) => {
  const { theme } = useTheme();

  const style = {
    '--clip-context-menu-header-text': theme.foreground.text.secondary,
    '--clip-context-menu-header-border': theme.border.divider,
    '--clip-context-menu-divider-bg': theme.border.divider,
  } as React.CSSProperties;

  return (
    <ContextMenu isOpen={isOpen} onClose={onClose} x={x} y={y} className="clip-context-menu" autoFocus={autoFocus} style={style}>
      {/* Clip properties header */}
      <div className="clip-context-menu-header">Clip properties</div>

      {/* Rename clip */}
      <ContextMenuItem
        label="Rename clip"
        onClick={onRename}
        onClose={onClose}
      />

      {/* Clip color submenu */}
      <ContextMenuItem
        label="Clip color"
        hasSubmenu
        onClose={onClose}
      >
        <ContextMenuItem label="Blue" onClick={() => { onColorChange?.('blue'); onClose(); }} />
        <ContextMenuItem label="Green" onClick={() => { onColorChange?.('green'); onClose(); }} />
        <ContextMenuItem label="Yellow" onClick={() => { onColorChange?.('yellow'); onClose(); }} />
        <ContextMenuItem label="Orange" onClick={() => { onColorChange?.('orange'); onClose(); }} />
        <ContextMenuItem label="Red" onClick={() => { onColorChange?.('red'); onClose(); }} />
        <ContextMenuItem label="Purple" onClick={() => { onColorChange?.('purple'); onClose(); }} />
        <ContextMenuItem label="Pink" onClick={() => { onColorChange?.('pink'); onClose(); }} />
        <ContextMenuItem label="Gray" onClick={() => { onColorChange?.('gray'); onClose(); }} />
        <ContextMenuItem label="Teal" onClick={() => { onColorChange?.('teal'); onClose(); }} />
      </ContextMenuItem>

      {/* Divider */}
      <div className="clip-context-menu-divider" />

      {/* Edit actions */}
      <ContextMenuItem
        label="Cut"
        onClick={onCut}
        onClose={onClose}
        icon={<CutIcon />}
      />

      <ContextMenuItem
        label="Copy"
        onClick={onCopy}
        onClose={onClose}
        icon={<CopyIcon />}
      />

      <ContextMenuItem
        label="Duplicate"
        onClick={onDuplicate}
        onClose={onClose}
      />

      <ContextMenuItem
        label="Delete clip"
        onClick={onDelete}
        onClose={onClose}
      />

      {/* Divider */}
      <div className="clip-context-menu-divider" />

      {/* Group / Ungroup */}
      <ContextMenuItem
        label="Group clips"
        onClick={() => { onGroup?.(); onClose(); }}
        disabled={!canGroup}
      />

      <ContextMenuItem
        label="Ungroup clips"
        onClick={() => { onUngroup?.(); onClose(); }}
        disabled={!canUngroup}
      />

      {/* Divider */}
      <div className="clip-context-menu-divider" />

      {/* Split */}
      <ContextMenuItem
        label="Split"
        onClick={onSplit}
        onClose={onClose}
      />

      {/* Spectral editing submenu */}
      <ContextMenuItem
        label="Spectral editing"
        hasSubmenu
        onClose={onClose}
      >
        <ContextMenuItem label="Toggle Spectral View" onClick={() => { console.log('Toggle Spectral View'); onClose(); }} />
        <ContextMenuItem label="Spectral Delete" onClick={() => { console.log('Spectral Delete'); onClose(); }} />
        <ContextMenuItem label="Spectral Smoothing" onClick={() => { console.log('Spectral Smoothing'); onClose(); }} />
      </ContextMenuItem>

      {/* Export clip (disabled) */}
      <ContextMenuItem
        label="Export clip"
        onClick={onExport}
        disabled
        onClose={onClose}
      />

      {/* Divider */}
      <div className="clip-context-menu-divider" />

      {/* Stretch with tempo changes (with checkmark) */}
      <ContextMenuItem
        label="Stretch with tempo changes"
        onClick={onToggleStretchWithTempo}
        onClose={onClose}
        icon={stretchWithTempo ? <CheckIcon /> : null}
      />

      {/* Pitch and speed */}
      <ContextMenuItem
        label="Open pitch and speed dialog"
        onClick={onOpenPitchSpeedDialog}
        onClose={onClose}
      />

      <ContextMenuItem
        label="Render pitch and speed"
        onClick={onRenderPitchSpeed}
        onClose={onClose}
      />
    </ContextMenu>
  );
};

// Icon components
const CutIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M9.5 7L14 2.5L13.5 2L9 6.5L4.5 2L4 2.5L8.5 7L4 11.5L4.5 12L9 7.5L13.5 12L14 11.5L9.5 7Z" />
  </svg>
);

const CopyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M11 3V1H3v8h2v6h8V7h2V3h-4zM4 8V2h6v1H6v5H4zm9 6H7V4h6v10z" />
  </svg>
);

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M14 4L6 12L2 8l1-1 3 3 7-7 1 1z" />
  </svg>
);
