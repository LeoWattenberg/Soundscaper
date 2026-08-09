/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorControllerState } from '../src/common/editor/controller/state.ts';

function createState() {
	return createEditorControllerState({
		preferences: { workspace: 'music' },
		recordingRouting: { routes: {} },
		effectPresets: { presets: [] },
		initialEffectType: 'amplify',
		phase: 'booting',
		readyMessage: 'Ready',
		mobile: false,
		defaultPixelsPerSecond: 120,
		timelineMinimumSeconds: 30,
		recordingInputGain: 1,
		preferredInputDeviceId: 'default',
	});
}

test('controller state initializes deterministic composition-root defaults', () => {
	const state = createState();
	assert.equal(state.phase, 'booting');
	assert.equal(state.timelineWidth, 3_600);
	assert.equal(state.timelineView, 'waveform');
	assert.equal(state.saveState, 'saved');
	assert.deepEqual(state.status, { message: 'Ready', state: 'info' });
	assert.equal(state.recordingInputGain, 1);
	assert.equal(state.preferredInputDeviceId, 'default');
	assert.equal(state.selectedAnnotationId, null);
});

test('controller instances never share mutable collections', () => {
	const first = createState();
	const second = createState();
	first.missingSourceIds.add('source-1');
	first.audacityEffectTouchedParams.set('amplify', new Set(['gain']));
	assert.equal(second.missingSourceIds.size, 0);
	assert.equal(second.audacityEffectTouchedParams.size, 0);
	assert.notEqual(first.saveQueue, second.saveQueue);
});
