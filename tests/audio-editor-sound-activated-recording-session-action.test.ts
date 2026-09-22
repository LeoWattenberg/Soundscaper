/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createRecordingSessionService,
	type RecordingSessionMutableState,
} from '../src/common/editor/controller/recording/internal/recording-session-service.ts';

function createState(): RecordingSessionMutableState {
	return {
		readOnly: false, disposed: false, projectBinPreview: null,
		recorder: null, recordingKind: null, recordingStarting: false,
		recordingStartGeneration: 0, recordingStartPromise: null,
		timedRecordingPreparing: false, timedRecording: null,
		recordingEntries: null, recordingPaused: false,
	} as unknown as RecordingSessionMutableState;
}

test('sound activation is selected per recording session and cleared after stop', async () => {
	const state = createState();
	const activation: boolean[] = [];
	const service = createRecordingSessionService({
		state, getProjectId: () => 'project-1',
		setSoundActivationCaptureEnabled: (enabled) => { activation.push(enabled); },
		beginRecording: async () => { state.recorder = { async stop() {} }; },
		performLegacyFinalization: async () => {}, performRoutedFinalization: async () => {},
	});
	await service.startRecording();
	assert.equal(state.recordingKind, 'ordinary');
	await service.stopRecording();
	await service.startSoundActivatedRecording();
	assert.equal(state.recordingKind, 'sound-activated');
	assert.equal(service.startRecording(), undefined);
	await service.stopRecording();
	assert.deepEqual(activation, [false, false, true, false]);
	assert.equal(state.recordingKind, null);
});

test('sound-activated start rejects a selection before changing capture mode', () => {
	const activation: boolean[] = [];
	const service = createRecordingSessionService({
		state: createState(), getProjectId: () => 'project-1',
		canStartSoundActivatedRecording: () => false,
		setSoundActivationCaptureEnabled: (enabled) => { activation.push(enabled); },
		beginRecording: async () => { throw new Error('unexpected capture'); },
		performLegacyFinalization: async () => {}, performRoutedFinalization: async () => {},
	});
	assert.equal(service.startSoundActivatedRecording(), undefined);
	assert.deepEqual(activation, []);
});
