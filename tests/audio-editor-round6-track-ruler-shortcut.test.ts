/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { handleTrackRulerKeyboard } from '../src/common/editor/ui/timeline/track-ruler-keyboard.ts';
import { createTrackRowFocusRouter } from '../src/common/editor/ui/timeline/useTrackRowFocusNavigation.js';

function fixture() {
	const calls: string[] = [];
	const router = createTrackRowFocusRouter({ trackIndex: 1, trackCount: 3, hasTrackRuler: true,
		onFocusTimelineRuler: () => false, onFocusTrackContainer: (index: number) => { calls.push(`track:${index}`); return true; },
		onFocusTrackPanelControl: () => false, onFocusTrackClip: () => false,
		onFocusTrackRuler: (index: number) => { calls.push(`ruler:${index}`); return true; },
		onFocusSelectionToolbar: () => false,
	});
	return { calls, actions: { openMenu: () => calls.push('menu'), focusBefore: router.focusBeforeRuler,
		focusAfter: router.focusAfterRuler, focusVertical: router.focusRulerVertical, focusTrack: router.focusCurrentTrack } };
}

for (const ownership of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented'] as const) {
	test(`native vertical-ruler traversal releases ${ownership} project commands`, () => {
		const { calls, actions } = fixture();
		for (const key of ['ArrowDown', 'ArrowUp', 'Tab', 'Escape', 'F10', 'ContextMenu']) {
			let prevented = false;
			handleTrackRulerKeyboard({ key, shiftKey: true, [ownership]: true, preventDefault: () => { prevented = true; } }, actions);
			assert.equal(prevented, false, key);
			assert.deepEqual(calls, [], key);
		}
	});
}

test('native vertical-ruler plain and Shift traversal retains exact row destinations', () => {
	const { calls, actions } = fixture();
	for (const [key, shiftKey] of [
		['ArrowDown', false], ['ArrowUp', true], ['Tab', false], ['Tab', true], ['Escape', false],
	] as const) {
		let prevented = false;
		handleTrackRulerKeyboard({ key, shiftKey, preventDefault: () => { prevented = true; } }, actions);
		assert.equal(prevented, true, key);
	}
	assert.deepEqual(calls, ['ruler:2', 'ruler:0', 'track:2', 'track:1', 'track:1']);
});

test('native vertical-ruler menu entry preserves the existing opener and leaves other keys available', () => {
	const { calls, actions } = fixture();
	for (const [key, shiftKey] of [['ContextMenu', false], ['F10', true], ['F10', false], ['b', false]] as const) {
		handleTrackRulerKeyboard({ key, shiftKey, preventDefault: () => assert.fail('the menu opener owns prevention') }, actions);
	}
	assert.deepEqual(calls, ['menu', 'menu']);
});
