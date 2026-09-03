/* SPDX-License-Identifier: AGPL-3.0-only */

// `decodeAudioData` resamples its output to the decoding context's rate, and the
// Web Audio API offers no way to ask it not to. Decoding on a throwaway offline
// context pinned to the file's own rate leaves it nothing to resample, so an
// imported 44.1 kHz MP3 keeps the rate it was authored at instead of inheriting
// whatever the output device happens to run at. A browser without an
// OfflineAudioContext, or one that refuses the rate, falls back to the realtime
// context and decodes as it always did.

const MINIMUM_DECODE_SAMPLE_RATE = 3_000;
const MAXIMUM_DECODE_SAMPLE_RATE = 768_000;

interface PinnedDecodeContext {
	readonly sampleRate: number;
	decodeAudioData?(encoded: ArrayBuffer): Promise<AudioBuffer>;
}

/** Rates outside what a browser will render return null and decode unpinned. */
export function normalizeDecodeSampleRate(sampleRate: unknown): number | null {
	const rate = Number(sampleRate);
	if (!Number.isFinite(rate)) return null;
	return rate >= MINIMUM_DECODE_SAMPLE_RATE && rate <= MAXIMUM_DECODE_SAMPLE_RATE ? rate : null;
}

/** Resolves to null whenever the pinned decode cannot stand in for the realtime one. */
export async function decodeAtSourceSampleRate(
	createContext: (sampleRate: number) => PinnedDecodeContext,
	encoded: ArrayBuffer,
	sampleRate: number,
): Promise<AudioBuffer | null> {
	let context: PinnedDecodeContext;
	try {
		context = createContext(sampleRate);
	} catch {
		return null;
	}
	if (typeof context?.decodeAudioData !== 'function' || context.sampleRate !== sampleRate) return null;
	try {
		// `decodeAudioData` detaches the buffer it is handed, so the realtime
		// fallback needs this decode to run against a copy.
		const decoded = await context.decodeAudioData(encoded.slice(0));
		return decoded?.length ? decoded : null;
	} catch {
		return null;
	}
}
