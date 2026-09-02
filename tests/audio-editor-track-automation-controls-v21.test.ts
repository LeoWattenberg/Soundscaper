/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createTrackAutomationControlsState,
	reconcileTrackAutomationControlsState,
	selectTrackAutomationTarget,
	trackAutomationSelectionContainsLane,
	toggleTrackAutomationControls,
} from '../src/common/editor/ui/timeline/track-automation-controls-state.ts';
import {
	normalizeTrackAutomationMode,
	TRACK_AUTOMATION_MODES,
} from '../src/common/editor/track-automation-runtime.ts';

const targets = Object.freeze([
	Object.freeze({ key: 'gain', disabledReason: null }),
	Object.freeze({ key: 'route', disabledReason: null }),
	Object.freeze({ key: 'blocked', disabledReason: 'Unavailable' }),
	Object.freeze({ key: 'pan', disabledReason: null }),
]);

test('track automation controls opt in independently and default to the first writable target', () => {
	let state = createTrackAutomationControlsState();
	state = toggleTrackAutomationControls(state, 'voice', targets);
	state = toggleTrackAutomationControls(state, 'music', targets.slice(2));

	assert.deepEqual(state, { voice: 'gain', music: 'pan' });
	assert.deepEqual(toggleTrackAutomationControls(state, 'voice', targets), { music: 'pan' });
});

test('track automation controls retain valid selections and reconcile removed or blocked targets', () => {
	const routed = selectTrackAutomationTarget({ voice: 'gain' }, 'voice', 'route', targets);
	const selected = selectTrackAutomationTarget(routed, 'voice', 'pan', targets);
	assert.deepEqual(selected, { voice: 'pan' });
	assert.throws(
		() => selectTrackAutomationTarget(selected, 'voice', 'blocked', targets),
		/available/iu,
	);
	assert.deepEqual(reconcileTrackAutomationControlsState(selected, new Map([
		['voice', targets.slice(0, 3)],
		['music', targets],
	])), { voice: 'gain' });
	assert.deepEqual(reconcileTrackAutomationControlsState(routed, new Map([
		['voice', targets.filter(({ key }) => key !== 'route')],
	])), { voice: 'gain' });
	assert.deepEqual(reconcileTrackAutomationControlsState(selected, new Map()), {});
});

test('runtime lane ownership follows only the currently visible selected target', () => {
	const lanes = new Map([['voice', [
		{ key: 'gain', disabledReason: null, lane: { id: 'gain-lane' } },
		{ key: 'route', disabledReason: null, lane: { id: 'route-lane' } },
	]]]);
	assert.equal(trackAutomationSelectionContainsLane({ voice: 'route' }, lanes, 'route-lane'), true);
	assert.equal(trackAutomationSelectionContainsLane({ voice: 'gain' }, lanes, 'route-lane'), false);
	assert.equal(trackAutomationSelectionContainsLane({}, lanes, 'route-lane'), false);
});

test('track automation runtime modes are stable and unknown modes read safely', () => {
	assert.deepEqual(TRACK_AUTOMATION_MODES, ['read', 'trim', 'touch', 'latch', 'write']);
	assert.equal(normalizeTrackAutomationMode('latch'), 'latch');
	assert.equal(normalizeTrackAutomationMode('surprise'), 'read');
});
