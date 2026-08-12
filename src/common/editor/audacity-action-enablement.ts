/* SPDX-License-Identifier: AGPL-3.0-only */

export function audacitySpectrogramTrackSelected(
	selectedAudioTrack: Readonly<Record<string, unknown>> | null | undefined,
	snapshot: Readonly<Record<string, unknown>>,
): boolean {
	const timeline = snapshot.timeline as Readonly<Record<string, unknown>> | null | undefined;
	return Boolean(selectedAudioTrack) && (
		selectedAudioTrack?.displayMode === 'spectrogram'
		|| selectedAudioTrack?.displayMode === 'multiview'
		|| timeline?.view === 'spectrogram'
	);
}
