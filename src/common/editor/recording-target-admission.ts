/* SPDX-License-Identifier: AGPL-3.0-only */

export interface RecordingAdmissionTrack {
	readonly id: string;
	readonly type?: string;
	readonly armed?: boolean;
	readonly locked?: unknown;
	readonly laneGroupId?: unknown;
}

export interface RecordingAdmissionProject {
	readonly tracks: readonly RecordingAdmissionTrack[];
}

/** Resolve the same focused audio owner used by the ordinary Record action. */
export function focusedRecordingTrackId(
	project: RecordingAdmissionProject | null | undefined,
	selectedTrackId: string | null | undefined,
	multitrack: boolean,
): string | undefined {
	if (multitrack) return undefined;
	const selected = project?.tracks.find(track => track.id === selectedTrackId);
	const pairedAudio = selected?.type === 'video' && selected.laneGroupId
		? project?.tracks.find(track => track.type === 'audio' && track.laneGroupId === selected.laneGroupId)
		: null;
	return selected?.type === 'audio' ? selected.id
		: pairedAudio?.id ?? project?.tracks.find(track => track.type === 'audio')?.id;
}

/** Unassigned armed tracks are skipped by routed capture, rather than edited. */
export function hasLockedRecordingTarget(
	project: RecordingAdmissionProject | null | undefined,
	trackId: string | undefined,
	routes: Readonly<Record<string, unknown>> | null | undefined,
): boolean {
	return project?.tracks.some(track => track.locked === true && (trackId
		? track.id === trackId
		: track.type === 'audio' && track.armed === true && Boolean(routes?.[track.id]))) ?? false;
}

/** Refuse before requesting native input or creating PCM that cannot be saved. */
export function assertRecordingTargetsUnlocked(tracks: readonly RecordingAdmissionTrack[]): void {
	const locked = tracks.find(track => track.locked === true);
	if (locked) throw new RangeError(`Track ${locked.id} is locked.`);
}
