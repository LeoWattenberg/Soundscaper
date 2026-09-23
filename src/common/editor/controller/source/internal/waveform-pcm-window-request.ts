/* SPDX-License-Identifier: AGPL-3.0-only */

export interface WaveformPcmWindowRequest {
	readonly startFrame?: unknown;
	readonly endFrame?: unknown;
	/** Extra source-domain context used by consumers with stateful analysis. */
	readonly sourcePaddingFrames?: unknown;
	readonly signal?: AbortSignal;
}

/** Keep speculative context reads inside the same hard bound as their PCM window. */
export function resolveWaveformPcmSourcePadding(value: unknown, maximumFrames: number): number {
	if (!Number.isSafeInteger(maximumFrames) || maximumFrames < 0) {
		throw new RangeError('A waveform PCM window requires a non-negative padding bound.');
	}
	const numeric = value === undefined ? 0 : Number(value);
	const frames = Number.isFinite(numeric) ? Math.round(numeric) : 0;
	return Math.max(0, Math.min(maximumFrames, frames));
}

export interface WaveformPcmWindowRange {
	readonly startFrame: number;
	readonly endFrame: number;
}

/** Clamp one requested clip window while preserving an explicit zero end. */
export function resolveWaveformPcmWindowRequest(
	request: WaveformPcmWindowRequest,
	durationFrames: unknown,
): WaveformPcmWindowRange | null {
	if (typeof durationFrames !== 'number' || !Number.isSafeInteger(durationFrames) || durationFrames < 0) {
		throw new RangeError('A waveform PCM window requires a non-negative clip duration.');
	}
	const startFrame = boundedFrame(request.startFrame, 0, durationFrames);
	const endFrame = Math.max(
		startFrame,
		boundedFrame(request.endFrame, durationFrames, durationFrames),
	);
	return endFrame <= startFrame ? null : Object.freeze({ startFrame, endFrame });
}

/** Validate persisted source geometry before it reaches range arithmetic. */
export function requireWaveformSourceFrameCount(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError('A waveform PCM window requires a non-negative source frame count.');
	}
	return value;
}

export function waveformPcmWindowForVisibleRange<Window extends WaveformPcmWindowRange>(
	window: Window,
	visibleRange: WaveformPcmWindowRange,
): Window & Readonly<{ visibleStartFrame: number; visibleEndFrame: number }> {
	if ('visibleStartFrame' in window && window.visibleStartFrame === visibleRange.startFrame
		&& 'visibleEndFrame' in window && window.visibleEndFrame === visibleRange.endFrame) {
		return window as Window & Readonly<{ visibleStartFrame: number; visibleEndFrame: number }>;
	}
	return Object.freeze({ ...window,
		visibleStartFrame: visibleRange.startFrame, visibleEndFrame: visibleRange.endFrame });
}

function boundedFrame(value: unknown, fallback: number, durationFrames: number): number {
	const numeric = value === undefined ? fallback : Number(value);
	const frame = Number.isFinite(numeric) ? Math.round(numeric) : fallback;
	return Math.max(0, Math.min(durationFrames, frame));
}
