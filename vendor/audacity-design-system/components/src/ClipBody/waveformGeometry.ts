export interface WaveformGeometryArgs {
  dataLength: number;
  clipFullDuration: number | undefined;
  clipTrimStart: number;
  clipDuration: number;
  pixelsPerSecond: number;
  clipStretchFactor: number;
}

export interface WaveformGeometry {
  samplesPerPixel: number;
  trimStartSample: number;
}

export function computeWaveformGeometry(args: WaveformGeometryArgs): WaveformGeometry {
  const fullDuration = args.clipFullDuration || (args.clipTrimStart + args.clipDuration);
  const detectedSampleRate = args.dataLength / fullDuration;
  const secondsPerPixel = 1 / args.pixelsPerSecond;
  const samplesPerPixel = (secondsPerPixel * detectedSampleRate) / args.clipStretchFactor;
  const trimStartSample = Math.floor(args.clipTrimStart * detectedSampleRate);
  return { samplesPerPixel, trimStartSample };
}

export interface SelectionColorArgs {
  computedStyle: Pick<CSSStyleDeclaration, 'getPropertyValue'>;
  /** The clip color key used in the `--clip-<colorPrefix>-*` CSS var names */
  colorPrefix: string;
  inTimeSelection: boolean;
  timeSelectionRange: { startTime: number; endTime: number } | null;
  clipStartTime: number;
  clipDuration: number;
  pixelsPerSecond: number;
}

export interface SelectionColorFns {
  getWaveColor: (px: number) => string;
  getRmsColor: (px: number) => string;
}

/**
 * Builds per-pixel color-picker functions for waveform/RMS rendering that
 * switch between normal and time-selection colors. Verbatim extraction of
 * the duplicated block from ClipBody.tsx's stereo and mono draw branches
 * (dead `selectedWaveformColor`/`selectedRmsColor` reads dropped — they
 * were computed but never used).
 */
export function makeSelectionColorFns(args: SelectionColorArgs): SelectionColorFns {
  const {
    computedStyle,
    colorPrefix,
    inTimeSelection,
    timeSelectionRange,
    clipStartTime,
    clipDuration,
    pixelsPerSecond,
  } = args;

  // Calculate time selection bounds in pixels (if applicable)
  let selStartPx = -1;
  let selEndPx = -1;
  if (inTimeSelection && timeSelectionRange) {
    const clipEndTime = clipStartTime + clipDuration;
    const overlapStart = Math.max(clipStartTime, timeSelectionRange.startTime);
    const overlapEnd = Math.min(clipEndTime, timeSelectionRange.endTime);
    if (overlapStart < overlapEnd) {
      selStartPx = (overlapStart - clipStartTime) * pixelsPerSecond;
      selEndPx = (overlapEnd - clipStartTime) * pixelsPerSecond;
    }
  }

  // Get waveform colors from CSS variables (theme tokens)
  const defaultWaveformColor = computedStyle.getPropertyValue(`--clip-${colorPrefix}-waveform`).trim();
  const timeSelectionWaveformColor = computedStyle.getPropertyValue(`--clip-${colorPrefix}-time-selection-waveform`).trim();
  const defaultRmsColor = computedStyle.getPropertyValue(`--clip-${colorPrefix}-waveform-rms`).trim();
  const timeSelectionRmsColor = computedStyle.getPropertyValue(`--clip-${colorPrefix}-time-selection-waveform-rms`).trim();

  // Color functions for time-selection-aware rendering
  const getWaveColor = (px: number) => px >= selStartPx && px < selEndPx ? timeSelectionWaveformColor : defaultWaveformColor;
  const getRmsColor = (px: number) => px >= selStartPx && px < selEndPx ? timeSelectionRmsColor : defaultRmsColor;

  return { getWaveColor, getRmsColor };
}
