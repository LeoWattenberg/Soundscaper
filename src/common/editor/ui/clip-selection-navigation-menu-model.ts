/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS as ACTION_IDS } from './application-menu-registry.ts';

interface ClipSelectionNavigationMenuProject {
	readonly clips: readonly Readonly<{ id: string; kind?: string }>[];
	readonly tracks: readonly Readonly<{ id: string; type: string; clipIds?: readonly string[] }>[];
	readonly selection?: Readonly<{ trackIds?: readonly string[] }> | null;
}

interface ClipSelectionNavigationMenuInput {
	readonly blocked: boolean;
	readonly copy: Readonly<Record<string, string>>;
	readonly project: ClipSelectionNavigationMenuProject | null;
	readonly selectedTrackId: string | null;
}

interface ClipSelectionNavigationMenuActions {
	readonly selectNoTracks: () => unknown;
	readonly selectPreviousClipBoundaryToCursor: () => unknown;
	readonly selectCursorToNextClipBoundary: () => unknown;
	readonly selectPreviousClip: () => unknown;
	readonly selectNextClip: () => unknown;
	readonly skipToSelectionStart: () => unknown;
	readonly skipToSelectionEnd: () => unknown;
}

export function createClipSelectionNavigationMenuModel(
	input: ClipSelectionNavigationMenuInput,
	actions: ClipSelectionNavigationMenuActions,
) {
	const projectTrackIds = new Set(input.project?.tracks.map(({ id }) => id) ?? []);
	const selectedTrackIds = input.project?.selection?.trackIds ?? [];
	const hasTrackSelection = selectedTrackIds.some((id) => projectTrackIds.has(id))
		|| Boolean(input.selectedTrackId && projectTrackIds.has(input.selectedTrackId));
	const audioClipIds = new Set(input.project?.clips
		.filter(({ kind }) => kind === undefined || kind === 'audio')
		.map(({ id }) => id) ?? []);
	const hasAudioClips = Boolean(input.project?.tracks.some((track) => (
		track.type === 'audio' && track.clipIds?.some((clipId) => audioClipIds.has(clipId))
	)));
	const clipNavigationBlocked = input.blocked || !hasAudioClips;

	return Object.freeze({
		selectNoTracks: Object.freeze({
			id: ACTION_IDS.selectNoTracks,
			label: input.copy.noTracks,
			disabled: !hasTrackSelection,
			onClick: actions.selectNoTracks,
		}),
		audioClips: Object.freeze({
			id: 'menu-selection-audio-clips',
			label: input.copy.selectAudioClips,
			items: Object.freeze([
				item(ACTION_IDS.selectPreviousClipBoundaryToCursor, input.copy.previousClipBoundaryToCursor, clipNavigationBlocked, actions.selectPreviousClipBoundaryToCursor),
				item(ACTION_IDS.selectCursorToNextClipBoundary, input.copy.cursorToNextClipBoundary, clipNavigationBlocked, actions.selectCursorToNextClipBoundary),
				item(ACTION_IDS.selectPreviousClip, input.copy.previousClip, clipNavigationBlocked, actions.selectPreviousClip),
				item(ACTION_IDS.selectNextClip, input.copy.nextClip, clipNavigationBlocked, actions.selectNextClip),
			]),
		}),
		skip: Object.freeze({
			id: 'menu-skip',
			label: input.copy.skipTo,
			items: Object.freeze([
				item(ACTION_IDS.skipToSelectionStart, input.copy.selectionStart, !input.project, actions.skipToSelectionStart),
				item(ACTION_IDS.skipToSelectionEnd, input.copy.selectionEnd, !input.project, actions.skipToSelectionEnd),
			]),
		}),
	});
}

function item(id: string, label: string, disabled: boolean, onClick: () => unknown) {
	return Object.freeze({ id, label, disabled, onClick });
}
