export {
	DESIGN_SYSTEM_GAIN_DB_MAXIMUM,
	DESIGN_SYSTEM_GAIN_DB_MINIMUM,
	designValueToPan,
	designValueToProgress,
	designVolumeToGainDb,
	framesToSeconds,
	gainDbToDesignVolume,
	panToDesignValue,
	progressToDesignValue,
	secondsToFrames,
} from './design-system-adapters/control-values.ts';
export { boundedCanvasDimensions } from './design-system-adapters/canvas.ts';
export {
	createTimelineProjectIndex,
	projectClipsToViewport,
	rightmostVisibleClip,
} from './design-system-adapters/timeline.ts';
export {
	prepareBoundedWaveformWindow,
	preparePeakPyramidWaveformWindow,
} from './design-system-adapters/waveform.ts';
