/**
 * LabelEditorTableRow - Single row in the label editor table
 * Based on Figma design: node-id=8827-43120
 */

import React from 'react';
import { Dropdown } from '../Dropdown';
import { TextInput } from '../TextInput';
import { TimeCode, type TimeCodeFormat } from '../TimeCode';
import { useTheme } from '../ThemeProvider';
import './LabelEditorTableRow.css';

export interface LabelEditorTableRowProps {
  /**
   * Track dropdown options
   */
  trackOptions: Array<{ value: string; label: string }>;
  /**
   * Selected track value
   */
  trackValue: string;
  /**
   * Label text
   */
  labelText: string;
  /**
   * Start time in seconds
   */
  startTime: number;
  /**
   * End time in seconds
   */
  endTime: number;
  /**
   * Low frequency (optional, for spectral labels)
   */
  lowFrequency?: number;
  /**
   * High frequency (optional, for spectral labels)
   */
  highFrequency?: number;
  /**
   * Whether the row is selected
   */
  selected?: boolean;
  /**
   * Sample rate for TimeCode component
   */
  sampleRate?: number;
  /**
   * TimeCode format
   */
  timeCodeFormat?: TimeCodeFormat;
  /**
   * Callback when track changes
   */
  onTrackChange: (value: string) => void;
  /**
   * Callback when label text changes
   */
  onLabelTextChange: (value: string) => void;
  /**
   * Callback when start time changes
   */
  onStartTimeChange: (value: number) => void;
  /**
   * Callback when end time changes
   */
  onEndTimeChange: (value: number) => void;
  /**
   * Callback when low frequency changes
   */
  onLowFrequencyChange?: (value: number) => void;
  /**
   * Callback when high frequency changes
   */
  onHighFrequencyChange?: (value: number) => void;
  /**
   * Callback when row is clicked
   */
  onClick?: (e: React.MouseEvent) => void;
}

/**
 * LabelEditorTableRow component - Single editable row in label editor table
 */
export function LabelEditorTableRow({
  trackOptions,
  trackValue,
  labelText,
  startTime,
  endTime,
  lowFrequency,
  highFrequency,
  selected = false,
  sampleRate = 44100,
  timeCodeFormat = 'hh:mm:ss',
  onTrackChange,
  onLabelTextChange,
  onStartTimeChange,
  onEndTimeChange,
  onLowFrequencyChange,
  onHighFrequencyChange,
  onClick,
}: LabelEditorTableRowProps) {
  const { theme } = useTheme();

  const style = {
    '--label-editor-row-bg': selected ? 'rgba(103, 124, 228, 0.1)' : '#F8F8F9',
    '--label-editor-row-border': theme.border.default,
  } as React.CSSProperties;

  return (
    <tr
      className={`label-editor-table-row ${selected ? 'label-editor-table-row--selected' : ''}`}
      style={style}
      onClick={onClick}
    >
      <td className="label-editor-table-row__cell">
        <Dropdown
          options={trackOptions}
          value={trackValue}
          onChange={onTrackChange}
          placeholder="Select track"
        />
      </td>
      <td className="label-editor-table-row__cell">
        <TextInput
          value={labelText}
          onChange={onLabelTextChange}
          placeholder="Label text"
          multiline
          maxWidth={400}
        />
      </td>
      <td className="label-editor-table-row__cell">
        <TimeCode
          value={startTime}
          onChange={onStartTimeChange}
          sampleRate={sampleRate}
          format={timeCodeFormat}
          variant="light"
        />
      </td>
      <td className="label-editor-table-row__cell">
        <TimeCode
          value={endTime}
          onChange={onEndTimeChange}
          sampleRate={sampleRate}
          format={timeCodeFormat}
          variant="light"
        />
      </td>
      <td className="label-editor-table-row__cell">
        <TextInput
          value={lowFrequency?.toString() || ''}
          onChange={(value) => onLowFrequencyChange?.(parseFloat(value) || 0)}
          placeholder="--"
        />
      </td>
      <td className="label-editor-table-row__cell">
        <TextInput
          value={highFrequency?.toString() || ''}
          onChange={(value) => onHighFrequencyChange?.(parseFloat(value) || 0)}
          placeholder="--"
        />
      </td>
    </tr>
  );
}

export default LabelEditorTableRow;
