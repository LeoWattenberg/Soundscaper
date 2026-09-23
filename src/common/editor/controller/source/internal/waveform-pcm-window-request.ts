/* SPDX-License-Identifier: AGPL-3.0-only */

import { MAXIMUM_WAVEFORM_PEAK_WINDOW_BUCKETS } from '../../../waveform-peak-contract.ts';

export interface WaveformPcmWindowRequest {
	readonly startFrame?: unknown;
	readonly endFrame?: unknown;
	readonly pixelWidth?: unknown;
}

/** Read an optional viewport width used when the raw PCM range exceeds its memory cap. */
export function resolveWaveformPeakPixelWidth(value: unknown): number | null {
	if (value === undefined) return null;
	const pixelWidth = Number(value);
	if (!Number.isFinite(pixelWidth) || pixelWidth <= 0
		|| pixelWidth > MAXIMUM_WAVEFORM_PEAK_WINDOW_BUCKETS) {
		throw new RangeError('A waveform peak window requires a positive finite pixel width.');
	}
	return pixelWidth;
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

function boundedFrame(value: unknown, fallback: number, durationFrames: number): number {
	const numeric = value === undefined ? fallback : Number(value);
	const frame = Number.isFinite(numeric) ? Math.round(numeric) : fallback;
	return Math.max(0, Math.min(durationFrames, frame));
}
