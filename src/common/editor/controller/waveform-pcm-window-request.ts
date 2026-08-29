/* SPDX-License-Identifier: AGPL-3.0-only */

export interface WaveformPcmWindowRequest {
	readonly startFrame?: unknown;
	readonly endFrame?: unknown;
}

export interface WaveformPcmWindowRange {
	readonly startFrame: number;
	readonly endFrame: number;
}

/** Clamp one requested clip window while preserving an explicit zero end. */
export function resolveWaveformPcmWindowRequest(
	request: WaveformPcmWindowRequest,
	durationFrames: number,
): WaveformPcmWindowRange | null {
	if (!Number.isSafeInteger(durationFrames) || durationFrames < 0) {
		throw new RangeError('A waveform PCM window requires a non-negative clip duration.');
	}
	const startFrame = boundedFrame(request.startFrame, 0, durationFrames);
	const endFrame = Math.max(
		startFrame,
		boundedFrame(request.endFrame, durationFrames, durationFrames),
	);
	return endFrame <= startFrame ? null : Object.freeze({ startFrame, endFrame });
}

function boundedFrame(value: unknown, fallback: number, durationFrames: number): number {
	const numeric = value === undefined ? fallback : Number(value);
	const frame = Number.isFinite(numeric) ? Math.round(numeric) : fallback;
	return Math.max(0, Math.min(durationFrames, frame));
}
