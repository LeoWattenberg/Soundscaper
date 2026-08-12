/* SPDX-License-Identifier: AGPL-3.0-only */

// Keep application-menu parity metadata as data consumed by both the renderer
// and tests. This avoids coupling inventory checks to JSX source formatting.
export const AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS = Object.freeze({
	openLabelEditor: 'labels',
	openMetadataEditor: 'metadata',
	selectAllTracks: 'select-all-tracks',
	selectNoTracks: 'select-no-tracks',
	selectPreviousClipBoundaryToCursor: 'select-previous-clip-boundary-to-cursor',
	selectCursorToNextClipBoundary: 'select-cursor-to-next-clip-boundary',
	selectPreviousClip: 'select-previous-clip',
	selectNextClip: 'select-next-clip',
	skipToSelectionStart: 'skip-to-selection-start',
	skipToSelectionEnd: 'skip-to-selection-end',
	selectLeftOfPlaybackPosition: 'left-at-playback',
	selectRightOfPlaybackPosition: 'right-at-playback',
	selectTrackStartToCursor: 'track-start-cursor',
	selectCursorToTrackEnd: 'cursor-track-end',
	selectTrackStartToEnd: 'select-track-start-to-end',
	toggleLoopRegion: 'toggle-loop-region',
	clearLoopRegion: 'clear-loop-region',
	setLoopRegionToSelection: 'set-loop-region-to-selection',
	setLoopRegionInOut: 'set-loop-region-in-out',
	toggleRmsInWaveform: 'show-rms',
	recordOnNewTrack: 'record-on-new-track',
	pauseRecording: 'action://record/pause',
	leadInRecording: 'action://record/lead-in-recording',
	setUpTimedRecording: 'set-up-timed-recording',
	toggleSoundActivatedRecording: 'toggle-sound-activated-recording',
	setSoundActivationLevel: 'set-sound-activation-level',
	metronome: 'metronome',
	trackResample: 'resample',
	repeatLastEffect: 'repeat-effect',
	onlineHandbook: 'manual',
	support: 'support',
	revertFactory: 'revert-factory',
	aboutAudacity: 'about',
} as const);

export type AudioEditorApplicationMenuActionId =
	typeof AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS[keyof typeof AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS];

export const AUDIO_EDITOR_CRITICAL_APPLICATION_MENU_ACTION_IDS = Object.freeze(
	Object.values(AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS),
);

export const AUDIO_EDITOR_UNAVAILABLE_APPLICATION_MENU_ACTION_IDS = Object.freeze([
	'repeat-generator',
	'repeat-analyzer',
] as const);

export type AudioEditorUnavailableApplicationMenuActionId =
	typeof AUDIO_EDITOR_UNAVAILABLE_APPLICATION_MENU_ACTION_IDS[number];

const UNAVAILABLE_APPLICATION_MENU_ACTION_IDS = new Set<string>(
	AUDIO_EDITOR_UNAVAILABLE_APPLICATION_MENU_ACTION_IDS,
);

export interface UnavailableApplicationMenuItem {
	readonly id: AudioEditorUnavailableApplicationMenuActionId;
	readonly label: string;
	readonly disabled: true;
}

export function createUnavailableApplicationMenuItem(
	id: AudioEditorUnavailableApplicationMenuActionId,
	label: string,
): UnavailableApplicationMenuItem {
	if (!UNAVAILABLE_APPLICATION_MENU_ACTION_IDS.has(id)) {
		throw new RangeError(`Unknown unavailable application-menu action: ${id}`);
	}
	return { id, label, disabled: true };
}
