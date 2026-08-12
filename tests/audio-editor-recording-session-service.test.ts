/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createRoutedRecordingController,
	createRecordingSessionService,
	type RecordingCaptureControllerLike,
	type RecordingControllerLike,
	type RecordingSessionMutableState,
} from '../src/common/editor/controller/recording-session-service.ts';

test('recording service exposes only controller action entry points', () => {
	const service = createRecordingSessionService({
		state: createState(),
		getProjectId: () => 'project-1',
		beginRecording: async () => {},
		performLegacyFinalization: async () => {},
		performRoutedFinalization: async () => {},
	});

	assert.deepEqual(Object.keys(service).sort(), [
		'cancelRecordingStart',
		'finalizeRecording',
		'startRecording',
		'startRecordingOnNewTrack',
		'startTakeCycleRecording',
		'stopRecording',
		'toggleLeadInRecording',
		'toggleRecordingPause',
	]);
	assert.equal(Object.isFrozen(service), true);
});

test('take cycle recording owns a distinct kind and stop finalizes only through its adapter', async () => {
	const state = createState();
	let cycleStops = 0;
	let legacyFinalizations = 0;
	let routedFinalizations = 0;
	const cycleRecorder: RecordingControllerLike = {
		state: 'recording',
		async stop() { cycleStops += 1; },
	};
	const service = createRecordingSessionService({
		state,
		getProjectId: () => 'project-1',
		beginRecording: async () => {},
		beginTakeCycleRecording: async () => cycleRecorder,
		performLegacyFinalization: async () => { legacyFinalizations += 1; },
		performRoutedFinalization: async () => { routedFinalizations += 1; },
	});

	await service.startTakeCycleRecording();
	assert.equal(state.recordingKind, 'take-cycle');
	assert.strictEqual(state.recorder, cycleRecorder);
	assert.equal(service.toggleRecordingPause(), false);
	const first = service.stopRecording();
	const second = service.stopRecording();
	await Promise.all([first, second]);
	assert.equal(cycleStops, 1);
	assert.equal(legacyFinalizations, 0);
	assert.equal(routedFinalizations, 0);
	assert.equal(state.recordingKind, null);
	assert.equal(state.recorder, null);
});

test('pending open recovery blocks ordinary, new-track, and cycle recording starts', async () => {
	const state = createState({ takeCycleRecovery: {} }); let starts = 0;
	const service = createRecordingSessionService({
		state, getProjectId: () => 'project-1',
		beginRecording: async () => { starts += 1; },
		beginTakeCycleRecording: async () => { starts += 1; return { stop() {} }; },
		addTrack: () => { starts += 1; return 'track'; },
		performLegacyFinalization: async () => {}, performRoutedFinalization: async () => {},
	});
	assert.equal(service.startRecording(), undefined); assert.equal(service.startTakeCycleRecording(), undefined);
	assert.equal(await service.startRecordingOnNewTrack(), null);
	assert.equal(starts, 0);
});

test('routed recording controller coordinates live sources and isolates device controls', async () => {
	const device = createCaptureController();
	const display = createCaptureController({ stopError: new Error('display stopped') });
	const disconnected = createCaptureController();
	const sessions = [
		{
			kind: 'device' as const,
			controller: device.controller,
			disconnected: false,
			stopped: false,
			startFrame: 12,
			stopFrame: 48,
		},
		{
			kind: 'display' as const,
			controller: display.controller,
			disconnected: false,
			stopped: false,
		},
		{
			kind: 'device' as const,
			controller: disconnected.controller,
			disconnected: true,
			stopped: false,
		},
	];
	const controller = createRoutedRecordingController(sessions);

	assert.equal(controller.state, 'ready');
	controller.start();
	assert.equal(controller.state, 'recording');
	assert.deepEqual(device.starts, [{ startFrame: 12, stopFrame: 48 }]);
	assert.deepEqual(display.starts, [{ startFrame: undefined, stopFrame: undefined }]);
	assert.deepEqual(disconnected.starts, []);
	assert.equal(sessions[2].stopped, true);

	assert.equal(controller.pause(), true);
	assert.equal(controller.pause(), false);
	assert.equal(controller.resume(), true);
	assert.equal(controller.resume(), false);
	assert.deepEqual(device.transitions, ['pause', 'resume']);
	assert.deepEqual(display.transitions, ['pause', 'resume']);
	assert.deepEqual(disconnected.transitions, []);

	controller.setMonitoring(true);
	controller.setInputGain(0.25);
	assert.deepEqual(device.monitoring, [true]);
	assert.deepEqual(device.inputGains, [0.25]);
	assert.deepEqual(display.monitoring, []);
	assert.deepEqual(display.inputGains, []);
	assert.deepEqual(disconnected.monitoring, [true]);
	assert.deepEqual(disconnected.inputGains, [0.25]);

	const firstStop = controller.stop();
	assert.strictEqual(controller.stop(), firstStop);
	await firstStop;
	assert.equal(controller.state, 'stopped');
	assert.equal(device.stopCalls, 1);
	assert.equal(display.stopCalls, 1);
	assert.equal(disconnected.stopCalls, 0);
	assert.ok(sessions.every(({ stopped }) => stopped));
	assert.strictEqual(controller.stop(), firstStop);
	assert.equal(device.stopCalls, 1);

	const firstDispose = controller.dispose();
	assert.strictEqual(controller.dispose(), firstDispose);
	await firstDispose;
	assert.equal(controller.state, 'disposed');
	assert.deepEqual(device.disposeOptions, [{ stopTracks: false }]);
	assert.deepEqual(display.disposeOptions, [{ stopTracks: false }]);
	assert.deepEqual(disconnected.disposeOptions, [{ stopTracks: false }]);
});

test('routed pause is atomic for false and thrown failures at every source index', () => {
	for (const failureKind of ['false', 'throw'] as const) {
		for (let failureIndex = 0; failureIndex < 3; failureIndex += 1) {
			const sources = Array.from({ length: 3 }, (_, index) => (
				createTransactionalCaptureController({
					pauseFailure: index === failureIndex ? failureKind : null,
				})
			));
			const controller = createRoutedRecordingController(sources.map(({ controller: source }) => ({
				kind: 'device' as const,
				controller: source,
				disconnected: false,
				stopped: false,
			})));
			controller.start();

			if (failureKind === 'throw') {
				assert.throws(() => controller.pause(), /pause failure/);
			} else assert.equal(controller.pause(), false);

			assert.equal(controller.state, 'recording');
			assert.deepEqual(sources.map(({ state }) => state()), [
				'recording',
				'recording',
				'recording',
			]);
			for (let index = 0; index < sources.length; index += 1) {
				assert.deepEqual(sources[index]?.transitions, index < failureIndex
					? ['pause', 'resume']
					: index === failureIndex ? ['pause'] : []);
			}
		}
	}
});

test('routed resume is atomic for false and thrown failures at every source index', () => {
	for (const failureKind of ['false', 'throw'] as const) {
		for (let failureIndex = 0; failureIndex < 3; failureIndex += 1) {
			const sources = Array.from({ length: 3 }, () => createTransactionalCaptureController());
			const sessions = sources.map(({ controller: source }) => ({
				kind: 'device' as const,
				controller: source,
				disconnected: false,
				stopped: false,
			}));
			const controller = createRoutedRecordingController(sessions);
			controller.start();
			assert.equal(controller.pause(), true);
			for (let index = 0; index < sources.length; index += 1) {
				sources[index]?.setResumeFailure(index === failureIndex ? failureKind : null);
				sources[index]?.transitions.splice(0);
			}

			if (failureKind === 'throw') {
				assert.throws(() => controller.resume(), /resume failure/);
			} else assert.equal(controller.resume(), false);

			assert.equal(controller.state, 'paused');
			assert.deepEqual(sources.map(({ state }) => state()), ['paused', 'paused', 'paused']);
			for (let index = 0; index < sources.length; index += 1) {
				assert.deepEqual(sources[index]?.transitions, index < failureIndex
					? ['resume', 'pause']
					: index === failureIndex ? ['resume'] : []);
			}
		}
	}
});

test('a failed routed transition rollback enters a terminal stop', async () => {
	const first = createTransactionalCaptureController({ resumeFailure: 'false' });
	const second = createTransactionalCaptureController({ pauseFailure: 'false' });
	const sessions = [first, second].map(({ controller: source }) => ({
		kind: 'device' as const,
		controller: source,
		disconnected: false,
		stopped: false,
	}));
	const controller = createRoutedRecordingController(sessions);
	controller.start();

	assert.throws(() => controller.pause(), /rollback/iu);
	assert.equal(controller.state, 'stopping');
	await controller.stop();
	assert.equal(controller.state, 'stopped');
	assert.deepEqual([first.stopCalls(), second.stopCalls()], [1, 1]);
	assert.ok(sessions.every(({ stopped }) => stopped));
});

test('recording starts are single-flight and cancellation invalidates the captured scope', async () => {
	const state = createState();
	const gate = deferred<void>();
	let beginCalls = 0;
	let capturedAssert: (() => void) | null = null;
	let releases = 0;
	const service = createRecordingSessionService({
		state,
		getProjectId: () => 'project-1',
		beginRecording: async (_options, scope) => {
			beginCalls += 1;
			capturedAssert = scope.assertCurrent;
			await gate.promise;
			scope.assertCurrent();
		},
		performLegacyFinalization: async () => {},
		performRoutedFinalization: async () => {},
		abortError: () => Object.assign(new Error('cancelled'), { name: 'AbortError' }),
		releaseUnretainedRecordingInputs: () => { releases += 1; },
	});

	const first = service.startRecording({ trackId: 'track-1' });
	assert.ok(first);
	assert.strictEqual(state.recordingStartPromise, first);
	assert.equal(service.startRecording({ trackId: 'track-2' }), undefined);
	assert.equal(beginCalls, 1);
	assert.equal(service.cancelRecordingStart(), true);
	assert.equal(releases, 1);
	assert.throws(() => capturedAssert?.(), { name: 'AbortError' });

	gate.resolve();
	await assert.rejects(first, { name: 'AbortError' });
	assert.equal(state.recordingStartPromise, null);
});

test('a synchronous capture-port failure still has tracked promise semantics', async () => {
	const state = createState();
	const failure = new Error('capture port failed');
	const service = createRecordingSessionService({
		state,
		getProjectId: () => 'project-1',
		beginRecording: () => { throw failure; },
		performLegacyFinalization: async () => {},
		performRoutedFinalization: async () => {},
	});

	const operation = service.startRecording();
	assert.ok(operation);
	assert.strictEqual(state.recordingStartPromise, operation);
	await assert.rejects(operation, failure);
	assert.equal(state.recordingStartPromise, null);
});

test('recording finalization is joinable, selects the routed path, and resets state once', async () => {
	const recorder = createRecorder();
	const state = createState({
		recorder,
		recordingEntries: [{ trackId: 'track-1' }],
		recordingPreview: { frames: 12 },
		recordingPreviews: [{ frames: 12 }],
		recordingWriter: { framesWritten: 12 },
		recordingSourceOffsetFrames: 6,
		recordingCleanup: () => { cleanupCalls += 1; },
		recordingReleaseAfterStop: true,
	});
	const gate = deferred<void>();
	let cleanupCalls = 0;
	let routedCalls = 0;
	let releases = 0;
	let publishes = 0;
	const service = createRecordingSessionService({
		state,
		getProjectId: () => 'project-1',
		beginRecording: async () => {},
		performLegacyFinalization: async () => assert.fail('legacy finalizer should not run'),
		performRoutedFinalization: async ({ recorder: activeRecorder, entries }) => {
			routedCalls += 1;
			assert.strictEqual(activeRecorder, recorder);
			assert.equal(entries.length, 1);
			await gate.promise;
		},
		releaseUnretainedRecordingInputs: ({ force } = {}) => {
			assert.equal(force, true);
			releases += 1;
		},
		retainInputs: () => true,
		publishDocumentSnapshot: () => { publishes += 1; },
	});

	const first = service.finalizeRecording();
	const second = service.finalizeRecording();
	assert.strictEqual(second, first);
	assert.strictEqual(state.recordingFinalizePromise, first);
	assert.equal(state.recordingFinishing, true);
	assert.equal(routedCalls, 1);

	gate.resolve();
	await first;
	assert.equal(cleanupCalls, 1);
	assert.equal(releases, 1);
	assert.equal(publishes, 2);
	assert.equal(state.recorder, null);
	assert.equal(state.recordingEntries, null);
	assert.equal(state.recordingPreview, null);
	assert.deepEqual(state.recordingPreviews, []);
	assert.equal(state.recordingWriter, null);
	assert.equal(state.recordingSourceOffsetFrames, 0);
	assert.equal(state.recordingFinalizePromise, null);
	assert.equal(state.recordingFinishing, false);
});

test('stop waits for finalization and then preserves a recorder stop failure', async () => {
	const stopError = new Error('device stopped unexpectedly');
	const selection = { startFrame: 20, endFrame: 80 };
	const preview = { frames: 64 };
	const resampler = { finish: () => null };
	const state = createState({
		recorder: createRecorder({ stopError }),
		recordingSourceId: 'source-1',
		recordingTrackId: 'track-1',
		recordingStartFrame: 20,
		recordingSourceOffsetFrames: 4,
		recordingSelection: selection,
		recordingResampler: resampler,
		recordingSampleRate: 48_000,
		recordingPreview: preview,
	});
	let finalizations = 0;
	const service = createRecordingSessionService({
		state,
		getProjectId: () => 'project-1',
		beginRecording: async () => {},
		performLegacyFinalization: async (snapshot) => {
			finalizations += 1;
			assert.equal(snapshot.sourceId, 'source-1');
			assert.equal(snapshot.trackId, 'track-1');
			assert.equal(snapshot.startFrame, 20);
			assert.equal(snapshot.sourceOffsetFrames, 4);
			assert.strictEqual(snapshot.selection, selection);
			assert.strictEqual(snapshot.resampler, resampler);
			assert.equal(snapshot.sampleRate, 48_000);
			assert.strictEqual(snapshot.preview, preview);
		},
		performRoutedFinalization: async () => {},
	});

	await assert.rejects(service.stopRecording(), stopError);
	assert.equal(finalizations, 1);
	assert.equal(state.recorder, null);
});

test('new-track, pause, and lead-in helpers retain controller-facing behavior', async () => {
	const recorder = createRecorder();
	const state = createState();
	const transport: string[] = [];
	const persisted: boolean[] = [];
	const service = createRecordingSessionService({
		state,
		getProjectId: () => 'project-1',
		addTrack: () => 'new-track',
		beginRecording: async (options) => {
			assert.equal(options.trackId, 'new-track');
		},
		performLegacyFinalization: async () => {},
		performRoutedFinalization: async () => {},
		playTransport: async () => { transport.push('play'); },
		pauseTransport: () => { transport.push('pause'); },
		updateTransportState: (value) => { transport.push(value); },
		persistLeadIn: async (value) => { persisted.push(value); },
	});

	assert.equal(await service.startRecordingOnNewTrack(), 'new-track');
	state.recorder = recorder;
	assert.equal(service.toggleRecordingPause(), true);
	assert.equal(service.toggleRecordingPause(), false);
	assert.deepEqual(transport, ['pause', 'paused-recording', 'play', 'recording']);
	state.recorder = null;
	assert.equal(service.toggleLeadInRecording(), true);
	await Promise.resolve();
	assert.deepEqual(persisted, [true]);
});

test('new-track recording does not add an orphan track during a pending start', async () => {
	const state = createState({ recordingStartPromise: Promise.resolve() });
	let addTrackCalls = 0;
	const service = createRecordingSessionService({
		state,
		getProjectId: () => 'project-1',
		addTrack: () => { addTrackCalls += 1; return 'orphan-track'; },
		beginRecording: async () => {},
		performLegacyFinalization: async () => {},
		performRoutedFinalization: async () => {},
	});

	assert.equal(await service.startRecordingOnNewTrack(), null);
	assert.equal(addTrackCalls, 0);
});

test('recording cancellation and terminal finalization reset sound activation ownership', async () => {
	const state = createState({ recordingStarting: true });
	let resets = 0;
	const service = createRecordingSessionService({
		state,
		getProjectId: () => 'project-1',
		beginRecording: async () => {},
		performLegacyFinalization: async () => {},
		performRoutedFinalization: async () => {},
		resetSoundActivationSources: () => { resets += 1; return true; },
	});

	assert.equal(service.cancelRecordingStart(), true);
	assert.equal(resets, 1);
	state.recorder = createRecorder();
	await service.finalizeRecording();
	assert.equal(resets, 2);
});

function createRecorder({ stopError }: { stopError?: Error } = {}): RecordingControllerLike {
	let state = 'recording';
	return {
		get state() { return state; },
		pause() { state = 'paused'; return true; },
		resume() { state = 'recording'; return true; },
		async stop() {
			state = 'stopped';
			if (stopError) throw stopError;
		},
	};
}

function createCaptureController({ stopError }: { stopError?: Error } = {}) {
	const starts: Array<Readonly<{ startFrame?: number; stopFrame?: number }>> = [];
	const transitions: string[] = [];
	const monitoring: boolean[] = [];
	const inputGains: number[] = [];
	const disposeOptions: Array<Readonly<{ stopTracks?: boolean }> | undefined> = [];
	let stopCalls = 0;
	const controller: RecordingCaptureControllerLike = {
		start(options = {}) { starts.push({ ...options }); },
		pause() { transitions.push('pause'); return true; },
		resume() { transitions.push('resume'); return true; },
		async stop() {
			stopCalls += 1;
			if (stopError) throw stopError;
		},
		setMonitoring(enabled) { monitoring.push(enabled); },
		setInputGain(value) { inputGains.push(value); },
		async dispose(options) { disposeOptions.push(options); },
	};
	return {
		controller,
		starts,
		transitions,
		monitoring,
		inputGains,
		disposeOptions,
		get stopCalls() { return stopCalls; },
	};
}

function createTransactionalCaptureController({
	pauseFailure = null,
	resumeFailure = null,
}: {
	readonly pauseFailure?: 'false' | 'throw' | null;
	readonly resumeFailure?: 'false' | 'throw' | null;
} = {}) {
	let controllerState = 'ready';
	let currentPauseFailure = pauseFailure;
	let currentResumeFailure = resumeFailure;
	let stopCalls = 0;
	const transitions: string[] = [];
	const controller: RecordingCaptureControllerLike = {
		get state() { return controllerState; },
		start() { controllerState = 'recording'; },
		pause() {
			transitions.push('pause');
			if (currentPauseFailure === 'throw') throw new Error('pause failure');
			if (currentPauseFailure === 'false') return false;
			if (controllerState !== 'recording') return false;
			controllerState = 'paused';
			return true;
		},
		resume() {
			transitions.push('resume');
			if (currentResumeFailure === 'throw') throw new Error('resume failure');
			if (currentResumeFailure === 'false') return false;
			if (controllerState !== 'paused') return false;
			controllerState = 'recording';
			return true;
		},
		async stop() {
			stopCalls += 1;
			controllerState = 'stopped';
		},
		setMonitoring() {},
		setInputGain() {},
	};
	return {
		controller,
		transitions,
		state: () => controllerState,
		stopCalls: () => stopCalls,
		setPauseFailure(value: 'false' | 'throw' | null) { currentPauseFailure = value; },
		setResumeFailure(value: 'false' | 'throw' | null) { currentResumeFailure = value; },
	};
}

function createState(
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

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	return { promise, resolve, reject };
}
