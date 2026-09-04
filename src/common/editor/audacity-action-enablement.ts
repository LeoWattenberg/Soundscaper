/* SPDX-License-Identifier: AGPL-3.0-only */

export function audacitySpectrogramTrackSelected(
	selectedAudioTrack: Readonly<Record<string, unknown>> | null | undefined,
	snapshot: Readonly<Record<string, unknown>>,
): boolean {
	const timeline = snapshot.timeline as Readonly<Record<string, unknown>> | null | undefined;
	// Both halves of a multi-view track carry a spectrogram, and the timeline
	// view is what a track without a display of its own is drawn as, so the
	// spectral tools are reachable in either display from either place.
	return Boolean(selectedAudioTrack) && (
		selectedAudioTrack?.displayMode === 'spectrogram'
		|| selectedAudioTrack?.displayMode === 'multiview'
		|| timeline?.view === 'spectrogram'
		|| timeline?.view === 'multiview'
	);
}
