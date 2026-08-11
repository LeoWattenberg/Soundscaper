import React from 'react';
import { ContextMenu } from '../ContextMenu/ContextMenu';
import { ContextMenuItem } from '../ContextMenuItem/ContextMenuItem';
import './TrackContextMenu.css';

type ClipColor = 'cyan' | 'blue' | 'violet' | 'magenta' | 'red' | 'orange' | 'yellow' | 'green' | 'teal';

const TRACK_COLORS: ClipColor[] = ['cyan', 'blue', 'violet', 'magenta', 'red', 'orange', 'yellow', 'green', 'teal'];

export interface TrackContextMenuProps {
  isOpen: boolean;
  onClose: () => void;
  x: number;
  y: number;
  autoFocus?: boolean;
  onDelete?: () => void;
  onColorChange?: (color: ClipColor) => void;
  onSpectrogramSettings?: () => void;
}

export const TrackContextMenu: React.FC<TrackContextMenuProps> = ({
  isOpen,
  onClose,
  x,
  y,
  autoFocus = false,
  onDelete,
  onColorChange,
  onSpectrogramSettings,
}) => {
  return (
    <ContextMenu isOpen={isOpen} onClose={onClose} x={x} y={y} autoFocus={autoFocus} className="track-context-menu">
      {/* Colour picker row */}
      <div className="track-context-menu__colour-row" role="group" aria-label="Track colour">
        <span className="track-context-menu__colour-label">Track colour</span>
        <div className="track-context-menu__swatches">
          {TRACK_COLORS.map((color) => (
            <button
              key={color}
              className="track-context-menu__swatch"
              style={{ backgroundColor: `var(--clip-${color}-body)` }}
              title={color.charAt(0).toUpperCase() + color.slice(1)}
              onClick={() => { onColorChange?.(color); onClose(); }}
              aria-label={`Set track colour to ${color}`}
            />
          ))}
        </div>
      </div>
      {/* Spectrogram settings */}
      {onSpectrogramSettings && (
        <ContextMenuItem
          label="Spectrogram settings..."
          onClick={() => { onSpectrogramSettings(); onClose(); }}
          onClose={onClose}
        />
      )}
      {/* Delete track */}
      <ContextMenuItem
        label="Delete track"
        onClick={onDelete}
        onClose={onClose}
      />
    </ContextMenu>
  );
};

export default TrackContextMenu;
