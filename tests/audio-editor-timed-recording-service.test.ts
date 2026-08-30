/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { RecordingControllerLike } from '../src/common/editor/controller/recording-session-service.ts';
import {
	createTimedRecordingService,
	type TimedRecordingMutableState,
} from '../src/common/editor/controller/timed-recording-service.ts';

test('timed recording service exposes only schedule and cancellation actions', () => {
	const service = createTimedRecordingService({
		state: createState(),
		getProjectId: () => 'project-1',
		normalizeStartTime: Number,
		currentTimeMs: () => 1_000,
		prepareInputs: async () => ({ inputKeys: [] }),
		prepareContext: async () => {},
		startRecording: async () => {},
		cancelRecordingStart: () => false,
		finalizeRecording: async () => {},
		activatePreparedRecording: async () => {},
		scheduleTimer: () => 1,
		clearTimer: () => {},
		messages: messages(),
	});

	assert.deepEqual(Object.keys(service).sort(), [
		'cancelTimedRecording',
		'scheduleTimedRecording',
	]);
	assert.equal(Object.isFrozen(service), true);
});

test('pending open recovery refuses timed recording before input or context preparation', async () => {
	let preparations = 0;
	const service = createTimedRecordingService({
		state: createState({ takeCycleRecovery: {} }),
		getProjectId: () => 'project-1', normalizeStartTime: Number, currentTimeMs: () => 1_000,
		prepareInputs: async () => { preparations += 1; return { inputKeys: [] }; },
		prepareContext: async () => { preparations += 1; }, startRecording: async () => {},
		cancelRecordingStart: () => false, finalizeRecording: async () => {},
		activatePreparedRecording: async () => {}, scheduleTimer: () => 1, clearTimer: () => {},
		messages: messages(),
	});
	await assert.rejects(service.scheduleTimedRecording(5_000), /read only/u);
	assert.equal(preparations, 0);
});

test('timed recording prepares input and context in parallel before arming a bounded timer', async () => {
	const state = createState();
	const inputGate = deferred<Readonly<{ inputKeys: readonly string[] }>>();
	const contextGate = deferred<void>();
	const timers: Array<{ callback: () => unknown; delay: number }> = [];
	const events: string[] = [];
	let now = 1_000;
	const recorder = createRecorder();
	const service = createTimedRecordingService({
		state,
		getProjectId: () => 'project-1',
		normalizeStartTime: Number,
		currentTimeMs: () => now,
		prepareInputs: () => {
			events.push('input');
			return inputGate.promise;
		},
		prepareContext: () => {
			events.push('context');
			return contextGate.promise;
		},
		startRecording: async (options) => {
			events.push(`start:${options.reusePreparedInputsOnly}`);
			state.recorder = recorder;
		},
		cancelRecordingStart: () => false,
		finalizeRecording: async () => {},
		activatePreparedRecording: async () => { events.push('activate'); },
		scheduleTimer: (callback, delay) => {
			timers.push({ callback, delay });
			return timers.length;
		},
		clearTimer: () => {},
		maximumTimerDelayMs: 1_500,
		setStatus: (message) => { events.push(`status:${message}`); },
		messages: messages(),
		formatScheduledTime: (value) => `at-${value}`,
	});

	const pending = service.scheduleTimedRecording(5_000, { trackId: 'track-1' });
	assert.deepEqual(events.slice(0, 3), ['status:preparing', 'input', 'context']);
	inputGate.resolve({ inputKeys: ['device:default'] });
	contextGate.resolve();
	const result = await pending;
	assert.deepEqual(result, {
		startTimeMs: 5_000,
		startTime: new Date(5_000).toISOString(),
		trackId: 'track-1',
	});
	assert.equal(timers.length, 1);
	assert.equal(timers[0].delay, 1_500);
	assert.equal(state.timedRecordingPreparing, false);
	assert.equal(state.timedRecording?.inputKeys[0], 'device:default');

	now = 2_000;
	await timers[0].callback();
	assert.equal(timers.length, 2);
	assert.equal(timers[1].delay, 1_500);
	assert.equal(state.timedRecording?.startTimeMs, 5_000);
	assert.equal(events.includes('activate'), false);

	now = 5_000;
	await timers[1].callback();
	assert.equal(state.timedRecording, null);
	assert.ok(events.includes('activate'));
});

test('cancelling preparation invalidates late results and releases unretained inputs', async () => {
	const state = createState();
	const inputGate = deferred<Readonly<{ inputKeys: readonly string[] }>>();
	let startCalls = 0;
	let releases = 0;
	let publishes = 0;
	const service = createTimedRecordingService({
		state,
		getProjectId: () => 'project-1',
		normalizeStartTime: Number,
		currentTimeMs: () => 1_000,
		prepareInputs: () => inputGate.promise,
		prepareContext: async () => {},
		startRecording: async () => { startCalls += 1; },
		cancelRecordingStart: () => false,
		finalizeRecording: async () => {},
		activatePreparedRecording: async () => {},
		scheduleTimer: () => 1,
		clearTimer: () => {},
		releaseUnretainedRecordingInputs: () => { releases += 1; },
		publishDocumentSnapshot: () => { publishes += 1; },
		setStatus: () => { publishes += 1; },
		messages: messages(),
	});

	const pending = service.scheduleTimedRecording(5_000);
	assert.equal(service.cancelTimedRecording(), true);
	inputGate.resolve({ inputKeys: ['device:default'] });
	assert.equal(await pending, null);
	assert.equal(startCalls, 0);
	assert.equal(releases, 1);
	assert.ok(publishes >= 1);
	assert.equal(state.timedRecording, null);
	assert.equal(state.timedRecordingPreparing, false);
});

test('context preparation starts even when the input port throws synchronously', async () => {
	const state = createState();
	const failure = new Error('permission denied');
	let contextCalls = 0;
	const service = createTimedRecordingService({
		state,
		getProjectId: () => 'project-1',
		normalizeStartTime: Number,
		currentTimeMs: () => 1_000,
		prepareInputs: () => { throw failure; },
		prepareContext: () => { contextCalls += 1; },
		startRecording: async () => {},
		cancelRecordingStart: () => false,
		finalizeRecording: async () => {},
		activatePreparedRecording: async () => {},
		scheduleTimer: () => 1,
		clearTimer: () => {},
		messages: messages(),
	});

	await assert.rejects(service.scheduleTimedRecording(5_000), failure);
	assert.equal(contextCalls, 1);
	assert.equal(state.timedRecordingPreparing, false);
});

test('cancelling an armed recorder discards it through the joinable finalizer', async () => {
	const recorder = createRecorder();
	const state = createState({
		recorder,
		timedRecording: Object.freeze({
			generation: 4,
			projectId: 'project-1',
			startTimeMs: 5_000,
			options: Object.freeze({}),
			inputKeys: Object.freeze(['device:default']),
		}),
		timedRecordingGeneration: 4,
		timedRecordingTimer: 9,
	});
	let finalizations = 0;
	let cleared = 0;
	const service = createTimedRecordingService({
		state,
		getProjectId: () => 'project-1',
		normalizeStartTime: Number,
		currentTimeMs: () => 1_000,
		prepareInputs: async () => ({ inputKeys: [] }),
		prepareContext: async () => {},
		startRecording: async () => {},
		cancelRecordingStart: () => false,
		finalizeRecording: async () => { finalizations += 1; state.recorder = null; },
		activatePreparedRecording: async () => {},
		scheduleTimer: () => 1,
		clearTimer: () => { cleared += 1; },
		messages: messages(),
	});

	assert.equal(service.cancelTimedRecording(), true);
	await settle();
	assert.equal(state.recordingDiscardRequested, true);
	assert.equal(recorder.stopCalls, 1);
	assert.equal(finalizations, 1);
	assert.equal(cleared, 1);
	assert.equal(state.timedRecordingCancelling, false);
});

test('cancelling an armed recorder still finalizes after its stop rejects', async () => {
	const stopFailure = new Error('worklet stop failed');
	const recorder: RecordingControllerLike & { stopCalls: number } = {
		stopCalls: 0,
		async stop() {
			this.stopCalls += 1;
			throw stopFailure;
		},
	};
	const state = createState({
		recorder,
		timedRecording: Object.freeze({
			generation: 4,
			projectId: 'project-1',
			startTimeMs: 5_000,
			options: Object.freeze({}),
			inputKeys: Object.freeze(['device:default']),
		}),
		timedRecordingGeneration: 4,
		timedRecordingTimer: 9,
	});
	const errors: unknown[] = [];
	let finalizations = 0;
	const service = createTimedRecordingService({
		state,
		getProjectId: () => 'project-1',
		normalizeStartTime: Number,
		currentTimeMs: () => 1_000,
		prepareInputs: async () => ({ inputKeys: [] }),
		prepareContext: async () => {},
		startRecording: async () => {},
		cancelRecordingStart: () => false,
		finalizeRecording: async () => {
			finalizations += 1;
			state.recorder = null;
		},
		activatePreparedRecording: async () => {},
		scheduleTimer: () => 1,
		clearTimer: () => {},
		handleError: (error) => { errors.push(error); },
		messages: messages(),
	});

	assert.equal(service.cancelTimedRecording(), true);
	await settle();
	assert.equal(recorder.stopCalls, 1);
	assert.equal(finalizations, 1);
	assert.equal(state.recorder, null);
	assert.deepEqual(errors, [stopFailure]);
	assert.equal(state.timedRecordingCancelling, false);
});

test('cancelling while scheduled activation awaits invalidates and discards the recorder', async () => {
	const recorder = createRecorder();
	const state = createState();
	const activationGate = deferred<void>();
	const timers: Array<() => unknown> = [];
	let activations = 0;
	let finalizations = 0;
	let now = 1_000;
	const service = createTimedRecordingService({
		state,
		getProjectId: () => 'project-1',
		normalizeStartTime: Number,
		currentTimeMs: () => now,
		prepareInputs: async () => ({ inputKeys: ['device:default'] }),
		prepareContext: async () => {},
		startRecording: async () => { state.recorder = recorder; },
		cancelRecordingStart: () => false,
		finalizeRecording: async () => {
			finalizations += 1;
			state.recorder = null;
		},
		activatePreparedRecording: async (
			_scheduled,
			scope?: Readonly<{ assertCurrent(): void }>,
		) => {
			await activationGate.promise;
			scope?.assertCurrent();
			activations += 1;
		},
		scheduleTimer: (callback) => {
			timers.push(callback);
			return timers.length;
		},
		clearTimer: () => {},
		messages: messages(),
	});

	await service.scheduleTimedRecording(5_000);
	now = 5_000;
	const activating = Promise.resolve(timers[0]!());
	await settle();

	assert.equal(service.cancelTimedRecording(), true, 'activation remains owned and cancellable');
	activationGate.resolve();
	assert.equal(await activating, null);
	await settle();
	assert.equal(activations, 0, 'the stale activation cannot publish recording state');
	assert.equal(state.recordingDiscardRequested, true, 'the stale prepared take is finalized as a discard');
	assert.equal(recorder.stopCalls, 1);
	assert.equal(finalizations, 1);
	assert.equal(state.recorder, null);
	assert.equal(state.timedRecordingCancelling, false);
});

function messages() {
	return {
		projectReadOnly: 'read only',
		past: 'past',
		preparing: 'preparing',
		missed: 'missed',
		scheduled: (time: string) => `scheduled ${time}`,
		cancelled: 'cancelled',
	};
}

function createRecorder(): RecordingControllerLike & { stopCalls: number } {
	return {
		stopCalls: 0,
		async stop() { this.stopCalls += 1; },
	};
}

function createState(
	overrides: Partial<TimedRecordingMutableState<number>> = {},
): TimedRecordingMutableState<number> {
	return {
		readOnly: false,
		disposed: false,
		recorder: null,
		recordingStarting: false,
		recordingStartPromise: null,
		recordingDiscardRequested: false,
		recordingReleaseAfterStop: false,
		timedRecording: null,
		timedRecordingTimer: null,
		timedRecordingGeneration: 0,
		timedRecordingPreparing: false,
		timedRecordingCancelling: false,
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

async function settle() {
	await Promise.resolve();
	await Promise.resolve();
}
