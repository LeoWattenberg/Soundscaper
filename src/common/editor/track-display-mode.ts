/* SPDX-License-Identifier: AGPL-3.0-only */

export const AUDIO_EDITOR_TRACK_DISPLAY_MODES = Object.freeze([
	'waveform',
	'spectrogram',
	'multiview',
	'half-wave',
	'waveform-three-band',
	'waveform-rainbow',
] as const);

export type TrackDisplayMode = typeof AUDIO_EDITOR_TRACK_DISPLAY_MODES[number];
export type TimelineDisplayMode = Extract<TrackDisplayMode, 'waveform' | 'spectrogram' | 'multiview'>;
export type FrequencyWaveformDisplayMode = Extract<
	TrackDisplayMode,
	'waveform-three-band' | 'waveform-rainbow'
>;

const TRACK_DISPLAY_MODE_SET: ReadonlySet<string> = new Set(AUDIO_EDITOR_TRACK_DISPLAY_MODES);

export function isTrackDisplayMode(value: unknown): value is TrackDisplayMode {
	return typeof value === 'string' && TRACK_DISPLAY_MODE_SET.has(value);
}

export function isFrequencyWaveformDisplayMode(value: unknown): value is FrequencyWaveformDisplayMode {
	return value === 'waveform-three-band' || value === 'waveform-rainbow';
}

/** Per-track waveform variants do not change the shared timeline-view control. */
export function timelineViewForTrackDisplayMode(value: TrackDisplayMode): TimelineDisplayMode {
	return value === 'spectrogram' || value === 'multiview' ? value : 'waveform';
}
