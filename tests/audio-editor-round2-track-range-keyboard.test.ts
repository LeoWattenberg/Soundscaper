/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrackRowFocusRouter } from '../src/common/editor/ui/timeline/useTrackRowFocusNavigation.js';
import { extendTrackRowSelection } from '../src/common/editor/ui/timeline/track-row-selection-extension.ts';

for (const extend of [false, true]) test(`vertical navigation ${extend ? 'extends selection when Shift is held' : 'retains focus-only routing without Shift'}`, () => {
	const extensions: number[] = [];
	const options = {
		trackIndex: 0, trackCount: 3, hasTrackRuler: true,
		onFocusTimelineRuler: () => false, onFocusSelectionToolbar: () => false,
		onFocusTrackContainer: (index: number) => index === 2,
		onFocusTrackPanelControl: () => false, onFocusTrackClip: () => false, onFocusTrackRuler: () => false,
		onExtendTrackSelection: (index: number) => extensions.push(index),
	};
	const router = createTrackRowFocusRouter(options);
	assert.equal(router.focusTrackVertical(1, extend), true);
	assert.deepEqual(extensions, extend ? [2] : []);
});

test('row range extension preserves time bounds and contracts back to its original anchor', () => {
	type Controller = Parameters<typeof extendTrackRowSelection>[0];
	let selection = { startFrame: 120, endFrame: 480, trackIds: ['second'] as readonly string[] };
	const controller: Controller = {
		getSnapshot: () => ({ project: { tracks: ['first', 'second', 'third'].map(id => ({ id })), selection } }),
		actions: { timeline: { setSelection: (startFrame, endFrame, details) => {
			selection = { startFrame, endFrame, trackIds: details.trackIds };
			return selection;
		} } },
	};
	extendTrackRowSelection(controller, 'second', 2);
	assert.deepEqual(selection, { startFrame: 120, endFrame: 480, trackIds: ['second', 'third'] });
	extendTrackRowSelection(controller, 'third', 1);
	assert.deepEqual(selection, { startFrame: 120, endFrame: 480, trackIds: ['second'] });
	extendTrackRowSelection(controller, 'second', 0);
	assert.deepEqual(selection, { startFrame: 120, endFrame: 480, trackIds: ['second', 'first'] });
	assert.equal(extendTrackRowSelection(controller, 'second', 3), null);
});

test('an unselected row provides the first range anchor without extending to unrelated tracks', () => {
	type Controller = Parameters<typeof extendTrackRowSelection>[0];
	let selected: unknown;
	const controller: Controller = {
		getSnapshot: () => ({ project: { tracks: ['first', 'second', 'third'].map(id => ({ id })), selection: null } }),
		actions: { timeline: { setSelection: (...values) => { selected = values; } } },
	};
	extendTrackRowSelection(controller, 'second', 2);
	assert.deepEqual(selected, [0, 0, { trackIds: ['second', 'third'] }]);
});
