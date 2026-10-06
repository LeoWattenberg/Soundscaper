/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrackRowFocusRouter } from '../src/common/editor/ui/timeline/useTrackRowFocusNavigation.js';

for (const operation of ['track', 'panel', 'ruler', 'after', 'before'] as const) {
	test(`${operation} routing skips the missing row in a collapsed folder`, () => {
		const attempts: string[] = [];
		const focus = (kind: string, index: number) => {
			attempts.push(`${kind}:${index}`);
			return index !== 1;
		};
		const router = createTrackRowFocusRouter({
			trackIndex: operation === 'before' ? 2 : 0, trackCount: 3, hasTrackRuler: true,
			onFocusTimelineRuler: () => false, onFocusSelectionToolbar: () => false,
			onFocusTrackContainer: (index: number) => focus('track', index),
			onFocusTrackPanelControl: (index: number) => focus('panel', index),
			onFocusTrackClip: (index: number) => focus('clip', index),
			onFocusTrackRuler: (index: number) => focus('ruler', index),
		});
		const result = operation === 'track' ? router.focusTrackVertical(1)
			: operation === 'panel' ? router.focusPanelVertical('down')
			: operation === 'ruler' ? router.focusRulerVertical('down')
			: operation === 'after' ? router.focusAfterTrack() : router.focusBeforeTrack();
		assert.equal(result, true);
		assert.equal(attempts.at(-1), `${operation === 'before' ? 'ruler' : operation === 'after' ? 'track' : operation}:${operation === 'before' ? 0 : 2}`);
	});
}

test('row routing reaches the timeline and selection toolbar after all remaining rows are hidden', () => {
	let focus = '';
	const router = createTrackRowFocusRouter({
		trackIndex: 1, trackCount: 3, hasTrackRuler: true,
		onFocusTimelineRuler: () => { focus = 'timeline'; return true; },
		onFocusSelectionToolbar: () => { focus = 'selection'; return true; },
		onFocusTrackContainer: () => false, onFocusTrackPanelControl: () => false,
		onFocusTrackClip: () => false, onFocusTrackRuler: () => false,
	});
	assert.equal(router.focusBeforeTrack(), true);
	assert.equal(focus, 'timeline');
	assert.equal(router.focusAfterTrack(), true);
	assert.equal(focus, 'selection');
});
