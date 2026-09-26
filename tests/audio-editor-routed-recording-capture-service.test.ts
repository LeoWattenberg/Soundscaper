/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createRoutedRecordingCaptureService,
} from '../src/common/editor/controller/recording/internal/routed-recording-capture-service.ts';
import { createRoutedRecordingFinalization } from '../src/common/editor/controller/recording/internal/routed-recording-finalization.ts';
import { planRoutedRecordingSources } from '../src/common/editor/controller/recording/internal/routed-recording-source-plan.ts';
import { createRecordingSessionService } from '../src/common/editor/controller/recording/internal/recording-session-service.ts';
import type { RecordingMediaStream } from '../src/common/editor/controller/recording/recording-transaction-types.ts';
import {
	createEndingRecordingStream,
	createRecordingCaptureFixture,
	createScope,
	deferred,
} from './fixtures/recording-capture-fixture.ts';

test('routed source planning is pure, stable, and requests display permission first', () => {
	const tracks = [
		{ id: 'hardware', type: 'audio', armed: true },
		{ id: 'display', type: 'audio', armed: true },
		{ id: 'unassigned', type: 'audio', armed: true },
	];
	const plan = planRoutedRecordingSources(tracks, {
		hardware: { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 },
		display: { kind: 'display', channelStart: 0, channelCount: 2 },
	}, (route) => route.kind === 'display' ? 'display' : `device:${route.deviceId}`);

	assert.deepEqual(plan.groups.map(({ sourceKey }) => sourceKey), ['display', 'device:mic']);
	assert.deepEqual(plan.skippedTrackIds, ['unassigned']);
	assert.equal(Object.isFrozen(plan), true);
	assert.equal(Object.isFrozen(plan.groups), true);
});

test('routed capture checks ownership after the permission batch and leaves no stale recorder', async () => {
	const display = deferred<RecordingMediaStream>();
	const hardware = deferred<RecordingMediaStream>();
	const fixture = createRecordingCaptureFixture({
		acquireDisplay: () => display.promise,
		acquireHardware: () => hardware.promise,
	});
	fixture.state.recordingRouting = {
		routes: {
			'track-1': { kind: 'display', channelStart: 0, channelCount: 2 },
			'track-2': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 },
		},
		offsets: {},
	};
	let current = true;
	const operation = createRoutedRecordingCaptureService(fixture.runtime).capture(
		{},
		createScope(() => current),
	);
	assert.equal(fixture.displayRequests(), 1);
	assert.equal(fixture.hardwareRequests(), 1);
	current = false;
	display.resolve(fixture.stream);
	hardware.resolve(fixture.stream);
	await operation;

	assert.equal(fixture.recorderCreations(), 0);
	assert.equal(fixture.publishes(), 1);
	assert.equal(fixture.releases(), 1);
	assert.equal(fixture.state.recorder, null);
});

test('routed capture initializes assigned entries and hands one recorder to the session service', async () => {
	const fixture = createRecordingCaptureFixture();
	fixture.state.recordingRouting = {
		routes: {
			'track-1': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 },
		},
		offsets: { 'device:mic': 12 },
	};
	await createRoutedRecordingCaptureService(fixture.runtime).capture(
		{ trackId: 'track-1' },
		createScope(() => true),
	);

	assert.equal(fixture.hardwareRequests(), 1);
	assert.equal(fixture.recorderCreations(), 1);
	assert.equal(fixture.state.recordingStarting, false);
	assert.equal(fixture.state.recordingEntries?.length, 1);
	assert.equal(fixture.state.recordingEntries?.[0]?.trackId, 'track-1');
	assert.ok(fixture.state.recorder);
	assert.equal(fixture.state.recordingRouteHealth['track-1'], 'recording');
	assert.equal(fixture.publishes(), 2);
	const recorderOptions = fixture.recorderOptions();
	assert.ok(recorderOptions);
	await recorderOptions.onChunk({
		frameStart: 0,
		frames: 2,
		channels: [Float32Array.from([0.25, -0.5])],
	});
	assert.ok((fixture.state.inputMeters['track-1'] || -60) > -7);
	assert.equal(fixture.previewPublishes(), 1);
	recorderOptions.onState('stopped');
	assert.equal(fixture.finalizeCalls(), 1);
});

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

test('routed capture drops a failed source controller and preserves its failure', async () => {
	const controllerFailure = new Error('worklet failed');
	const fixture = createRecordingCaptureFixture({
		createRecorder: async () => { throw controllerFailure; },
	});
	fixture.state.recordingRouting = {
		routes: {
			'track-1': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 },
		},
		offsets: {},
	};
	await assert.rejects(
		createRoutedRecordingCaptureService(fixture.runtime).capture(
			{ trackId: 'track-1' },
			createScope(() => true),
		),
		(error: unknown) => error === controllerFailure,
	);
	assert.equal(fixture.state.recordingRouteHealth['track-1'], 'unavailable');
	assert.equal(fixture.state.recordingEntries, null);
	assert.equal(fixture.state.recordingStarting, false);
});

test('routed capture preserves the display sharing failure when no inputs survive', async () => {
	const failure = new DOMException('Could not start audio source', 'NotReadableError');
	const fixture = createRecordingCaptureFixture({ acquireDisplay: () => Promise.reject(failure) });
	fixture.state.recordingRouting = {
		routes: { 'track-1': { kind: 'display', channelStart: 0, channelCount: 2 } },
		offsets: {},
	};
	await assert.rejects(createRoutedRecordingCaptureService(fixture.runtime).capture(
		{ trackId: 'track-1' }, createScope(() => true),
	), (error: unknown) => error === failure);
	assert.equal(fixture.state.recordingRouteHealth['track-1'], 'unavailable');
	assert.equal(fixture.state.recordingStarting, false);
	assert.equal(fixture.state.recorder, null);
	assert.equal(fixture.recorderCreations(), 0);
});

test('a surviving display source reports its recorder failure instead of a skipped hardware failure', async () => {
	const recorderFailure = new Error('Desktop recording worklet failed');
	const fixture = createRecordingCaptureFixture({
		acquireHardware: () => Promise.reject(new Error('Microphone denied')),
		createRecorder: () => Promise.reject(recorderFailure),
	});
	fixture.state.recordingRouting = {
		routes: {
			'track-1': { kind: 'display', channelStart: 0, channelCount: 2 },
			'track-2': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 },
		},
		offsets: {},
	};
	await assert.rejects(createRoutedRecordingCaptureService(fixture.runtime).capture(
		{}, createScope(() => true),
	), (error: unknown) => error === recorderFailure);
	assert.equal(fixture.state.recordingStarting, false);
	assert.equal(fixture.state.recorder, null);
});

test('routed prepared-only capture marks unavailable routes without opening a new stream', async () => {
	const fixture = createRecordingCaptureFixture();
	fixture.state.recordingRouting = {
		routes: {
			'track-1': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 },
		},
		offsets: {},
	};
	await assert.rejects(
		createRoutedRecordingCaptureService(fixture.runtime).capture(
			{ trackId: 'track-1', reusePreparedInputsOnly: true },
			createScope(() => true),
		),
		/Prepared input closed/,
	);
	assert.equal(fixture.hardwareRequests(), 0);
	assert.equal(fixture.state.recordingRouteHealth['track-1'], 'unavailable');
});

test('routed capture rejects incompatible track and routing inventories before permission work', async () => {
	const incompatible = createRecordingCaptureFixture();
	const firstTrack = incompatible.project.tracks[0] as { type?: string };
	firstTrack.type = 'label';
	await assert.rejects(
		createRoutedRecordingCaptureService(incompatible.runtime).capture(
			{ trackId: 'track-1' },
			createScope(() => true),
		),
		/Arm a track/,
	);
	assert.equal(incompatible.hardwareRequests(), 0);

	const unarmed = createRecordingCaptureFixture();
	for (const track of unarmed.project.tracks) (track as { armed?: boolean }).armed = false;
	await assert.rejects(
		createRoutedRecordingCaptureService(unarmed.runtime).capture({}, createScope(() => true)),
		/Arm a track/,
	);

	const unassigned = createRecordingCaptureFixture();
	await assert.rejects(
		createRoutedRecordingCaptureService(unassigned.runtime).capture(
			{ trackId: 'track-1' },
			createScope(() => true),
		),
		/Assign an input/,
	);
	assert.equal(unassigned.state.recordingRouteHealth['track-1'], 'skipped');
});

test('routed display capture supports ranges, channel fallback, meters, and timed starts', async () => {
	const fixture = createRecordingCaptureFixture({ selection: { startFrame: 30, endFrame: 90 } });
	fixture.state.recordingRouting = {
		routes: {
			'track-1': { kind: 'display', channelStart: 0, channelCount: 2 },
		},
		offsets: {},
	};
	await createRoutedRecordingCaptureService(fixture.runtime).capture(
		{ trackId: 'track-1', timedStartTimeMs: 2_000 },
		createScope(() => true),
	);
	assert.equal(fixture.displayRequests(), 1);
	assert.equal(fixture.startCalls(), 1);
	assert.deepEqual(fixture.state.recordingSelection, { startFrame: 30, endFrame: 90 });
	const recorderOptions = fixture.recorderOptions();
	assert.ok(recorderOptions);
	await recorderOptions.onChunk({
		frameStart: 0,
		frames: 2,
		channels: [Float32Array.from([0.4, -0.2])],
	});
	assert.deepEqual(fixture.state.inputMeter, { dbfs: -12 });
	assert.equal(fixture.state.inputMeters['track-1']! > -9, true);
	recorderOptions.onState('recording');
	assert.equal(fixture.finalizeCalls(), 0);
	const failure = new Error('display processor failed');
	recorderOptions.onError(failure);
	assert.deepEqual(fixture.errors, [failure]);
	assert.equal(fixture.stopCalls(), 1);
});

test('routed capture preserves a delayed full-scale loudness reading', async () => {
	type LoudnessPublisher = (reading: Readonly<{ readonly dbfs?: number }>) => void;
	let publishLoudness: LoudnessPublisher | null = null;
	const fixture = createRecordingCaptureFixture({
		createLoudnessMeter: () => ({
			push: (_channels, publish) => { publishLoudness = publish; },
			snapshot: () => ({ dbfs: -60 }),
			setRunning: () => undefined,
			reset: () => undefined,
		}),
	});
	fixture.state.recordingRouting = {
		routes: {
			'track-1': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 },
		},
		offsets: {},
	};
	await createRoutedRecordingCaptureService(fixture.runtime).capture(
		{ trackId: 'track-1' },
		createScope(() => true),
	);
	const recorderOptions = fixture.recorderOptions();
	assert.ok(recorderOptions);
	await recorderOptions.onChunk({
		frameStart: 0,
		frames: 2,
		channels: [Float32Array.from([0.25, -0.25])],
	});
	const publisher = publishLoudness as LoudnessPublisher | null;
	assert.ok(publisher);
	publisher({ dbfs: 0 });
	assert.equal(fixture.state.inputMeterDb, 0);
});

test('routed count-in shares a deferred playback start with every recorder', async () => {
	const fixture = createRecordingCaptureFixture({
		selection: { startFrame: 144_000, endFrame: 192_000 },
		playAt: async () => 4.1,
	});
	fixture.state.leadInRecording = true;
	fixture.state.recordingRouting = {
		routes: {
			'track-1': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 },
		},
		offsets: {},
	};
	(fixture.project as { tempoMap: unknown }).tempoMap = {
		mode: 'musical',
		events: [
			{ id: 'tempo-1', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
			{ id: 'tempo-2', beat: { num: 2, den: 1 }, bpm: { num: 60, den: 1 } },
		],
	};
	(fixture.project as { signatureMap: unknown }).signatureMap = {
		events: [{ id: 'signature-1', bar: 0, numerator: 6, denominator: 8 }],
	};
	await createRoutedRecordingCaptureService(fixture.runtime).capture(
		{ trackId: 'track-1' },
		createScope(() => true),
	);

	assert.deepEqual(fixture.seekCalls, [24_000]);
	assert.equal(fixture.playAtCalls[0]?.[1], 24_000);
	assert.deepEqual(fixture.recorderStartOptions, [{ startFrame: 316_800, stopFrame: 364_800 }]);
});

test('routed count-in preserves singleton timing for a map-absent project', async () => {
	const fixture = createRecordingCaptureFixture({ selection: { startFrame: 144_000, endFrame: 192_000 } });
	fixture.state.leadInRecording = true;
	fixture.state.recordingRouting = {
		routes: {
			'track-1': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 },
		},
		offsets: {},
	};
	delete (fixture.project as { tempoMap?: unknown }).tempoMap;
	delete (fixture.project as { signatureMap?: unknown }).signatureMap;
	(fixture.project as { tempo: unknown }).tempo = {
		bpm: 60,
		timeSignature: { numerator: 3, denominator: 4 },
	};
	await createRoutedRecordingCaptureService(fixture.runtime).capture(
		{ trackId: 'track-1' },
		createScope(() => true),
	);

	assert.deepEqual(fixture.seekCalls, [0]);
});

test('routed capture classifies permission, channel, and live-stream failures', async () => {
	const permission = createRecordingCaptureFixture({
		acquireHardware: async () => { throw new Error('permission denied'); },
	});
	permission.state.recordingRouting = {
		routes: {
			'track-1': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 },
		},
		offsets: {},
	};
	await assert.rejects(
		createRoutedRecordingCaptureService(permission.runtime).capture(
			{ trackId: 'track-1' },
			createScope(() => true),
		),
		/permission denied/,
	);
	assert.equal(permission.state.recordingRouteHealth['track-1'], 'unavailable');

	const channels = createRecordingCaptureFixture();
	channels.state.recordingRouting = {
		routes: {
			'track-1': { kind: 'device', deviceId: 'mic', channelStart: 2, channelCount: 2 },
		},
		offsets: {},
	};
	await assert.rejects(
		createRoutedRecordingCaptureService(channels.runtime).capture(
			{ trackId: 'track-1' },
			createScope(() => true),
		),
		/No inputs/,
	);
	assert.equal(channels.state.recordingRouteHealth['track-1'], 'skipped');

	const disconnected = createRecordingCaptureFixture({ streamIsLive: () => false });
	disconnected.state.recordingRouting = {
		routes: {
			'track-1': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 },
		},
		offsets: {},
	};
	await assert.rejects(
		createRoutedRecordingCaptureService(disconnected.runtime).capture(
			{ trackId: 'track-1' },
			createScope(() => true),
		),
		/No inputs/,
	);
	assert.equal(disconnected.state.recordingRouteHealth['track-1'], 'disconnected');
});

test('routed capture rolls back timer and playback failures after recorder construction', async () => {
	const configure = (fixture: ReturnType<typeof createRecordingCaptureFixture>) => {
		fixture.state.recordingRouting = {
			routes: {
				'track-1': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 },
			},
			offsets: {},
		};
	};
	const past = createRecordingCaptureFixture();
	configure(past);
	await assert.rejects(
		createRoutedRecordingCaptureService(past.runtime).capture(
			{ trackId: 'track-1', timedStartTimeMs: 500 },
			createScope(() => true),
		),
		/Past/,
	);
	assert.equal(past.state.recorder, null);

	const failure = new Error('transport failed');
	const playback = createRecordingCaptureFixture({ playAt: async () => { throw failure; } });
	configure(playback);
	await assert.rejects(
		createRoutedRecordingCaptureService(playback.runtime).capture(
			{ trackId: 'track-1' },
			createScope(() => true),
		),
		failure,
	);
	assert.equal(playback.state.recordingCleanup, null);
	assert.equal(playback.state.recorder, null);
});
