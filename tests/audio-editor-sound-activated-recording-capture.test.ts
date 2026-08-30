/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createLegacyRecordingCaptureService } from '../src/common/editor/controller/legacy-recording-capture-service.ts';
import { createRoutedRecordingCaptureService } from '../src/common/editor/controller/routed-recording-capture-service.ts';
import {
	type RecordingCaptureControllerLike,
} from '../src/common/editor/controller/recording-session-service.ts';
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
		streamChannelCount: 1,
	});
	await createLegacyRecordingCaptureService(fixture.runtime).capture(
		{ trackId: 'track-1' },
		createScope(() => true),
	);

	assert.deepEqual(fixture.recorderStartOptions, [{ startFrame: 195_840, stopFrame: undefined }]);
	const recorder = fixture.recorderOptionsList[0];
	assert.ok(recorder);
	await recorder.onChunk({
		frameStart: 195_840,
		frames: 4,
		channels: [Float32Array.from([0, 0.5, 0, 0.25])],
	});
	assert.deepEqual(writtenSamples(fixture.writerRecords[0]!), [
		[[0.5, 0.25]],
	]);
	assert.deepEqual(fixture.previewSegments.map(({ channels }) => channels.map((channel) => [...channel])), [
		[[0.5, 0.25]],
	]);
	assert.ok(fixture.state.inputMeterDb > -7 && fixture.state.inputMeterDb < -5);
	assert.deepEqual(fixture.soundActivationStates.map(({ source, state }) => [source.sourceKey, state]), [
		['device:default', 'armed'],
		['device:default', 'capturing'],
	]);

	assert.equal(fixture.state.recorder?.pause?.(), true);
	await recorder.onChunk({
		frameStart: 195_844,
		frames: 1,
		channels: [Float32Array.of(1)],
	});
	assert.equal(fixture.state.inputMeterDb, 0);
	assert.equal(fixture.writerRecords[0]?.writer.framesWritten, 2);
	assert.equal(fixture.state.recorder?.resume?.(), true);
	await recorder.onChunk({
		frameStart: 195_845,
		frames: 2,
		channels: [Float32Array.from([0, 0.5])],
	});
	assert.equal(fixture.writerRecords[0]?.writer.framesWritten, 3);
	await fixture.state.recorder?.stop();
	assert.deepEqual(fixture.soundActivationStates.map(({ state }) => state), [
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
	]);
});

test('routed input sessions gate independently and controller disposal cancels every source', async () => {
	const fixture = createRecordingCaptureFixture({
		soundActivationSettings: SETTINGS,
		streamChannelCount: 1,
	});
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

test('legacy and routed gating trim raw latency before compaction and retain zero persisted offsets', async (context) => {
	for (const mode of ['legacy', 'routed'] as const) {
		for (const scenario of ['silent-before-cutoff', 'crossing-cutoff'] as const) {
			await context.test(`${mode} ${scenario}`, async () => {
				const fixture = createRecordingCaptureFixture({
					soundActivationSettings: SETTINGS,
					streamChannelCount: 1,
				});
				// Position 100 minus 104 frames of latency leaves four raw input
				// frames before the project-zero cutoff.
				fixture.state.latencyOffsetMs = 104 / 48;
				if (mode === 'routed') {
					fixture.state.recordingRouting = {
						routes: {
							'track-1': {
								kind: 'device',
								deviceId: 'mic',
								channelStart: 0,
								channelCount: 1,
							},
						},
						offsets: {},
					};
					await createRoutedRecordingCaptureService(fixture.runtime).capture(
						{ trackId: 'track-1' },
						createScope(() => true),
					);
				} else {
					await createLegacyRecordingCaptureService(fixture.runtime).capture(
						{ trackId: 'track-1' },
						createScope(() => true),
					);
				}

				const recorder = fixture.recorderOptionsList[0];
				assert.ok(recorder);
				const samples = scenario === 'silent-before-cutoff'
					? Float32Array.of(0, 0, 0, 0)
					: Float32Array.of(1, 1, 1, 1, 0.5, 0);
				await recorder.onChunk({
					frameStart: 195_840,
					frames: samples.length,
					channels: [samples],
				});
				assert.deepEqual(writtenSamples(fixture.writerRecords[0]!),
					scenario === 'silent-before-cutoff' ? [] : [[[0.5]]]);
				assert.equal(fixture.state.recordingStartFrame, 0);
				if (mode === 'legacy') {
					assert.equal(fixture.state.recordingSourceOffsetFrames, 0);
					assert.equal(fixture.state.recordingPreview?.framesToSkip, 0);
				} else {
					const entry = fixture.state.recordingEntries?.[0];
					assert.equal(entry?.sourceOffsetFrames, 0);
					assert.equal(entry?.sourceOffsetProjectFrames, 0);
					assert.equal(entry?.preview.framesToSkip, 0);
				}

				recorder.onState('stopped');
				assert.equal(fixture.finalizeCalls(), 1);
			});
		}
	}
});

test('one adversarial threshold-chatter chunk has bounded persistence and observation work', async (context) => {
	for (const mode of ['legacy', 'routed'] as const) {
		await context.test(mode, async () => {
			const fixture = createRecordingCaptureFixture({
				soundActivationSettings: SETTINGS,
				streamChannelCount: 1,
			});
			if (mode === 'routed') {
				fixture.state.recordingRouting = {
					routes: {
						'track-1': {
							kind: 'device',
							deviceId: 'mic',
							channelStart: 0,
							channelCount: 1,
						},
					},
					offsets: {},
				};
				await createRoutedRecordingCaptureService(fixture.runtime).capture(
					{ trackId: 'track-1' },
					createScope(() => true),
				);
			} else {
				await createLegacyRecordingCaptureService(fixture.runtime).capture(
					{ trackId: 'track-1' },
					createScope(() => true),
				);
			}
			const recorder = fixture.recorderOptionsList[0];
			assert.ok(recorder);
			const samples = Float32Array.from(
				{ length: 4_096 },
				(_, index) => index % 2 === 0 ? 0.5 : 0,
			);
			await recorder.onChunk({
				frameStart: 195_840,
				frames: samples.length,
				channels: [samples],
			});

			assert.equal(fixture.writerRecords[0]?.writes.length, 1);
			assert.equal(fixture.previewSegments.length, 1);
			assert.equal(fixture.previewPublishes(), 1);
			assert.equal(fixture.soundActivationStates.length, 1);
			assert.deepEqual(
				[...(fixture.writerRecords[0]?.writes[0]?.[0] || [])],
				Array.from({ length: 2_048 }, () => 0.5),
			);
		});
	}
});

test('capture admission rejects channel drift, non-finite PCM, and non-contiguous chunks before gate mutation', () => {
	const states: string[] = [];
	const session = createSoundActivatedRecordingCaptureSession({
		getSettings: () => ({ ...SETTINGS, holdFrames: 2 }),
		setState: (_source, state) => { states.push(state); },
	}, {
		sourceKey: 'device:mic',
		kind: 'device',
		sampleRate: 48_000,
		channelCount: 2,
	}, () => true);
	const controller = session.wrapController(createStatefulCaptureController().controller);
	controller.start({ startFrame: 100 });

	assert.throws(() => session.process({
		frameStart: 100,
		frames: 1,
		channels: [Float32Array.of(1)],
	}), /channel count/iu);
	assert.throws(() => session.process({
		frameStart: 100,
		frames: 1,
		channels: [Float32Array.of(Number.NaN), Float32Array.of(0)],
	}), /finite/iu);
	assert.equal(session.state, 'armed');
	assert.deepEqual(states, ['armed']);

	session.process({
		frameStart: 100,
		frames: 1,
		channels: [Float32Array.of(1), Float32Array.of(0)],
	});
	assert.equal(session.state, 'capturing');
	for (const frameStart of [100, 99, 102]) {
		assert.throws(() => session.process({
			frameStart,
			frames: 1,
			channels: [Float32Array.of(0), Float32Array.of(0)],
		}), /contiguous/iu);
		assert.equal(session.state, 'capturing');
	}
	// Rejected gaps do not consume hold time. Only the two following
	// contiguous quiet frames remain admitted.
	assert.equal(session.process({
		frameStart: 101,
		frames: 1,
		channels: [Float32Array.of(0), Float32Array.of(0)],
	}).length, 1);
	assert.equal(session.process({
		frameStart: 102,
		frames: 1,
		channels: [Float32Array.of(0), Float32Array.of(0)],
	}).length, 1);
	assert.equal(session.process({
		frameStart: 103,
		frames: 1,
		channels: [Float32Array.of(0), Float32Array.of(0)],
	}).length, 0);
	assert.equal(session.state, 'armed');
});

test('a late first worklet chunk establishes the contiguous sound-activation epoch', () => {
	const session = createSoundActivatedRecordingCaptureSession({
		getSettings: () => SETTINGS,
		setState: () => undefined,
	}, {
		sourceKey: 'device:mic',
		kind: 'device',
		sampleRate: 48_000,
		channelCount: 1,
	}, () => true);
	const controller = session.wrapController(createStatefulCaptureController().controller);
	controller.start({ startFrame: 100 });

	assert.doesNotThrow(() => session.process({
		frameStart: 104,
		frames: 1,
		channels: [Float32Array.of(0.5)],
	}));
	assert.doesNotThrow(() => session.process({
		frameStart: 105,
		frames: 1,
		channels: [Float32Array.of(0)],
	}));
	assert.throws(() => session.process({
		frameStart: 107,
		frames: 1,
		channels: [Float32Array.of(0)],
	}), /contiguous/iu);
});

test('non-finite recorder PCM is rejected before meters, persistence, preview, or sequence advance', async () => {
	const fixture = createRecordingCaptureFixture({
		soundActivationSettings: SETTINGS,
		streamChannelCount: 1,
	});
	await createLegacyRecordingCaptureService(fixture.runtime).capture(
		{ trackId: 'track-1' },
		createScope(() => true),
	);
	const recorder = fixture.recorderOptionsList[0];
	assert.ok(recorder);
	await assert.rejects(recorder.onChunk({
		frameStart: 195_840,
		frames: 2,
		channels: [Float32Array.of(Number.NaN, 1)],
	}), /finite/iu);
	assert.equal(fixture.state.inputMeterDb, -60);
	assert.equal(fixture.writerRecords[0]?.writer.framesWritten, 0);
	assert.equal(fixture.previewSegments.length, 0);
	assert.deepEqual(fixture.soundActivationStates.map(({ state }) => state), ['armed']);

	await recorder.onChunk({
		frameStart: 195_840,
		frames: 1,
		channels: [Float32Array.of(0.5)],
	});
	assert.equal(fixture.writerRecords[0]?.writer.framesWritten, 1);
});

test('the absolute pre-zero cutoff is applied before gate state and resumes establish a new continuity epoch', () => {
	const states: string[] = [];
	const source = createStatefulCaptureController();
	const session = createSoundActivatedRecordingCaptureSession({
		getSettings: () => SETTINGS,
		setState: (_input, state) => { states.push(state); },
	}, {
		sourceKey: 'device:mic',
		kind: 'device',
		sampleRate: 48_000,
		channelCount: 1,
	}, () => true, undefined, { sourceOffsetFrames: 2 });
	const controller = session.wrapController(source.controller);
	controller.start({ startFrame: 100 });
	const segments = session.process({
		frameStart: 100,
		frames: 4,
		channels: [Float32Array.of(1, 1, 0.5, 0)],
	});
	assert.deepEqual(segments.map(({ frameStart, channels }) => ({
		frameStart,
		channels: channels.map((channel) => [...channel]),
	})), [{ frameStart: 102, channels: [[0.5]] }]);
	assert.equal(session.state, 'armed');
	assert.deepEqual(states, ['armed']);

	assert.equal(controller.pause(), true);
	assert.equal(controller.resume(), true);
	assert.doesNotThrow(() => session.process({
		frameStart: 110,
		frames: 1,
		channels: [Float32Array.of(0.5)],
	}));
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
	controller.start({ startFrame: 10 });
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

function createStatefulCaptureController() {
	let state = 'ready';
	const controller: RecordingCaptureControllerLike = {
		get state() { return state; },
		start() { state = 'recording'; },
		pause() {
			if (state !== 'recording') return false;
			state = 'paused';
			return true;
		},
		resume() {
			if (state !== 'paused') return false;
			state = 'recording';
			return true;
		},
		async stop() { state = 'stopped'; },
		setMonitoring() {},
		setInputGain() {},
	};
	return { controller, state: () => state };
}
