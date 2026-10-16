/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorSelectionActionGroup } from '../src/common/editor/controller/composition/selection-action-group.ts';

const EXPECTED_SELECTION_ACTIONS = Object.freeze([
	'selectPreviousClipBoundaryToCursor',
	'selectCursorToNextClipBoundary',
	'selectPreviousClip',
	'selectNextClip',
	'skipToSelectionStart',
	'skipToSelectionEnd',
	'selectNoTracks',
	'extendSelectionLeft',
	'extendSelectionRight',
	'contractSelectionLeft',
	'contractSelectionRight',
	'extendSelectionToProjectStart',
	'extendSelectionToProjectEnd',
	'selectTrack',
	'selectClip',
	'setSelection',
	'setExactSelection',
	'adjustSelection',
	'clearSelection',
	'selectAll',
	'selectAllTracks',
	'selectLeftOfPlayback',
	'selectRightOfPlayback',
	'selectTrackStartToCursor',
	'selectCursorToTrackEnd',
	'selectTrackStartToEnd',
	'setSnap',
	'snapFrame',
	'zeroCross',
] as const);

test('the selection action group preserves the public timeline names and resolves its owner per call', () => {
	const calls: Array<readonly [string, ...unknown[]]> = [];
	let reads = 0;
	const method = (name: string) => (...args: unknown[]) => {
		calls.push([name, ...args]);
		return name;
	};
	const selectionView = {
		clipNavigation: Object.freeze(Object.fromEntries(EXPECTED_SELECTION_ACTIONS.slice(0, 7).map((name) => [
			name, method(name),
		]))),
		boundaryAdjustment: Object.freeze(Object.fromEntries(EXPECTED_SELECTION_ACTIONS.slice(7, 13).map((name) => [
			name, method(name),
		]))),
		selectTrack: method('selectTrack'),
		selectClip: method('selectClip'),
		setSelection: method('setSelection'),
		setExactSelection: method('setExactSelection'),
		adjustSelection: method('adjustSelection'),
		selectAll: method('selectAll'),
		selectAllTracks: method('selectAllTracks'),
		selectLeftOfPlaybackPosition: method('selectLeftOfPlaybackPosition'),
		selectRightOfPlaybackPosition: method('selectRightOfPlaybackPosition'),
		selectTrackStartToCursor: method('selectTrackStartToCursor'),
		selectCursorToTrackEnd: method('selectCursorToTrackEnd'),
		selectTrackStartToEnd: method('selectTrackStartToEnd'),
		setSnapSettings: method('setSnapSettings'),
		snapTimelineFrame: method('snapTimelineFrame'),
		selectAtZeroCrossings: method('selectAtZeroCrossings'),
	};
	const selection = createEditorSelectionActionGroup({
		getSelectionView: () => {
			reads += 1;
			return selectionView as never;
		},
	});

	assert.equal(Object.isFrozen(selection), true);
	assert.deepEqual(Object.keys(selection), EXPECTED_SELECTION_ACTIONS);
	assert.equal(reads, 0);
	assert.equal(selection.selectNextClip(), 'selectNextClip');
	assert.equal(selection.selectTrack('track'), 'selectTrack');
	assert.equal(selection.clearSelection(), 'setSelection');
	assert.equal(selection.setSnap({ mode: 'seconds' }), 'setSnapSettings');
	assert.equal(selection.snapFrame(12.4), 'snapTimelineFrame');
	assert.equal(selection.zeroCross(), 'selectAtZeroCrossings');
	assert.equal(reads, 6);
	assert.deepEqual(calls, [
		['selectNextClip'],
		['selectTrack', 'track'],
		['setSelection', 0, 0, { trackIds: [], frequencyRange: null }],
		['setSnapSettings', { mode: 'seconds' }],
		['snapTimelineFrame', 12.4],
		['selectAtZeroCrossings'],
	]);
});

test('selection owner failures stay synchronous and occur only on invocation', () => {
	let reads = 0;
	const selection = createEditorSelectionActionGroup({
		getSelectionView: () => {
			reads += 1;
			throw new Error('selection unavailable');
		},
	});

	assert.equal(reads, 0);
	assert.throws(() => selection.selectAll(), /selection unavailable/u);
	assert.equal(reads, 1);
});
