/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createLegacyRecordingCaptureService } from '../src/common/editor/controller/legacy-recording-capture-service.ts';
import { createRoutedRecordingCaptureService } from '../src/common/editor/controller/routed-recording-capture-service.ts';
import { createSoundActivatedRecordingCaptureSession } from '../src/common/editor/controller/sound-activated-recording-capture-session.ts';
import {
	createRecordingCaptureFixture,
	createScope,
} from './fixtures/recording-capture-fixture.ts';

const SETTINGS = Object.freeze({
	thresholdDb: -20,
	hysteresisDb: 6,
	holdFrames: 0,
});

function writtenSamples(
	record: Readonly<{ writes: readonly (readonly Float32Array[])[] }>,
): number[][][] {
	return record.writes.map((channels) => channels.map((channel) => [...channel]));
}

test('legacy capture gates absolute worklet chunks without changing scheduling or metering', async () => {
	const fixture = createRecordingCaptureFixture({
		soundActivationSettings: SETTINGS,
	});
	await createLegacyRecordingCaptureService(fixture.runtime).capture(
		{ trackId: 'track-1' },
		createScope(() => true),
	);

	assert.deepEqual(fixture.recorderStartOptions, [{ startFrame: 195_840, stopFrame: undefined }]);
	const recorder = fixture.recorderOptionsList[0];
	assert.ok(recorder);
	await recorder.onChunk({
		frameStart: 195_842,
		frames: 4,
		channels: [Float32Array.from([0, 0.5, 0, 0.25])],
	});
	assert.deepEqual(writtenSamples(fixture.writerRecords[0]!), [
		[[0.5]],
		[[0.25]],
	]);
	assert.deepEqual(fixture.previewSegments.map(({ channels }) => channels.map((channel) => [...channel])), [
		[[0.5]],
		[[0.25]],
	]);
	assert.ok(fixture.state.inputMeterDb > -7 && fixture.state.inputMeterDb < -5);
	assert.deepEqual(fixture.soundActivationStates.map(({ source, state }) => [source.sourceKey, state]), [
		['device:default', 'armed'],
		['device:default', 'capturing'],
		['device:default', 'armed'],
		['device:default', 'capturing'],
	]);

	assert.equal(fixture.state.recorder?.pause?.(), true);
	await recorder.onChunk({
		frameStart: 195_846,
		frames: 1,
		channels: [Float32Array.of(1)],
	});
	assert.equal(fixture.state.inputMeterDb, 0);
	assert.equal(fixture.writerRecords[0]?.writer.framesWritten, 2);
	assert.equal(fixture.state.recorder?.resume?.(), true);
	await recorder.onChunk({
		frameStart: 195_847,
		frames: 2,
		channels: [Float32Array.from([0, 0.5])],
	});
	assert.equal(fixture.writerRecords[0]?.writer.framesWritten, 3);
	await fixture.state.recorder?.stop();
	assert.deepEqual(fixture.soundActivationStates.map(({ state }) => state), [
		'armed',
		'capturing',
		'armed',
		'capturing',
		'paused',
		'armed',
		'capturing',
		'cancelled',
	]);
});

test('exact legacy and routed punch paths explicitly bypass compacting sound activation', async () => {
	const legacy = createRecordingCaptureFixture({
		selection: { startFrame: 20, endFrame: 80 },
		soundActivationSettings: SETTINGS,
	});
	await createLegacyRecordingCaptureService(legacy.runtime).capture(
		{ trackId: 'track-1' },
		createScope(() => true),
	);
	await legacy.recorderOptionsList[0]!.onChunk({
		frameStart: 195_840,
		frames: 4,
		channels: [Float32Array.from([0, 0.5, 0, 0.25])],
	});
	assert.deepEqual(legacy.recorderStartOptions, [{ startFrame: 195_840, stopFrame: 195_900 }]);
	assert.deepEqual(writtenSamples(legacy.writerRecords[0]!), [[[0, 0.5, 0, 0.25]]]);
	assert.deepEqual(legacy.soundActivationStates, []);

	const routed = createRecordingCaptureFixture({
		selection: { startFrame: 20, endFrame: 80 },
		soundActivationSettings: SETTINGS,
	});
	routed.state.recordingRouting = {
		routes: {
			'track-1': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 },
		},
		offsets: {},
	};
	await createRoutedRecordingCaptureService(routed.runtime).capture(
		{ trackId: 'track-1' },
		createScope(() => true),
	);
	await routed.recorderOptionsList[0]!.onChunk({
		frameStart: 195_840,
		frames: 4,
		channels: [Float32Array.from([0, 0.5, 0, 0.25])],
	});
	assert.deepEqual(routed.recorderStartOptions, [{ startFrame: 195_840, stopFrame: 195_900 }]);
	assert.deepEqual(writtenSamples(routed.writerRecords[0]!), [[[0, 0.5, 0, 0.25]]]);
	assert.deepEqual(routed.soundActivationStates, []);
});

test('routed capture applies one input-wide decision before fan-out while every route meters raw input', async () => {
	const fixture = createRecordingCaptureFixture({ soundActivationSettings: SETTINGS });
	fixture.state.recordingRouting = {
		routes: {
			'track-1': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 },
			'track-2': { kind: 'device', deviceId: 'mic', channelStart: 1, channelCount: 1 },
		},
		offsets: {},
	};
	await createRoutedRecordingCaptureService(fixture.runtime).capture({}, createScope(() => true));

	assert.equal(fixture.recorderOptionsList.length, 1);
	const recorder = fixture.recorderOptionsList[0];
	assert.ok(recorder);
	await recorder.onChunk({
		frameStart: 195_840,
		frames: 3,
		channels: [
			Float32Array.from([0, 0, 0]),
			Float32Array.from([0, 0.5, 0]),
		],
	});

	assert.deepEqual(writtenSamples(fixture.writerRecords[0]!), [[[0]]]);
	assert.deepEqual(writtenSamples(fixture.writerRecords[1]!), [[[0.5]]]);
	assert.equal(fixture.state.inputMeters['track-1'], -60);
	assert.ok((fixture.state.inputMeters['track-2'] || -60) > -7);
	assert.deepEqual(fixture.previewSegments.map(({ trackId, channels }) => ({
		trackId,
		channels: channels.map((channel) => [...channel]),
	})), [
		{ trackId: 'track-1', channels: [[0]] },
		{ trackId: 'track-2', channels: [[0.5]] },
	]);
	assert.deepEqual(fixture.soundActivationStates.map(({ source, state }) => [source.sourceKey, state]), [
		['device:mic', 'armed'],
		['device:mic', 'capturing'],
		['device:mic', 'armed'],
	]);
});

test('routed input sessions gate independently and controller disposal cancels every source', async () => {
	const fixture = createRecordingCaptureFixture({ soundActivationSettings: SETTINGS });
	fixture.state.recordingRouting = {
		routes: {
			'track-1': { kind: 'display', deviceId: '', channelStart: 0, channelCount: 1 },
			'track-2': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 },
		},
		offsets: {},
	};
	await createRoutedRecordingCaptureService(fixture.runtime).capture({}, createScope(() => true));

	assert.equal(fixture.recorderOptionsList.length, 2);
	await fixture.recorderOptionsList[0]!.onChunk({
		frameStart: 195_840,
		frames: 2,
		channels: [Float32Array.from([0, 0.5])],
	});
	await fixture.recorderOptionsList[1]!.onChunk({
		frameStart: 195_840,
		frames: 2,
		channels: [Float32Array.from([0, 0])],
	});
	assert.equal(fixture.writerRecords[0]?.writer.framesWritten, 1);
	assert.equal(fixture.writerRecords[1]?.writer.framesWritten, 0);

	await fixture.state.recorder?.dispose?.();
	assert.deepEqual(fixture.soundActivationStates.map(({ source, state }) => [source.sourceKey, state]), [
		['display', 'armed'],
		['device:mic', 'armed'],
		['display', 'capturing'],
		['display', 'cancelled'],
		['device:mic', 'cancelled'],
	]);
});

test('sound-activated callbacks retain the capture ownership fence', async () => {
	const fixture = createRecordingCaptureFixture({ soundActivationSettings: SETTINGS });
	let current = true;
	await createLegacyRecordingCaptureService(fixture.runtime).capture(
		{ trackId: 'track-1' },
		createScope(() => current),
	);
	const recorder = fixture.recorderOptionsList[0];
	assert.ok(recorder);
	current = false;
	await recorder.onChunk({
		frameStart: 195_840,
		frames: 1,
		channels: [Float32Array.of(1)],
	});
	assert.equal(fixture.writerRecords[0]?.writer.framesWritten, 0);
	assert.equal(fixture.state.inputMeterDb, -60);
	assert.deepEqual(fixture.soundActivationStates.map(({ state }) => state), ['armed']);
});

test('controller lifecycle rejection and failure never partially transition the gate', async () => {
	const states: string[] = [];
	const session = createSoundActivatedRecordingCaptureSession({
		getSettings: () => SETTINGS,
		setState: (_source, state) => { states.push(state); },
	}, {
		sourceKey: 'device:mic',
		kind: 'device',
		sampleRate: 48_000,
		channelCount: 1,
	}, () => true);
	let controllerState = 'ready';
	let pauseOutcome: 'accept' | 'reject' | 'throw' = 'reject';
	let resumeOutcome: 'accept' | 'reject' | 'throw' = 'reject';
	let startThrows = false;
	let pauseCalls = 0;
	let resumeCalls = 0;
	const controller = session.wrapController({
		get state() { return controllerState; },
		start() {
			if (startThrows) throw new Error('start rejected');
			controllerState = 'recording';
		},
		pause() {
			pauseCalls += 1;
			if (pauseOutcome === 'throw') throw new Error('pause rejected');
			if (pauseOutcome === 'reject') return false;
			controllerState = 'paused';
			return true;
		},
		resume() {
			resumeCalls += 1;
			if (resumeOutcome === 'throw') throw new Error('resume rejected');
			if (resumeOutcome === 'reject') return false;
			controllerState = 'recording';
			return true;
		},
		async stop() { controllerState = 'stopped'; },
		async dispose() { controllerState = 'disposed'; },
		setMonitoring() {},
		setInputGain() {},
	});

	assert.equal(session.state, 'disarmed');
	assert.equal(controller.pause(), false);
	assert.equal(controller.resume(), false);
	assert.equal(pauseCalls, 0);
	assert.equal(resumeCalls, 0);
	controller.start();
	assert.equal(session.state, 'armed');
	assert.equal(controller.pause(), false);
	assert.equal(session.state, 'armed');
	session.process({ frameStart: 10, frames: 1, channels: [Float32Array.of(1)] });
	assert.equal(session.state, 'capturing');
	pauseOutcome = 'throw';
	assert.throws(() => controller.pause(), /pause rejected/);
	assert.equal(session.state, 'capturing');
	pauseOutcome = 'accept';
	assert.equal(controller.pause(), true);
	assert.equal(session.state, 'paused');
	assert.equal(controller.pause(), false);

	assert.equal(controller.resume(), false);
	assert.equal(session.state, 'paused');
	resumeOutcome = 'throw';
	assert.throws(() => controller.resume(), /resume rejected/);
	assert.equal(session.state, 'paused');
	resumeOutcome = 'accept';
	assert.equal(controller.resume(), true);
	assert.equal(session.state, 'armed');
	assert.equal(controller.resume(), false);

	await controller.stop();
	assert.equal(session.state, 'cancelled');
	const callsAfterStop = [pauseCalls, resumeCalls];
	assert.equal(controller.pause(), false);
	assert.equal(controller.resume(), false);
	assert.deepEqual([pauseCalls, resumeCalls], callsAfterStop);
	startThrows = true;
	assert.throws(() => controller.start(), /start rejected/);
	assert.equal(session.state, 'cancelled');
	assert.equal(states.at(-1), 'cancelled');
});
