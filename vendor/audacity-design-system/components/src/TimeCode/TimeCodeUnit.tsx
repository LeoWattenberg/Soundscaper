import React from 'react';
import './TimeCodeUnit.css';

export type TimeCodeUnitType =
  | 'days'
  | 'hours'
  | 'minutes'
  | 'seconds'
  | 'beat'
  | 'bar'
  | 'slash'
  | 'bpm'
  | 'comma'
  | 'period'
  | 'samples'
  | 'frames'
  | 'Hz';

export interface TimeCodeUnitProps {
  /**
   * Type of unit label to display
   */
  unit: TimeCodeUnitType;
  /**
   * Optional className
   */
  className?: string;
}

const UNIT_LABELS: Record<TimeCodeUnitType, string> = {
  days: 'd',
  hours: 'h',
  minutes: 'm',
  seconds: 's',
  beat: 'beat',
  bar: 'bar',
  slash: '/',
  bpm: 'bpm',
  comma: ',',
  period: '.',
  samples: 'samples',
  frames: 'frames',
  Hz: 'Hz',
};

/**
 * TimeCodeUnit - Unit label component for timecode display
 * Displays unit labels like 'd', 'h', 'm', 's', 'beat', 'bar', etc.
 */
export function TimeCodeUnit({ unit, className = '' }: TimeCodeUnitProps) {
  return (
    <span className={`timecode-unit ${className}`} data-unit={unit}>
      {UNIT_LABELS[unit]}
    </span>
  );
}
