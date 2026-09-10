/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorControllerState } from '../src/common/editor/controller/composition/internal/state.ts';

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
	assert.deepEqual(state.deliveryPresets, { schemaVersion: 1, presets: [] });
});

test('controller instances never share mutable collections', () => {
	const first = createState();
	const second = createState();
	first.missingSourceIds.add('source-1');
	assert.equal(second.missingSourceIds.size, 0);
	assert.equal(second.audacityEffectTouchedParams.size, 0);
	assert.notEqual(first.missingSourceIds, second.missingSourceIds);
	assert.notEqual(first.audacityEffectTouchedParams, second.audacityEffectTouchedParams);
});

test('controller state preserves the supplied document history contract', async () => {
	const { createControllerDocumentState } = await import('../src/common/editor/controller/document/document-state.ts');
	const history = { present: { id: 'project', title: 'Original' }, origin: 'retained-session' };
	const document = createControllerDocumentState<typeof history.present, typeof history>();
	const state = createEditorControllerState({
		document, preferences: {}, recordingRouting: {}, effectPresets: {},
		initialEffectType: 'amplify', phase: 'booting', readyMessage: 'Ready', mobile: false,
		defaultPixelsPerSecond: 120, timelineMinimumSeconds: 30,
		recordingInputGain: 1, preferredInputDeviceId: 'default',
	});
	state.history = history;
	document.project = { id: 'project', title: 'Updated' };
	assert.equal(state.history.origin, 'retained-session');
	assert.equal(state.history.present.title, 'Updated');
});
