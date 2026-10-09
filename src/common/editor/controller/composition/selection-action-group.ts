/* SPDX-License-Identifier: AGPL-3.0-only */

import type { createTrackAudioComposition } from '../track-audio/track-audio-composition.ts';
import { deferControllerMethods } from './internal/deferred-controller-methods.ts';

type SelectionView = ReturnType<typeof createTrackAudioComposition>['selectionView'];

interface EditorSelectionActionGroupDependencies {
	getSelectionView(): SelectionView;
}

const editorSelectionActionGroups = new WeakSet<object>();

/** Build the public selection portion of the timeline port without resolving its owner. */
export function createEditorSelectionActionGroup(dependencies: EditorSelectionActionGroupDependencies) {
	const navigation = deferControllerMethods(
		() => dependencies.getSelectionView().clipNavigation,
		[
			'selectPreviousClipBoundaryToCursor',
			'selectCursorToNextClipBoundary',
			'selectPreviousClip',
			'selectNextClip',
			'skipToSelectionStart',
			'skipToSelectionEnd',
			'selectNoTracks',
		],
	);
	const boundaryAdjustment = deferControllerMethods(
		() => dependencies.getSelectionView().boundaryAdjustment,
		['extendSelectionLeft', 'extendSelectionRight', 'contractSelectionLeft', 'contractSelectionRight',
			'extendSelectionToProjectStart', 'extendSelectionToProjectEnd'],
	);
	const {
		selectTrack, selectClip, setSelection, setExactSelection, adjustSelection, selectAll, selectAllTracks,
		selectLeftOfPlaybackPosition, selectRightOfPlaybackPosition, selectTrackStartToCursor,
		selectCursorToTrackEnd, selectTrackStartToEnd, setSnapSettings, snapTimelineFrame,
		selectAtZeroCrossings,
	} = deferControllerMethods(dependencies.getSelectionView, [
		'selectTrack', 'selectClip', 'setSelection', 'setExactSelection', 'adjustSelection', 'selectAll', 'selectAllTracks',
		'selectLeftOfPlaybackPosition', 'selectRightOfPlaybackPosition', 'selectTrackStartToCursor',
		'selectCursorToTrackEnd', 'selectTrackStartToEnd', 'setSnapSettings', 'snapTimelineFrame',
		'selectAtZeroCrossings',
	]);
	const actions = Object.freeze({
		...navigation,
		...boundaryAdjustment,
		selectTrack,
		selectClip,
		setSelection,
		setExactSelection,
		adjustSelection,
		clearSelection: () => setSelection(0, 0, { trackIds: [], frequencyRange: null }),
		selectAll,
		selectAllTracks,
		selectLeftOfPlayback: selectLeftOfPlaybackPosition,
		selectRightOfPlayback: selectRightOfPlaybackPosition,
		selectTrackStartToCursor,
		selectCursorToTrackEnd,
		selectTrackStartToEnd,
		setSnap: setSnapSettings,
		snapFrame: (...args: Parameters<typeof snapTimelineFrame>) => snapTimelineFrame(...args),
		zeroCross: selectAtZeroCrossings,
	});
	editorSelectionActionGroups.add(actions);
	return actions;
}

export type EditorSelectionActionGroup = ReturnType<typeof createEditorSelectionActionGroup>;

/** Admit only the grouped selection port built by its owner. */
export function assertEditorSelectionActionGroup(value: unknown): asserts value is EditorSelectionActionGroup {
	if (!value || typeof value !== 'object'
		|| typeof Object.getOwnPropertyDescriptor(value, 'setExactSelection')?.value !== 'function') {
		throw new TypeError('Missing editor action dependency: selection.setExactSelection.');
	}
	if (!editorSelectionActionGroups.has(value)) {
		throw new TypeError('Invalid editor action dependency: selection.');
	}
}
