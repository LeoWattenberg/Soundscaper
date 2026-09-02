/* SPDX-License-Identifier: AGPL-3.0-only */

import { secondsToFrames } from '../../design-system-adapters.js';

export const DEFAULT_WAVEFORM_RULER_STATE = Object.freeze({
	format: 'linear-db' as const,
	zoom: 0,
});
export const MAXIMUM_WAVEFORM_VERTICAL_ZOOM = 8;
export const MINIMUM_TRACK_HEIGHT = 40;
export const DEFAULT_TRACK_HEIGHT = 114;
export const RECORDING_INPUT_CONTROLS_HEIGHT = 24;
export const AUTOMATION_CONTROLS_HEIGHT = 24;

export type SpectrogramScale = 'linear' | 'logarithmic' | 'mel' | 'bark' | 'erb' | 'period';
export type WaveformRulerFormat = 'linear-db';

export interface TimelineTrackGeometry {
	readonly id?: string;
	readonly type?: string;
	readonly laneGroupId?: string | null;
	readonly clipIds?: readonly string[];
	readonly height?: number;
}

export interface TimelineProjectGeometry {
	readonly tracks: readonly TimelineTrackGeometry[];
}

export interface TimelineFrequencySelection {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly frequencyRange: Readonly<{
		minimumFrequency: number;
		maximumFrequency: number;
	}>;
}

export function normalizeSpectrogramScale(value: unknown): SpectrogramScale {
	const scale = String(value || 'mel').toLowerCase();
	if (scale === 'log') return 'logarithmic';
	return isSpectrogramScale(scale) ? scale : 'mel';
}

export function normalizeWaveformRulerFormat(value: unknown): WaveformRulerFormat {
	return value === 'linear-db' ? value : DEFAULT_WAVEFORM_RULER_STATE.format;
}

export function normalizeWaveformRulerState(value?: Readonly<{ format?: unknown; zoom?: number }> | null): Readonly<{
	format: WaveformRulerFormat;
	zoom: number;
}> {
	return {
		...DEFAULT_WAVEFORM_RULER_STATE,
		...value,
		format: normalizeWaveformRulerFormat(value?.format),
	};
}

export function spectralSelectionState(selection: TimelineFrequencySelection): Readonly<{
	startFrame: number;
	endFrame: number;
	minimumFrequency: number;
	maximumFrequency: number;
}> {
	return {
		startFrame: selection.startFrame,
		endFrame: selection.endFrame,
		minimumFrequency: selection.frequencyRange.minimumFrequency,
		maximumFrequency: selection.frequencyRange.maximumFrequency,
	};
}

export function spectrogramFrequencyFraction(
	frequency: number,
	scale: SpectrogramScale,
	minimumFrequency: number,
	maximumFrequency: number,
): number {
	const minimum = spectrogramScaleValue(minimumFrequency, scale);
	const maximum = spectrogramScaleValue(maximumFrequency, scale);
	const value = spectrogramScaleValue(clamp(frequency, minimumFrequency, maximumFrequency), scale);
	return maximum > minimum ? clamp((value - minimum) / (maximum - minimum), 0, 1) : 0;
}

export function spectrogramFrequencyAtFraction(
	fraction: number,
	scale: SpectrogramScale,
	minimumFrequency: number,
	maximumFrequency: number,
): number {
	const target = clamp(fraction, 0, 1);
	let low = minimumFrequency;
	let high = maximumFrequency;
	for (let iteration = 0; iteration < 32; iteration += 1) {
		const midpoint = (low + high) / 2;
		if (spectrogramFrequencyFraction(midpoint, scale, minimumFrequency, maximumFrequency) < target) low = midpoint;
		else high = midpoint;
	}
	return (low + high) / 2;
}

export function spectrogramScaleValue(frequency: number, scale: SpectrogramScale): number {
	const value = Math.max(0, Number(frequency) || 0);
	if (scale === 'linear') return value;
	if (scale === 'logarithmic') return Math.log1p(value);
	if (scale === 'bark') return 13 * Math.atan(0.00076 * value) + 3.5 * Math.atan((value / 7_500) ** 2);
	if (scale === 'erb') return 21.4 * Math.log10(1 + 0.00437 * value);
	if (scale === 'period') return value / (value + 1_000);
	return 2_595 * Math.log10(1 + value / 700);
}

export function secondsDeltaToFrames(seconds: number, sampleRate = 48_000): number {
	const value = Number(seconds);
	if (!Number.isFinite(value) || value === 0) return 0;
	return secondsToFrames(Math.abs(value), { sampleRate }) * Math.sign(value);
}

export function compatibleMediaTrack(
	project: TimelineProjectGeometry | null | undefined,
	requestedTrackId: string,
	clipKind: string | null | undefined,
): TimelineTrackGeometry | null {
	const tracks = project?.tracks;
	if (!tracks) return null;
	const requested = tracks.find((track) => track.id === requestedTrackId);
	if (!requested || !Array.isArray(requested.clipIds)) return null;
	if (!clipKind || requested.type === clipKind) return requested;
	if (!requested.laneGroupId) return null;
	return tracks.find((track) => (
		track.type === clipKind && track.laneGroupId === requested.laneGroupId
	)) || null;
}

export function trackVisualHeight(
	track: Pick<TimelineTrackGeometry, 'type' | 'height'> | null | undefined,
	showArmControls = false,
	heightOverride?: number,
	showAutomationControls = false,
): number {
	const expandedHeight = Math.max(
		MINIMUM_TRACK_HEIGHT,
		Number(heightOverride ?? track?.height) || DEFAULT_TRACK_HEIGHT,
	);
	return expandedHeight + trackOptionalControlsHeight(
		track, showArmControls, showAutomationControls,
	);
}

export function trackOptionalControlsHeight(
	track: Pick<TimelineTrackGeometry, 'type'> | null | undefined,
	showArmControls = false,
	showAutomationControls = false,
): number {
	if (track?.type !== 'audio') return 0;
	return (showArmControls ? RECORDING_INPUT_CONTROLS_HEIGHT : 0)
		+ (showAutomationControls ? AUTOMATION_CONTROLS_HEIGHT : 0);
}

export function linearToDb(value: number): number {
	const number = Number(value);
	return number > 0 ? Math.max(-60, Math.min(12, 20 * Math.log10(number))) : -60;
}

export function dbToLinear(value: number): number {
	const db = Math.max(-60, Math.min(12, Number(value) || 0));
	return 10 ** (db / 20);
}

export function meterPercent(dbfs: number | null | undefined): number {
	const value = Number.isFinite(dbfs) ? Number(dbfs) : -60;
	return (Math.max(-60, Math.min(0, value)) + 60) / 60 * 100;
}

function isSpectrogramScale(value: string): value is SpectrogramScale {
	return ['linear', 'logarithmic', 'mel', 'bark', 'erb', 'period'].includes(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}
