/* SPDX-License-Identifier: AGPL-3.0-only */

export interface WebCoreStreamDiagnostics {
	readonly streamUnderrunFrames: number;
	readonly streamedPlaybackObserved: boolean;
}

let streamUnderrunFrames = 0;
let streamedPlaybackObserved = false;

/** Record that the live Web Core scheduler actually admitted streamed clips. */
export function recordWebCoreStreamPlayback(streamedClipCount: number): void {
	if (!Number.isSafeInteger(streamedClipCount) || streamedClipCount < 0) {
		throw new RangeError('The streamed clip count must be a non-negative safe integer.');
	}
	if (streamedClipCount > 0) streamedPlaybackObserved = true;
}

/** Add only worklet-reported missing frames; ordinary silence never enters this count. */
export function recordWebCoreStreamUnderrun(details: Readonly<{ readonly frames: number }>): void {
	const frames = details?.frames;
	if (!Number.isSafeInteger(frames) || frames < 0
		|| frames > Number.MAX_SAFE_INTEGER - streamUnderrunFrames) {
		throw new RangeError('The stream underrun frames must be a non-negative safe integer.');
	}
	streamUnderrunFrames += frames;
}

export function readWebCoreStreamDiagnostics(): Readonly<WebCoreStreamDiagnostics> {
	return Object.freeze({ streamUnderrunFrames, streamedPlaybackObserved });
}
