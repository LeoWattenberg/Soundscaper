/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createRoutedRecordingCaptureService } from '../src/common/editor/controller/recording/internal/routed-recording-capture-service.ts';
import { createRoutedRecordingFinalization } from '../src/common/editor/controller/recording/internal/routed-recording-finalization.ts';
import { createRecordingSessionService } from '../src/common/editor/controller/recording/internal/recording-session-service.ts';
import type { RecordingMediaStream } from '../src/common/editor/controller/recording/recording-transaction-types.ts';
import {
	createEndingRecordingStream,
	createRecordingCaptureFixture,
} from './fixtures/recording-capture-fixture.ts';

test('routed capture preserves a surviving input and finalizes once after both live inputs end', async () => {
	const [firstDisplay, firstDevice] = [createEndingRecordingStream(), createEndingRecordingStream()];
	const [secondDisplay, secondDevice] = [createEndingRecordingStream(), createEndingRecordingStream()];
	const displayStreams = [firstDisplay.stream, secondDisplay.stream];
	const deviceStreams = [firstDevice.stream, secondDevice.stream];
	const fixture = createRecordingCaptureFixture({
		acquireDisplay: async () => displayStreams.shift() || assert.fail('missing display stream'),
		acquireHardware: async () => deviceStreams.shift() || assert.fail('missing device stream'),
		reportStoppedOnStop: true,
	});
	fixture.state.recordingRouting = {
		routes: {
			'track-1': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 },
			'track-2': { kind: 'display', channelStart: 0, channelCount: 1 },
		},
		offsets: {},
	};
	const durableAudio = new Map<string, number[][][]>();
	const committedBatches: unknown[][] = [];
	let clipId = 0;
	let finalizations = 0;
	const finalization = createRoutedRecordingFinalization({
		sourceChunkFrames: fixture.runtime.sourceChunkFrames,
		captureProjectScope: () => ({
			project: fixture.project,
			projectId: fixture.project.id,
			assertCurrent() {},
		}),
		projectSampleRate: () => 48_000,
		pauseTransport() {},
		setTransportPosition() {},
		disposeRecorder: async (recorder) => { await recorder.dispose?.({ stopTracks: false }); },
		appendPreview: (preview, channels) => {
			if (preview && channels) fixture.runtime.appendPreview(preview, channels);
		},
		scaleFrames: (frames) => frames,
		createStableId: () => `clip-${++clipId}`,
		createAddSourceCommand: (source) => ({ type: 'add-source', source }),
		preparePunchCommand: (_project, punch) => ({ type: 'punch', punch }),
		preparePunchSequence: (_project, segments) => segments,
		activateStoredSource: async (source) => {
			const record = fixture.writerRecords.find(({ sourceId }) => sourceId === source.id);
			assert.ok(record);
			durableAudio.set(source.id, record.writes.map((channels) => (
				channels.map((channel) => [...channel])
			)));
		},
		commitBatch: (_project, commands) => { committedBatches.push([...commands]); },
		setStatusDone() {},
		deactivateSource: (sourceId) => { durableAudio.delete(sourceId); },
		deleteStoredSource: async (sourceId) => durableAudio.delete(sourceId),
		setRouteHealth: (trackId, health) => { fixture.state.recordingRouteHealth[trackId] = health; },
		deleteSourceAnalysis: async () => {},
	});
	const capture = createRoutedRecordingCaptureService({
		...fixture.runtime,
		stopRecording: () => session.stopRecording(),
		finalizeRecording: () => session.finalizeRecording(),
	});
	const session = createRecordingSessionService({
		state: fixture.state,
		getProjectId: () => fixture.project.id,
		beginRecording: (options, scope) => capture.capture(options, scope),
		performLegacyFinalization: async () => assert.fail('routed capture used the legacy finalizer'),
		performRoutedFinalization: async (input) => {
			finalizations += 1;
			await finalization.finalize(input);
		},
		releaseUnretainedRecordingInputs: fixture.runtime.releaseUnretainedRecordingInputs,
		retainInputs: () => false,
	});
	const optionsFor = (stream: RecordingMediaStream) => {
		const options = fixture.recorderOptionsList.find((candidate) => candidate.stream === stream);
		assert.ok(options);
		return options;
	};
	const firstStart = session.startRecording();
	assert.ok(firstStart);
	await firstStart;
	const displayRecorder = optionsFor(firstDisplay.stream);
	const deviceRecorder = optionsFor(firstDevice.stream);
	await displayRecorder.onChunk({ frameStart: 0, frames: 1, channels: [Float32Array.of(0.125)] });
	await deviceRecorder.onChunk({ frameStart: 0, frames: 1, channels: [Float32Array.of(0.25)] });
	const firstEntries = fixture.state.recordingEntries;
	assert.ok(firstEntries);
	const deviceSourceId = firstEntries.find(({ trackId }) => trackId === 'track-1')?.sourceId;
	assert.ok(deviceSourceId);

	firstDisplay.end();
	await Promise.resolve();
	assert.equal(finalizations, 0);
	assert.ok(fixture.state.recorder);
	await deviceRecorder.onChunk({
		frameStart: 1,
		frames: 2,
		channels: [Float32Array.of(0.5, -0.75)],
	});
	firstDevice.end();
	const finishing = fixture.state.recordingFinalizePromise;
	assert.ok(finishing);
	await finishing;

	assert.equal(finalizations, 1);
	assert.equal(committedBatches.length, 1);
	assert.deepEqual(durableAudio.get(deviceSourceId), [[[0.25]], [[0.5, -0.75]]]);
	const firstRecords = fixture.writerRecords.filter(({ sourceId }) => (
		firstEntries.some((entry) => entry.sourceId === sourceId)
	));
	assert.deepEqual(firstRecords.map((record) => [record.commits(), record.aborts()]), [[1, 0], [1, 0]]);
	assert.equal(fixture.state.recorder, null);
	assert.equal(fixture.state.recordingEntries, null);
	assert.equal(fixture.state.recordingFinalizePromise, null);

	const secondStart = session.startRecording();
	assert.ok(secondStart);
	await secondStart;
	await optionsFor(secondDisplay.stream).onChunk({ frameStart: 0, frames: 1, channels: [Float32Array.of(0.375)] });
	await optionsFor(secondDevice.stream).onChunk({ frameStart: 0, frames: 1, channels: [Float32Array.of(0.625)] });
	await session.stopRecording();
	assert.equal(finalizations, 2);
	assert.equal(committedBatches.length, 2);
	assert.equal(fixture.state.recorder, null);
	assert.ok(fixture.writerRecords.every((record) => record.commits() + record.aborts() === 1));
});
