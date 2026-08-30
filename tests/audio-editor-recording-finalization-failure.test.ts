/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createRecordingSessionService,
	type RecordingControllerLike,
	type RecordingSessionMutableState,
} from '../src/common/editor/controller/recording-session-service.ts';

test('stop rejects a finalization failure after resetting recording ownership', async () => {
	const failure = new Error('recording commit failed');
	const state = recordingState({
		recorder: recorder(),
		recordingSourceId: 'source-1',
		recordingWriter: { framesWritten: 24 },
	});
	let cleanupCalls = 0;
	state.recordingCleanup = () => { cleanupCalls += 1; };
	const service = createRecordingSessionService({
		state,
		getProjectId: () => 'project-1',
		beginRecording: async () => {},
		performLegacyFinalization: async () => { throw failure; },
		performRoutedFinalization: async () => {},
	});

	await assert.rejects(service.stopRecording(), failure);
	assert.equal(cleanupCalls, 1);
	assert.equal(state.recorder, null);
	assert.equal(state.recordingWriter, null);
	assert.equal(state.recordingSourceId, null);
	assert.equal(state.recordingFinishing, false);
	assert.equal(state.recordingFinalizePromise, null);
});

test('stop retains both recorder and finalization failures', async () => {
	const stopFailure = new Error('capture stop failed');
	const finalizationFailure = new Error('recording commit failed');
	const state = recordingState({ recorder: recorder(stopFailure) });
	const service = createRecordingSessionService({
		state,
		getProjectId: () => 'project-1',
		beginRecording: async () => {},
		performLegacyFinalization: async () => { throw finalizationFailure; },
		performRoutedFinalization: async () => {},
	});

	await assert.rejects(service.stopRecording(), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.deepEqual(error.errors, [stopFailure, finalizationFailure]);
		assert.strictEqual(error.cause, stopFailure);
		return true;
	});
	assert.equal(state.recorder, null);
});

function recorder(stopFailure?: Error): RecordingControllerLike {
	return {
		async stop() {
			if (stopFailure) throw stopFailure;
		},
	};
}

function recordingState(
	overrides: Partial<RecordingSessionMutableState> = {},
): RecordingSessionMutableState {
	return {
		readOnly: false,
		disposed: false,
		projectBinPreview: null,
		recorder: null,
		recordingKind: null,
		recordingStarting: false,
		recordingStartGeneration: 0,
		recordingStartPromise: null,
		timedRecordingPreparing: false,
		timedRecording: null,
		recordingPaused: false,
		leadInRecording: false,
		recordingEntries: null,
		recordingWriter: null,
		recordingStream: null,
		recordingSourceId: null,
		recordingTrackId: null,
		recordingStartFrame: 0,
		recordingSelection: null,
		recordingResampler: null,
		recordingSampleRate: null,
		recordingSourceOffsetFrames: 0,
		recordingPreview: null,
		recordingPreviews: [],
		recordingPreviewLastPublishedAt: 0,
		recordingCleanup: null,
		recordingFinishing: false,
		recordingFinalizePromise: null,
		recordingFatalError: null,
		recordingDiscardRequested: false,
		recordingReleaseAfterStop: false,
		inputMeterDb: -60,
		inputMeters: {},
		...overrides,
	};
}
