/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createMouseShortcutGesture } from '../src/common/editor/controller/preferences/mouse-shortcut-gesture.ts';

function releaseEvent(button: number) {
	return {
		button,
		prevented: 0,
		stopped: 0,
		preventDefault() { this.prevented += 1; },
		stopPropagation() { this.stopped += 1; },
	};
}

test('unclaimed mouse releases and auxiliary clicks retain browser behavior', () => {
	const gesture = createMouseShortcutGesture();
	const event = releaseEvent(3);
	assert.equal(gesture.release(event), false);
	assert.equal(gesture.auxiliaryClick(event), false);
	assert.deepEqual([event.prevented, event.stopped], [0, 0]);
});

test('a consumed press cancels release and auxiliary click after the shortcut context changes', () => {
	const gesture = createMouseShortcutGesture();
	gesture.claim(3);
	const release = {
		...releaseEvent(3),
		ctrlKey: false,
		shiftKey: false,
		defaultPrevented: true,
		target: { closest: () => ({ role: 'dialog' }) },
	};
	assert.equal(gesture.release(release), true);
	assert.deepEqual([release.prevented, release.stopped], [1, 1]);
	const auxiliary = releaseEvent(3);
	assert.equal(gesture.auxiliaryClick(auxiliary), true);
	assert.deepEqual([auxiliary.prevented, auxiliary.stopped], [1, 1]);
	assert.equal(gesture.auxiliaryClick(releaseEvent(3)), false);
	assert.equal(gesture.release(releaseEvent(3)), false);
});

test('simultaneous extra buttons finish independently', () => {
	const gesture = createMouseShortcutGesture();
	gesture.claim(3);
	gesture.claim(4);
	assert.equal(gesture.release(releaseEvent(3)), true);
	assert.equal(gesture.auxiliaryClick(releaseEvent(3)), true);
	assert.equal(gesture.release(releaseEvent(4)), true);
	assert.equal(gesture.auxiliaryClick(releaseEvent(4)), true);
	assert.equal(gesture.release(releaseEvent(3)), false);
	assert.equal(gesture.release(releaseEvent(4)), false);
});

test('a new unassigned press forgets an earlier gesture that had no auxiliary click', () => {
	const gesture = createMouseShortcutGesture();
	gesture.claim(3);
	gesture.claim(4);
	assert.equal(gesture.release(releaseEvent(3)), true);
	gesture.forget(3);
	const unassignedRelease = releaseEvent(3);
	assert.equal(gesture.release(unassignedRelease), false);
	assert.equal(gesture.auxiliaryClick(unassignedRelease), false);
	assert.deepEqual([unassignedRelease.prevented, unassignedRelease.stopped], [0, 0]);
	assert.equal(gesture.release(releaseEvent(4)), true);
	gesture.claim(3);
	assert.equal(gesture.release(releaseEvent(3)), true);
});

test('standard and invalid mouse buttons cannot be claimed', () => {
	const gesture = createMouseShortcutGesture();
	for (const button of [0, 1, 2, -1, 3.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
		gesture.claim(button);
		const event = releaseEvent(button);
		assert.equal(gesture.release(event), false, String(button));
		assert.equal(gesture.auxiliaryClick(event), false, String(button));
		assert.deepEqual([event.prevented, event.stopped], [0, 0], String(button));
	}
	gesture.claim(7);
	assert.equal(gesture.release(releaseEvent(7)), true);
});

test('disposal clears every claim and supports a subsequent effect setup', () => {
	const gesture = createMouseShortcutGesture();
	gesture.claim(3);
	gesture.claim(4);
	gesture.dispose();
	gesture.dispose();
	assert.equal(gesture.release(releaseEvent(3)), false);
	assert.equal(gesture.auxiliaryClick(releaseEvent(4)), false);
	gesture.claim(3);
	assert.equal(gesture.release(releaseEvent(3)), true);
});
