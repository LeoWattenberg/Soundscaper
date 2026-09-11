/* SPDX-License-Identifier: AGPL-3.0-only */

type ActionRecord = Readonly<Record<string, unknown>>;

interface ActionSelection extends ActionRecord {
	readonly clipIds?: readonly unknown[];
	readonly endFrame?: unknown;
	readonly frequencyRange?: ActionRecord | null;
	readonly startFrame?: unknown;
	readonly trackIds?: readonly unknown[];
}

interface ActionProject extends ActionRecord {
	readonly clips?: readonly ActionRecord[];
	readonly selection?: ActionSelection | null;
	readonly tracks?: readonly ActionRecord[];
}

interface ActionSnapshot extends ActionRecord {
	readonly project?: ActionProject | null;
	readonly selectedClipId?: unknown;
	readonly selectedTrackId?: unknown;
	readonly selection?: ActionSelection | null;
}

/** Resolve the selection/track facts shared by Audacity's closed action predicates. */
export function resolveAudacityActionSelectionFacts(snapshot: ActionSnapshot) {
	const project = snapshot.project ?? null;
	const tracks = project?.tracks ?? [];
	const clips = project?.clips ?? [];
	const selection = project?.selection ?? snapshot.selection ?? {};
	const selectedClipIds = uniqueExistingIds([
		snapshot.selectedClipId,
		...(selection.clipIds ?? []),
	], clips);
	const selectedClips = selectedClipIds
		.map((clipId) => clips.find((clip) => clip.id === clipId))
		.filter((clip): clip is ActionRecord => Boolean(clip));
	const rangeTrackIds = uniqueExistingIds(selection.trackIds ?? [], tracks);
	const selectedTrackIds = uniqueExistingIds([
		snapshot.selectedTrackId,
		...(selection.trackIds ?? []),
		...selectedClips.map((clip) => tracks.find((track) => (
			Array.isArray(track.clipIds) && track.clipIds.includes(clip.id)
		))?.id),
	], tracks);
	const selectedTracks = selectedTrackIds
		.map((trackId) => tracks.find((track) => track.id === trackId))
		.filter((track): track is ActionRecord => Boolean(track));
	const selectedTrack = selectedTracks[0] ?? null;
	const selectedAudioTrack = selectedTracks.find((track) => track.type === 'audio') ?? null;
	const focusedTrack = tracks.find((track) => track.id === snapshot.selectedTrackId) ?? null;
	const selectionNamesTracks = rangeTrackIds.length > 0;
	const selectionAudioTrack = selectionNamesTracks
		? rangeTrackIds.map((trackId) => tracks.find((track) => track.id === trackId))
			.find((track) => track?.type === 'audio') ?? null
		: selectedAudioTrack;
	const selectionTrackIds = selection.trackIds?.length
		? selection.trackIds
		: [snapshot.selectedTrackId];
	const selectedMediaTrack = selectionTrackIds.some((id) => (
		tracks.some((track) => track.id === id && track.type !== 'label')
	));
	const selectedClip = selectedClips[0] ?? null;
	const selectedClipTrack = selectedClip
		? tracks.find((track) => Array.isArray(track.clipIds) && track.clipIds.includes(selectedClip.id)) ?? null
		: null;
	const selectedAudioClip = selectedClip
		&& selectedClipTrack?.type === 'audio'
		&& selectedClip.kind !== 'video'
		? selectedClip
		: null;
	const timeSelection = Number.isSafeInteger(selection.startFrame)
		&& Number.isSafeInteger(selection.endFrame)
		&& Number(selection.endFrame) > Number(selection.startFrame);
	const frequencySelection = timeSelection
		&& Number.isFinite(selection.frequencyRange?.minimumFrequency)
		&& Number.isFinite(selection.frequencyRange?.maximumFrequency)
		&& Number(selection.frequencyRange?.maximumFrequency) > Number(selection.frequencyRange?.minimumFrequency);
	const projectHasAudio = tracks.some((track) => (
		track.type === 'audio' && Array.isArray(track.clipIds) && track.clipIds.length > 0
	));
	const audioSelection = timeSelection && Boolean(selectionAudioTrack);
	const unscopedAudioSelection = timeSelection && !selectionNamesTracks
		&& (!focusedTrack || focusedTrack.type === 'audio');
	const nonAudioEffectFocus = selectionNamesTracks
		? !selectionAudioTrack
		: Boolean(focusedTrack && focusedTrack.type !== 'audio');
	return {
		project,
		tracks,
		selection,
		selectedClipIds,
		selectedClips,
		selectedTrackIds,
		selectedTrack,
		selectedAudioTrack,
		focusedTrack,
		selectedMediaTrack,
		selectedClip,
		selectedAudioClip,
		timeSelection,
		frequencySelection,
		projectHasAudio,
		audioSelection,
		unscopedAudioSelection,
		nonAudioEffectFocus,
	};
}

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

function uniqueExistingIds(values: readonly unknown[], records: readonly ActionRecord[]): string[] {
	const available = new Set(records.flatMap((record) => (
		typeof record.id === 'string' ? [record.id] : []
	)));
	return [...new Set(values.flatMap((value) => (
		typeof value === 'string' && available.has(value) ? [value] : []
	)))];
}
