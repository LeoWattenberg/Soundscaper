/* SPDX-License-Identifier: AGPL-3.0-only */

export interface SpectralPlaybackMenuSnapshot {
	readonly capabilities?: Readonly<{ audioSpectralEditing?: boolean }>;
	readonly recording?: unknown;
	readonly project?: Readonly<{ sampleRate: number }> | null;
	readonly selection?: Readonly<{
		startFrame: number;
		endFrame: number;
		frequencyRange?: Readonly<{ minimumFrequency: number; maximumFrequency: number }> | null;
	}> | null;
}

/** Both menu surfaces share the same explicit audition selection requirements. */
export function createSpectralPlaybackMenuItem(
	copy: Readonly<Record<string, string>>,
	snapshot: SpectralPlaybackMenuSnapshot,
	blocked: boolean,
	play: () => unknown,
) {
	if (snapshot.capabilities?.audioSpectralEditing !== true) return null;
	const selection = snapshot.selection;
	const range = selection?.frequencyRange;
	const nyquist = (snapshot.project?.sampleRate ?? Number.POSITIVE_INFINITY) / 2;
	const valid = selection && Number.isFinite(selection.startFrame)
		&& Number.isFinite(selection.endFrame) && selection.startFrame >= 0
		&& selection.endFrame > selection.startFrame
		&& range && Number.isFinite(range.minimumFrequency) && Number.isFinite(range.maximumFrequency)
		&& range.minimumFrequency >= 0 && range.maximumFrequency > range.minimumFrequency
		&& range.maximumFrequency <= nyquist;
	return {
		id: 'play-spectral-selection', label: copy.playSpectralSelection,
		disabled: blocked || Boolean(snapshot.recording) || !valid,
		onClick: play,
	};
}
