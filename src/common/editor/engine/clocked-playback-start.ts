/* SPDX-License-Identifier: AGPL-3.0-only */

/** Confirm the recorder's audio-thread start before scheduling playback sources. */
export type ClockedPlaybackStartHook = (sourceStartTime: number) => Promise<number>;

export async function confirmClockedPlaybackStart(
	context: BaseAudioContext,
	candidate: number,
	hook?: ClockedPlaybackStartHook,
): Promise<number> {
	if (!hook) return candidate;
	const confirmed = await hook(candidate);
	if (!Number.isFinite(confirmed) || confirmed < candidate || confirmed <= context.currentTime) {
		throw new RangeError('The recorder did not confirm a future playback start.');
	}
	return confirmed;
}
