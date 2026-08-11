/**
 * ChannelMappingDialog - Audio channel mapping interface
 * Based on Figma design: node-id=1758-38137
 *
 * Allows users to map audio tracks to output channels using a grid of checkboxes.
 * Used in the export dialog when "custom mapping" is selected.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Dialog } from '../Dialog';
import { useTheme } from '../ThemeProvider';
import { Checkbox } from '../Checkbox';
import { Button } from '../Button';
import { NumberStepper } from '../NumberStepper';
import { CustomScrollbar } from '../CustomScrollbar';
import { useTabGroup } from '../hooks/useTabGroup';
import './ChannelMappingDialog.css';

interface TabGroupFieldProps {
  groupId: string;
  itemIndex: number;
  totalItems: number;
  itemRefs: React.RefObject<(HTMLElement | null)[]>;
  activeIndexRef: React.MutableRefObject<number>;
  activeIndex?: number;
  onActiveIndexChange?: (index: number) => void;
  children: React.ReactNode;
}

function TabGroupField({
  groupId,
  itemIndex,
  totalItems,
  itemRefs,
  activeIndexRef,
  activeIndex = 0,
  onActiveIndexChange,
  children,
}: TabGroupFieldProps) {
  const fieldRef = useRef<HTMLDivElement>(null);

  const { tabIndex, onKeyDown, onFocus, onBlur } = useTabGroup({
    groupId,
    itemIndex,
    totalItems,
    itemRefs,
    activeIndexRef,
    activeIndex,
    onItemActivate: (newIndex) => {
      onActiveIndexChange?.(newIndex);
    },
  });

  useEffect(() => {
    if (!fieldRef.current || !itemRefs.current) return;

    const focusableElement = fieldRef.current.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [role="checkbox"], [role="radio"]'
    );

    if (focusableElement) {
      itemRefs.current[itemIndex] = fieldRef.current;

      const handlers: Array<{ type: string; handler: (e: Event) => void }> = [];

      if (onKeyDown) {
        const keydownHandler = (e: Event) => {
          const keyEvent = e as KeyboardEvent;
          if (keyEvent.key === ' ' || keyEvent.key === 'Enter') {
            return;
          }
          onKeyDown(e as any);
        };
        focusableElement.addEventListener('keydown', keydownHandler);
        handlers.push({ type: 'keydown', handler: keydownHandler });
      }

      if (onFocus) {
        focusableElement.addEventListener('focus', onFocus as any);
        handlers.push({ type: 'focus', handler: onFocus as any });
      }

      if (onBlur) {
        focusableElement.addEventListener('blur', onBlur as any);
        handlers.push({ type: 'blur', handler: onBlur as any });
      }

      return () => {
        handlers.forEach(({ type, handler }) => {
          focusableElement.removeEventListener(type, handler);
        });
      };
    }
  }, [onKeyDown, onFocus, onBlur, itemIndex, itemRefs]);

  const childrenWithProps = React.Children.map(children, (child) => {
    if (React.isValidElement(child)) {
      return React.cloneElement(child as React.ReactElement<any>, {
        tabIndex,
      });
    }
    return child;
  });

  return <div ref={fieldRef}>{childrenWithProps}</div>;
}

export interface ChannelMappingDialogProps {
  /**
   * Array of tracks to display in the mapping
   */
  tracks?: Array<{ id: number; name: string }>;
  /**
   * Number of output channels
   */
  channelCount?: number;
  /**
   * Initial channel mapping (track index -> array of channel indices)
   */
  initialMapping?: boolean[][];
  /**
   * Callback when mapping is applied
   */
  onApply?: (mapping: boolean[][]) => void;
  /**
   * Callback when dialog is cancelled
   */
  onCancel?: () => void;
  /**
   * Whether the dialog is open
   */
  open?: boolean;
  /**
   * Operating system for platform-specific header controls
   * @default 'macos'
   */
  os?: 'macos' | 'windows';
  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * ChannelMappingDialog - Maps audio tracks to output channels
 */
export function ChannelMappingDialog({
  tracks = [],
  channelCount: initialChannelCount = 17,
  initialMapping,
  onApply,
  onCancel,
  open = true,
  os = 'macos',
  className = '',
}: ChannelMappingDialogProps) {
  const { theme } = useTheme();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const channelCountInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef<(HTMLDivElement | null)[][]>([]);
  const [channelCount, setChannelCount] = useState(initialChannelCount);
  const [focusedCell, setFocusedCell] = useState<{ row: number; col: number }>({ row: 0, col: 0 });
  const trackCount = tracks.length;

  // Footer tab group state
  const footerRefs = useRef<(HTMLElement | null)[]>([]);
  const footerActiveIndexRef = useRef<number>(0);
  const [footerActiveIndex, setFooterActiveIndex] = useState<number>(0);

  // Sync footer state with ref
  useEffect(() => {
    footerActiveIndexRef.current = footerActiveIndex;
  }, [footerActiveIndex]);

  // Reset footer active index when dialog opens
  useEffect(() => {
    if (open) {
      setFooterActiveIndex(0);
      footerActiveIndexRef.current = 0;
    }
  }, [open]);

  // Auto-focus the channel count input when dialog opens
  useEffect(() => {
    if (open && channelCountInputRef.current) {
      setTimeout(() => {
        channelCountInputRef.current?.focus();
      }, 0);
    }
  }, [open]);

  // Initialize mapping grid: [trackIndex][channelIndex] = boolean
  const [mapping, setMapping] = useState<boolean[][]>(() => {
    if (initialMapping) return initialMapping;

    // Create empty mapping grid
    return Array(trackCount).fill(null).map(() =>
      Array(channelCount).fill(false)
    );
  });

  const handleChannelCountChange = (value: string) => {
    const newCount = parseInt(value) || 1;
    const count = Math.max(1, Math.min(32, newCount)); // Clamp to 1-32
    setChannelCount(count);

    // Adjust mapping grid to match new channel count
    setMapping(prev => prev.map(trackMapping => {
      if (trackMapping.length === count) return trackMapping;

      // Extend or truncate
      if (trackMapping.length < count) {
        return [...trackMapping, ...Array(count - trackMapping.length).fill(false)];
      } else {
        return trackMapping.slice(0, count);
      }
    }));
  };

  const handleCheckboxChange = (trackIndex: number, channelIndex: number, checked: boolean) => {
    setMapping(prev => {
      const newMapping = prev.map(row => [...row]);
      newMapping[trackIndex][channelIndex] = checked;
      return newMapping;
    });
  };

  const handleApply = () => {
    onApply?.(mapping);
  };

  const handleCancel = () => {
    onCancel?.();
  };

  // Handle cell keyboard navigation
  const handleCellKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, row: number, col: number) => {
    let newRow = row;
    let newCol = col;
    let handled = false;

    switch (e.key) {
      case 'ArrowUp':
        newRow = Math.max(0, row - 1);
        handled = true;
        break;
      case 'ArrowDown':
        newRow = Math.min(trackCount - 1, row + 1);
        handled = true;
        break;
      case 'ArrowLeft':
        newCol = Math.max(0, col - 1);
        handled = true;
        break;
      case 'ArrowRight':
        newCol = Math.min(channelCount - 1, col + 1);
        handled = true;
        break;
      case ' ':
      case 'Enter':
        handleCheckboxChange(row, col, !mapping[row][col]);
        handled = true;
        break;
    }

    if (handled) {
      e.preventDefault();
      e.stopPropagation();

      if (newRow !== row || newCol !== col) {
        setFocusedCell({ row: newRow, col: newCol });
        cellRefs.current[newRow]?.[newCol]?.focus();
      }
    }
  };

  const handleCellFocus = (row: number, col: number) => {
    setFocusedCell({ row, col });
  };

  const style = {
    '--dialog-bg': theme.background.dialog.body,
    '--dialog-header-bg': theme.background.dialog.header,
    '--dialog-border': theme.border.default,
    '--table-header-bg': theme.background.table.header.background,
    '--table-item-bg': theme.background.table.row.idle,
    '--table-border': theme.border.default,
    '--table-row-border': theme.background.table.row.border,
    '--input-bg': theme.background.control.input.idle,
    '--input-border': theme.border.input.idle,
    '--text-color': theme.foreground.text.primary,
    '--scrollbar-bg': 'rgba(20, 21, 26, 0.3)',
  } as React.CSSProperties;

  return (
    <Dialog
      isOpen={open}
      title="Edit mapping"
      onClose={handleCancel}
      className={`channel-mapping-dialog ${className}`}
      width={320}
      minHeight={304}
      noPadding={true}
      os={os}
      style={style}
    >
      {/* Dialog Body */}
      <div className="channel-mapping-dialog__body">
        {/* Channel Count Stepper */}
        <div className="channel-mapping-dialog__stepper">
          <label className="channel-mapping-dialog__stepper-label">
            Channel count
          </label>
          <NumberStepper
            ref={channelCountInputRef}
            value={channelCount.toString()}
            onChange={handleChannelCountChange}
            min={1}
            max={32}
            step={1}
            width={113}
          />
        </div>

        {/* Channel Mapping Grid */}
        <div className="channel-mapping-dialog__grid-container">
          {/* Track Labels Column */}
          <div className="channel-mapping-dialog__track-column">
            <div className="channel-mapping-dialog__track-header" />
            {tracks.map((track, i) => (
              <div key={track.id} className="channel-mapping-dialog__track-label">
                {track.name}
              </div>
            ))}
            <div className="channel-mapping-dialog__track-footer" />
          </div>

          {/* Scrollable Channel Grid Wrapper */}
          <div className="channel-mapping-dialog__scroll-wrapper">
            {/* Scrollable container */}
            <div
              ref={scrollContainerRef}
              className="channel-mapping-dialog__scroll-container"
            >
              <div ref={gridRef} className="channel-mapping-dialog__grid">
                {/* Channel Number Headers */}
                <div className="channel-mapping-dialog__channel-headers">
                  {Array.from({ length: channelCount }, (_, i) => (
                    <div key={i} className="channel-mapping-dialog__channel-header">
                      {i + 1}
                    </div>
                  ))}
                </div>

                {/* Checkbox Grid Rows */}
                {tracks.map((track, trackIndex) => (
                  <div key={track.id} className="channel-mapping-dialog__grid-row">
                    {Array.from({ length: channelCount }, (_, channelIndex) => {
                      // Initialize cellRefs array if needed
                      if (!cellRefs.current[trackIndex]) {
                        cellRefs.current[trackIndex] = [];
                      }

                      return (
                        <div
                          key={channelIndex}
                          ref={(el) => {
                            if (cellRefs.current[trackIndex]) {
                              cellRefs.current[trackIndex][channelIndex] = el;
                            }
                          }}
                          className="channel-mapping-dialog__grid-cell"
                          tabIndex={focusedCell.row === trackIndex && focusedCell.col === channelIndex ? 0 : -1}
                          onKeyDown={(e) => handleCellKeyDown(e, trackIndex, channelIndex)}
                          onFocus={() => handleCellFocus(trackIndex, channelIndex)}
                        >
                          <Checkbox
                            checked={mapping[trackIndex]?.[channelIndex] ?? false}
                            onChange={(checked) => handleCheckboxChange(trackIndex, channelIndex, checked)}
                            aria-label={`Map ${track.name} to Channel ${channelIndex + 1}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            {/* Custom scrollbar as sibling to scroll container */}
            <CustomScrollbar
              contentRef={scrollContainerRef}
              orientation="horizontal"
              height={16}
              backgroundColor={theme.background.table.header.background}
              borderColor={theme.border.default}
              fullSize={true}
              thumbThickness={6}
              paddingX={10}
              className="channel-mapping-scrollbar"
            />
          </div>
        </div>
      </div>

      {/* Dialog Footer */}
      <div className="channel-mapping-dialog__footer">
        <TabGroupField
          groupId="dialog-footer"
          itemIndex={0}
          totalItems={2}
          itemRefs={footerRefs}
          activeIndexRef={footerActiveIndexRef}
          activeIndex={footerActiveIndex}
          onActiveIndexChange={setFooterActiveIndex}
        >
          <Button variant="secondary" onClick={handleCancel}>
            Cancel
          </Button>
        </TabGroupField>
        <TabGroupField
          groupId="dialog-footer"
          itemIndex={1}
          totalItems={2}
          itemRefs={footerRefs}
          activeIndexRef={footerActiveIndexRef}
          activeIndex={footerActiveIndex}
          onActiveIndexChange={setFooterActiveIndex}
        >
          <Button variant="primary" onClick={handleApply}>
            Apply
          </Button>
        </TabGroupField>
      </div>
    </Dialog>
  );
}

export default ChannelMappingDialog;
