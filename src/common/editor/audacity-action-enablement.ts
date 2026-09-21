/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	resolveEditingActionAvailability,
	type EditingAuthorityClip,
	type EditingAuthorityProject,
	type EditingAuthoritySelection,
	type EditingAuthorityTrack,
} from './commands/editing-selection-authority.ts';

type ActionRecord = Readonly<Record<string, unknown>>;

interface ActionSelection extends ActionRecord, EditingAuthoritySelection {
	readonly clipIds?: readonly unknown[];
	readonly endFrame?: unknown;
	readonly frequencyRange?: ActionRecord | null;
	readonly startFrame?: unknown;
	readonly trackIds?: readonly unknown[];
}

interface ActionProject extends ActionRecord, Omit<EditingAuthorityProject, 'selection'> {
	readonly clips: readonly EditingAuthorityClip[];
	readonly selection?: ActionSelection | null;
	readonly tracks: readonly EditingAuthorityTrack[];
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
	const authority = resolveEditingActionAvailability({
		project,
		selection,
		focusedClipId: snapshot.selectedClipId,
		focusedTrackId: snapshot.selectedTrackId,
	});
	const selectedClipIds = authority.clipIds;
	const selectedClips = authority.clips;
	const rangeTrackIds = authority.trackSource === 'persisted' ? authority.trackIds : [];
	const selectedTrackIds = [...new Set([
		...(selectedClipIds.length && authority.trackSource === 'focus' ? [] : authority.trackIds),
		...authority.clipTrackIds,
	])];
	const selectedTracks = selectedTrackIds
		.map((trackId) => tracks.find((track) => track.id === trackId))
		.filter((track): track is EditingAuthorityTrack => Boolean(track));
	const selectedTrack = selectedTracks[0] ?? null;
	const selectedAudioTrack = selectedTracks.find((track) => track.type === 'audio') ?? null;
	const focusedTrack = tracks.find((track) => track.id === snapshot.selectedTrackId) ?? null;
	const selectionNamesTracks = rangeTrackIds.length > 0;
	const selectionAudioTrack = selectionNamesTracks
		? rangeTrackIds.map((trackId) => tracks.find((track) => track.id === trackId))
			.find((track) => track?.type === 'audio') ?? null
		: selectedAudioTrack;
	const selectionTrackIds = authority.trackIds;
	const selectedMediaTrack = selectionTrackIds.some((id) => (
		tracks.some((track) => track.id === id && track.type !== 'label')
	));
	const selectedClip = selectedClips[0]
		?? clips.find((clip) => clip.id === snapshot.selectedClipId)
		?? null;
	const selectedClipTrack = selectedClip
		? tracks.find((track) => Array.isArray(track.clipIds) && track.clipIds.includes(selectedClip.id)) ?? null
		: null;
	const selectedAudioClip = selectedClip
		&& selectedClipTrack?.type === 'audio'
		&& selectedClip.kind !== 'video'
		? selectedClip
		: null;
	const timeSelection = authority.range !== null;
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
		splitAvailable: authority.split,
		joinAvailable: authority.join,
		groupAvailable: authority.group,
		ungroupAvailable: authority.ungroup,
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
