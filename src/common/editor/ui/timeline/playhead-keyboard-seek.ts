/* SPDX-License-Identifier: AGPL-3.0-only */

interface PlayheadKey {
	readonly key: string;
	readonly shiftKey: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly altKey: boolean;
}

/** Resolve the seek keys owned by the timeline slider. */
export function playheadKeyboardSeekFrame(
	event: PlayheadKey,
	positionFrame: number,
	sampleRate: number,
	durationFrames: number,
): number | null {
	if (event.ctrlKey || event.metaKey || event.altKey) return null;
	const amount = event.shiftKey ? Math.round(sampleRate / 10) : 1;
	if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
		return Math.max(0, Math.round(positionFrame)) + (event.key === 'ArrowLeft' ? -amount : amount);
	}
	if (event.key === 'Home' || event.key === 'End') return event.key === 'Home' ? 0 : durationFrames;
	return null;
}
