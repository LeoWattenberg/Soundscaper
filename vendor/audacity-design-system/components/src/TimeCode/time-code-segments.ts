import type { TimeCodeUnitType } from './TimeCodeUnit';
import type { TimeCodeFormat } from './time-code-formats';
import type { TimeCodeMusicalMap } from './time-code-musical-context';
import { timeCodeFrameFormat, timeCodeFrameCount, timeCodeLabelledFrameCount, timeCodeFrameSeconds } from './time-code-frames';
import { timeCodeWholeUnits } from './time-code-precision';

export interface TimeCodeSegment {
  value: string;
  type: 'unit' | 'separator' | 'label';
  unitType?: TimeCodeUnitType;
  maxLength?: number;
  max?: number;
  editable?: boolean;
}

export function formatTimeToSegments(
  seconds: number,
  format: TimeCodeFormat,
  sampleRate: number,
  frameRate: number,
  musicalMap?: TimeCodeMusicalMap
): TimeCodeSegment[] {
  const frameFormat = timeCodeFrameFormat(format, frameRate);
  if (frameFormat) {
    if (frameFormat.total) return formatFilmFrames(seconds, frameFormat.rate, sampleRate);
    const count = timeCodeFrameCount(seconds, frameFormat.rate, sampleRate);
    const labelled = timeCodeLabelledFrameCount(count, frameFormat);
    return formatHHMMSSFrames(labelled / frameFormat.nominalRate, frameFormat.nominalRate);
  }
  switch (format) {
    case 'dd:hh:mm:ss':
      return formatDDHHMMSS(seconds);
    case 'hh:mm:ss':
      return formatHHMMSS(seconds);
    case 'hh:mm:ss+hundredths':
      return formatHHMMSSHundredths(seconds);
    case 'hh:mm:ss+milliseconds':
      return formatHHMMSSMilliseconds(seconds);
    case 'mm:ss+milliseconds': {
      const segments = formatHHMMSSMilliseconds(seconds);
      return [{ ...segments[2], value: pad(Math.floor(seconds / 60), 2) }, ...segments.slice(3)];
    }
    case 'hh:mm:ss+samples':
      return formatHHMMSSSamples(seconds, sampleRate);
    case 'samples':
      return formatSamples(seconds, sampleRate);
    case 'seconds':
      return formatSeconds(seconds);
    case 'seconds+milliseconds':
      return formatSecondsMilliseconds(seconds);
    case 'beats:bars':
      return formatBeatsBar(seconds, musicalMap);
    case 'Hz':
      return formatHz(seconds);
    default:
      return formatHHMMSS(seconds);
  }
}

function pad(num: number, length: number): string {
  return num.toString().padStart(length, '0');
}

function formatDDHHMMSS(seconds: number): TimeCodeSegment[] {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  return [
    { value: pad(days, 2), type: 'unit', maxLength: 2, max: 99, editable: true },
    { value: 'd', type: 'label', unitType: 'days' },
    { value: pad(hours, 2), type: 'unit', maxLength: 2, max: 23, editable: true },
    { value: 'h', type: 'label', unitType: 'hours' },
    { value: pad(minutes, 2), type: 'unit', maxLength: 2, max: 59, editable: true },
    { value: 'm', type: 'label', unitType: 'minutes' },
    { value: pad(secs, 2), type: 'unit', maxLength: 2, max: 59, editable: true },
    { value: 's', type: 'label', unitType: 'seconds' },
  ];
}

function formatHHMMSS(seconds: number): TimeCodeSegment[] {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  return [
    { value: pad(hours, 2), type: 'unit', maxLength: 2, max: 99, editable: true },
    { value: 'h', type: 'label', unitType: 'hours' },
    { value: pad(minutes, 2), type: 'unit', maxLength: 2, max: 59, editable: true },
    { value: 'm', type: 'label', unitType: 'minutes' },
    { value: pad(secs, 2), type: 'unit', maxLength: 2, max: 59, editable: true },
    { value: 's', type: 'label', unitType: 'seconds' },
  ];
}

function formatHHMMSSHundredths(seconds: number): TimeCodeSegment[] {

	seconds = timeCodeWholeUnits(seconds, 100) / 100;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const hundredths = timeCodeWholeUnits(seconds, 100) % 100;

  return [
    { value: pad(hours, 2), type: 'unit', maxLength: 2, max: 99, editable: true },
    { value: 'h', type: 'label', unitType: 'hours' },
    { value: pad(minutes, 2), type: 'unit', maxLength: 2, max: 59, editable: true },
    { value: 'm', type: 'label', unitType: 'minutes' },
    { value: pad(secs, 2), type: 'unit', maxLength: 2, max: 59, editable: true },
    { value: '.', type: 'separator' },
    { value: pad(hundredths, 2), type: 'unit', maxLength: 2, max: 99, editable: true },
    { value: 's', type: 'label', unitType: 'seconds' },
  ];
}

function formatHHMMSSMilliseconds(seconds: number): TimeCodeSegment[] {

	seconds = timeCodeWholeUnits(seconds, 1000) / 1000;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const milliseconds = timeCodeWholeUnits(seconds, 1000) % 1000;

  return [
    { value: pad(hours, 2), type: 'unit', maxLength: 2, max: 99, editable: true },
    { value: 'h', type: 'label', unitType: 'hours' },
    { value: pad(minutes, 2), type: 'unit', maxLength: 2, max: 59, editable: true },
    { value: 'm', type: 'label', unitType: 'minutes' },
    { value: pad(secs, 2), type: 'unit', maxLength: 2, max: 59, editable: true },
    { value: '.', type: 'separator' },
    { value: pad(milliseconds, 3), type: 'unit', maxLength: 3, max: 999, editable: true },
    { value: 's', type: 'label', unitType: 'seconds' },
  ];
}

function formatHHMMSSSamples(seconds: number, sampleRate: number): TimeCodeSegment[] {

	seconds = timeCodeWholeUnits(seconds, sampleRate) / sampleRate;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const samples = timeCodeWholeUnits(seconds, sampleRate) % sampleRate;

  return [
    { value: pad(hours, 2), type: 'unit', maxLength: 2, max: 99, editable: true },
    { value: 'h', type: 'label', unitType: 'hours' },
    { value: pad(minutes, 2), type: 'unit', maxLength: 2, max: 59, editable: true },
    { value: 'm', type: 'label', unitType: 'minutes' },
    { value: pad(secs, 2), type: 'unit', maxLength: 2, max: 59, editable: true },
    { value: 's', type: 'label', unitType: 'seconds' },
    { value: pad(samples, 5), type: 'unit', maxLength: 5, max: sampleRate - 1, editable: true },
    { value: 'samples', type: 'label', unitType: 'samples' },
  ];
}

function formatHHMMSSFrames(seconds: number, frameRate: number): TimeCodeSegment[] {
  const totalFrames = timeCodeFrameCount(seconds, frameRate);
  if (Number.isInteger(frameRate)) seconds = Math.floor(totalFrames / frameRate);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const frames = Number.isInteger(frameRate) ? totalFrames % frameRate : Math.floor((seconds % 1) * frameRate);

  return [
    { value: pad(hours, 2), type: 'unit', maxLength: 2, max: 99, editable: true },
    { value: 'h', type: 'label', unitType: 'hours' },
    { value: pad(minutes, 2), type: 'unit', maxLength: 2, max: 59, editable: true },
    { value: 'm', type: 'label', unitType: 'minutes' },
    { value: pad(secs, 2), type: 'unit', maxLength: 2, max: 59, editable: true },
    { value: 's', type: 'label', unitType: 'seconds' },
    { value: pad(frames, 2), type: 'unit', maxLength: 2, max: frameRate - 1, editable: true },
    { value: 'frames', type: 'label', unitType: 'frames' },
  ];
}

function formatSamples(seconds: number, sampleRate: number): TimeCodeSegment[] {
  const totalSamples = timeCodeWholeUnits(seconds, sampleRate);
  const samplesStr = totalSamples.toString().padStart(12, '0');

  // Add commas for thousands separators
  const parts: TimeCodeSegment[] = [];
  const groups = [];

  for (let i = samplesStr.length - 1, group = ''; i >= 0; i--) {
    group = samplesStr[i] + group;
    if (group.length === 3 || i === 0) {
      groups.unshift(group);
      group = '';
    }
  }

  groups.forEach((group, index) => {
    parts.push({ value: group, type: 'unit', editable: true });
    if (index < groups.length - 1) {
      parts.push({ value: ',', type: 'separator' });
    }
  });

  parts.push({ value: 'samples', type: 'label', unitType: 'samples' });

  return parts.length ? parts : [{ value: '0', type: 'unit', editable: true }, { value: 'samples', type: 'label', unitType: 'samples' }];
}

function formatSeconds(seconds: number): TimeCodeSegment[] {
  const totalSeconds = Math.floor(seconds);
  // Pad to at least 6 digits (000,000)
  const secondsStr = totalSeconds.toString().padStart(6, '0');

  // Add commas for thousands separators
  const parts: TimeCodeSegment[] = [];
  const groups = [];

  for (let i = secondsStr.length - 1, group = ''; i >= 0; i--) {
    group = secondsStr[i] + group;
    if (group.length === 3 || i === 0) {
      groups.unshift(group);
      group = '';
    }
  }

  groups.forEach((group, index) => {
    parts.push({ value: group, type: 'unit', editable: true });
    if (index < groups.length - 1) {
      parts.push({ value: ',', type: 'separator' });
    }
  });

  parts.push({ value: 'seconds', type: 'label', unitType: 'seconds' });

  return parts;
}

function formatSecondsMilliseconds(seconds: number): TimeCodeSegment[] {
  const totalSeconds = Math.floor(seconds);
  const milliseconds = timeCodeWholeUnits(seconds, 1000) % 1000;
  const secondsStr = totalSeconds.toString().padStart(6, '0');

  // Add commas for thousands separators
  const parts: TimeCodeSegment[] = [];
  const groups = [];

  for (let i = secondsStr.length - 1, group = ''; i >= 0; i--) {
    group = secondsStr[i] + group;
    if (group.length === 3 || i === 0) {
      groups.unshift(group);
      group = '';
    }
  }

  groups.forEach((group, index) => {
    parts.push({ value: group, type: 'unit', editable: true });
    if (index < groups.length - 1) {
      parts.push({ value: ',', type: 'separator' });
    }
  });

  parts.push({ value: '.', type: 'separator' });
  parts.push({ value: pad(milliseconds, 3), type: 'unit', maxLength: 3, max: 999, editable: true });
  parts.push({ value: 'seconds', type: 'label', unitType: 'seconds' });

  return parts;
}

function formatFilmFrames(seconds: number, frameRate: number, sampleRate: number): TimeCodeSegment[] {
  const totalFrames = timeCodeFrameCount(seconds, frameRate, sampleRate);
  const framesStr = totalFrames.toString().padStart(12, '0');

  // Add commas for thousands separators
  const parts: TimeCodeSegment[] = [];
  const groups = [];

  for (let i = framesStr.length - 1, group = ''; i >= 0; i--) {
    group = framesStr[i] + group;
    if (group.length === 3 || i === 0) {
      groups.unshift(group);
      group = '';
    }
  }

  groups.forEach((group, index) => {
    parts.push({ value: group, type: 'unit', editable: true });
    if (index < groups.length - 1) {
      parts.push({ value: ',', type: 'separator' });
    }
  });

  return parts.length ? parts : [{ value: '0', type: 'unit', editable: true }];
}

function formatBeatsBar(seconds: number, musicalMap?: TimeCodeMusicalMap): TimeCodeSegment[] {
  // Assuming 120 BPM and 4/4 time signature for now
  const bpm = 120;
  const musicalPosition = musicalMap?.fromSeconds(seconds);
  const beatsPerBar = musicalPosition?.beatsPerBar ?? 4;
  const secondsPerBeat = 60 / bpm;

  const totalBeats = Math.floor(seconds / secondsPerBeat);
  const bars = musicalPosition?.bar ?? Math.floor(totalBeats / beatsPerBar);
  const beat = musicalPosition?.beat ?? totalBeats % beatsPerBar + 1;

  return [
    { value: pad(bars, 3), type: 'unit', maxLength: 3, max: 999, editable: true },
    { value: String(beat).padStart(String(beatsPerBar).length, '0'), type: 'unit', maxLength: String(beatsPerBar).length, max: beatsPerBar, editable: true },
  ];
}

function formatHz(seconds: number): TimeCodeSegment[] {
  // This is a placeholder - actual Hz calculation would depend on the context
  const frequency = seconds > 0 ? 1 / seconds : 0;
  const hz = frequency.toFixed(2);
  const [intPart, decPart] = hz.split('.');

  return [
    { value: intPart, type: 'unit', editable: true },
    { value: '.', type: 'separator' },
    { value: decPart, type: 'unit', editable: true },
    { value: ' Hz', type: 'separator' },
  ];
}

// Helper function to convert segments back to seconds
export function segmentsToSeconds(
  segments: TimeCodeSegment[],
  format: TimeCodeFormat,
  sampleRate: number,
  frameRate: number,
  musicalMap?: TimeCodeMusicalMap
): number {
  // Extract unit values from segments
  const unitValues: number[] = [];
  for (const segment of segments) {
    if (segment.type === 'unit') {
      unitValues.push(parseInt(segment.value, 10) || 0);
    }
  }

  const frameFormat = timeCodeFrameFormat(format, frameRate);
  if (frameFormat) return timeCodeFrameSeconds(unitValues, frameFormat);

  switch (format) {
    case 'dd:hh:mm:ss': {
      const [days, hours, minutes, seconds] = unitValues;
      return (days || 0) * 86400 + (hours || 0) * 3600 + (minutes || 0) * 60 + (seconds || 0);
    }
    case 'hh:mm:ss': {
      const [hours, minutes, seconds] = unitValues;
      return (hours || 0) * 3600 + (minutes || 0) * 60 + (seconds || 0);
    }
    case 'hh:mm:ss+hundredths': {
      const [hours, minutes, seconds, hundredths] = unitValues;
      return (hours || 0) * 3600 + (minutes || 0) * 60 + (seconds || 0) + (hundredths || 0) / 100;
    }
    case 'hh:mm:ss+milliseconds': {
      const [hours, minutes, seconds, milliseconds] = unitValues;
      return (hours || 0) * 3600 + (minutes || 0) * 60 + (seconds || 0) + (milliseconds || 0) / 1000;
    }
    case 'mm:ss+milliseconds': {
      const [minutes, seconds, milliseconds] = unitValues;
      return (minutes || 0) * 60 + (seconds || 0) + (milliseconds || 0) / 1000;
    }
    case 'hh:mm:ss+samples': {
      const [hours, minutes, seconds, samples] = unitValues;
      return (hours || 0) * 3600 + (minutes || 0) * 60 + (seconds || 0) + (samples || 0) / sampleRate;
    }
    case 'samples': {
      // Sum all unit values (handling comma-separated groups)
      const totalSamples = unitValues.reduce((sum, val) => sum * 1000 + val, 0);
      return totalSamples / sampleRate;
    }
    case 'seconds': {
      // Sum all unit values (handling comma-separated groups)
      return unitValues.reduce((sum, val) => sum * 1000 + val, 0);
    }
    case 'seconds+milliseconds': {
      // All but last value are seconds groups, last is milliseconds
      const milliseconds = unitValues.pop() || 0;
      const seconds = unitValues.reduce((sum, val) => sum * 1000 + val, 0);
      return seconds + milliseconds / 1000;
    }
    case 'beats:bars': {
      const [bars, beats] = unitValues;
      if (musicalMap) return musicalMap.toSeconds(bars || 0, beats || 1);
      const bpm = 120;
      const beatsPerBar = 4;
      const secondsPerBeat = 60 / bpm;
      return ((bars || 0) * beatsPerBar + (beats || 1) - 1) * secondsPerBeat;
    }
    case 'Hz': {
      const [intPart, decPart] = unitValues;
      const frequency = parseFloat(`${intPart || 0}.${decPart || 0}`);
      return frequency > 0 ? 1 / frequency : 0;
    }
    default:
      return 0;
  }
}
