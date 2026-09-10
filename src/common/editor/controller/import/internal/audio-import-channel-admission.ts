/* SPDX-License-Identifier: AGPL-3.0-only */

export const AUDIO_IMPORT_MAXIMUM_CHANNEL_COUNT = 32;

/** Keep project imports within the 32-channel playback/editing graph; codec primitives remain wider. */
export function admitAudioImportChannelCount(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1
		|| Number(value) > AUDIO_IMPORT_MAXIMUM_CHANNEL_COUNT) {
		throw new RangeError(
			`Audio import supports 1–${AUDIO_IMPORT_MAXIMUM_CHANNEL_COUNT} channels; the source declares ${String(value)}.`,
		);
	}
	return Number(value);
}
