/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createTimedRecordingInputService,
	type TimedRecordingInputProject,
	type TimedRecordingInputRoute,
	type TimedRecordingInputServiceRuntime,
} from '../src/common/editor/controller/timed-recording-input-service.ts';
import {
	createTimedRecordingService,
	type TimedRecordingMutableState,
} from '../src/common/editor/controller/timed-recording-service.ts';

interface TestStream {
	readonly id: string;
	readonly channels: number;
	readonly audioLive: boolean;
	readonly videoLive: boolean;
}

interface FixtureOptions {
	readonly tracks?: TimedRecordingInputProject['tracks'];
	readonly routes?: Readonly<Record<string, TimedRecordingInputRoute>>;
	readonly preferredChannels?: number;
	readonly retainedDisplay?: TestStream | null;
	readonly retainedHardware?: Readonly<Record<string, TestStream>>;
	readonly acquireDisplay?: () => Promise<TestStream>;
	readonly acquireHardware?: (
		deviceId: string,
		options: Readonly<{ channelCount: number; sampleRate: number }>,
	) => Promise<TestStream>;
}

function stream(
	id: string,
	channels = 2,
	options: Readonly<{ audioLive?: boolean; videoLive?: boolean }> = {},
): TestStream {
	return {
		id,
		channels,
		audioLive: options.audioLive !== false,
		videoLive: options.videoLive !== false,
	};
}

function createFixture(options: FixtureOptions = {}) {
	let project: TimedRecordingInputProject = {
		tracks: options.tracks || [{ id: 'track-1', type: 'audio', armed: true }],
	};
	const routes = options.routes || {};
	const health: Record<string, string> = {};
	const events: string[] = [];
	const hardwareRequests: Array<Readonly<{
		deviceId: string;
		channelCount: number;
		sampleRate: number;
	}>> = [];
	let displayRequests = 0;
	const fallbackDisplay = stream('display');
	const fallbackHardware = stream('hardware');
	const runtime = {
		getProject: () => project,
		findTrack: (targetProject, trackId) => (
			targetProject.tracks.find((track) => track.id === trackId) || null
		),
		projectSampleRate: () => 48_000,
		getPreferredInputChannelCount: () => options.preferredChannels ?? 1,
		getRecordingRoutes: () => routes,
		setRecordingRouteHealth: (trackId, value) => {
			health[trackId] = value;
			events.push(`health:${trackId}:${value}`);
		},
		capturePool: {
			getDisplay: () => options.retainedDisplay ?? null,
			getHardware: (deviceId) => options.retainedHardware?.[deviceId] || null,
			acquireDisplay: async () => {
				displayRequests += 1;
				events.push('acquire:display');
				return options.acquireDisplay?.() || fallbackDisplay;
			},
			acquireHardware: async (deviceId, request) => {
				hardwareRequests.push({ deviceId, ...request });
				events.push(`acquire:${deviceId}:${request.channelCount}`);
				return options.acquireHardware?.(deviceId, request) || fallbackHardware;
			},
		},
		defaultDeviceId: 'default',
		recordingRouteSourceKey: (route) => (
			route.kind === 'display' ? 'display' : `device:${route.deviceId}`
		),
		streamAudioChannelCount: (value) => value.channels,
		recordingStreamIsLive: (value, kind) => (
			value.audioLive && (kind !== 'display' || value.videoLive)
		),
		messages: {
			armTrack: 'Arm a track for recording.',
			assignInput: 'Assign an input to at least one armed track before recording.',
			preparedInputClosed: 'The prepared recording input closed before the timer was armed.',
			assignedInputsUnavailable: 'Every assigned recording input must remain available for timer recording.',
		},
	} satisfies TimedRecordingInputServiceRuntime<TestStream>;
	return {
		events,
		health,
		hardwareRequests,
		runtime,
		service: createTimedRecordingInputService(runtime),
		get displayRequests() { return displayRequests; },
		setProject(value: TimedRecordingInputProject) { project = value; },
	};
}

const currentScope = Object.freeze({ assertCurrent() {} });

test('explicit default-track preparation preserves the legacy route and immutable result contract', async () => {
	const fixture = createFixture({
		preferredChannels: 1,
		routes: {
			'track-1': {
				kind: 'device', deviceId: 'default', channelStart: 0, channelCount: 2,
			},
		},
	});

	assert.deepEqual(Object.keys(fixture.service), ['prepareTimedRecordingInputs']);
	assert.equal(Object.isFrozen(fixture.service), true);
	const result = await fixture.service.prepareTimedRecordingInputs(
		{ trackId: 'track-1' },
		currentScope,
	);

	assert.deepEqual(fixture.hardwareRequests, [{
		deviceId: 'default', channelCount: 1, sampleRate: 48_000,
	}]);
	assert.deepEqual(result, { inputKeys: ['device:default'] });
	assert.equal(Object.isFrozen(result), true);
	assert.equal(Object.isFrozen(result.inputKeys), true);
	assert.deepEqual(fixture.health, {}, 'the explicit legacy path does not own route-health publication');
});

test('explicit display and routed microphone preparation preserve retained-input reuse and channel requests', async () => {
	const retainedDisplay = stream('retained-display');
	const display = createFixture({
		retainedDisplay,
		routes: {
			'track-1': { kind: 'display', channelStart: 0, channelCount: 2 },
		},
	});
	assert.deepEqual(
		await display.service.prepareTimedRecordingInputs({ trackId: 'track-1' }, currentScope),
		{ inputKeys: ['display'] },
	);
	assert.equal(display.displayRequests, 0);

	const routedMicrophone = createFixture({
		routes: {
			'track-1': { kind: 'device', deviceId: 'interface', channelStart: 2, channelCount: 2 },
		},
	});
	assert.deepEqual(
		await routedMicrophone.service.prepareTimedRecordingInputs({ trackId: 'track-1' }, currentScope),
		{ inputKeys: ['device:interface'] },
	);
	assert.deepEqual(routedMicrophone.hardwareRequests, [{
		deviceId: 'interface', channelCount: 4, sampleRate: 48_000,
	}]);
});

test('prepared-only explicit capture rejects missing capabilities and delegates adequate pool reuse', async () => {
	const route = {
		'track-1': { kind: 'device', deviceId: 'interface', channelStart: 2, channelCount: 2 },
	} as const;
	for (const retained of [null, stream('undersized', 3)]) {
		const fixture = createFixture({
			routes: route,
			retainedHardware: retained ? { interface: retained } : {},
		});
		await assert.rejects(
			fixture.service.prepareTimedRecordingInputs(
				{ trackId: 'track-1', reusePreparedInputsOnly: true },
				currentScope,
			),
			/prepared recording input closed/u,
		);
		assert.equal(fixture.hardwareRequests.length, 0);
	}

	const retained = stream('retained', 4);
	const reusable = createFixture({
		routes: route,
		retainedHardware: { interface: retained },
		acquireHardware: async () => retained,
	});
	await reusable.service.prepareTimedRecordingInputs(
		{ trackId: 'track-1', reusePreparedInputsOnly: true },
		currentScope,
	);
	assert.equal(reusable.hardwareRequests.length, 1, 'the pool remains the hardware reuse authority');
});

test('armed preparation groups duplicate sources, orders display first, and validates every route', async () => {
	const fixture = createFixture({
		tracks: [
			{ id: 'mic-left', type: 'audio', armed: true },
			{ id: 'display', type: 'audio', armed: true },
			{ id: 'mic-right', type: 'audio', armed: true },
			{ id: 'unassigned', type: 'audio', armed: true },
			{ id: 'label', type: 'label', armed: true },
		],
		routes: {
			'mic-left': { kind: 'device', deviceId: 'interface', channelStart: 0, channelCount: 1 },
			display: { kind: 'display', channelStart: 0, channelCount: 2 },
			'mic-right': { kind: 'device', deviceId: 'interface', channelStart: 2, channelCount: 2 },
		},
		acquireHardware: async () => stream('four-channel', 4),
	});

	const result = await fixture.service.prepareTimedRecordingInputs({}, currentScope);
	assert.deepEqual(result.inputKeys, ['display', 'device:interface']);
	assert.deepEqual(fixture.hardwareRequests, [{
		deviceId: 'interface', channelCount: 4, sampleRate: 48_000,
	}]);
	assert.equal(fixture.displayRequests, 1);
	assert.ok(fixture.events.indexOf('acquire:display') < fixture.events.indexOf('acquire:interface:4'));
	assert.deepEqual(fixture.health, {
		'mic-left': 'open',
		display: 'open',
		'mic-right': 'open',
		unassigned: 'skipped',
	});
});

test('partial permission failure remains all-or-nothing while the scheduler owns cleanup', async () => {
	const input = createFixture({
		tracks: [
			{ id: 'display', type: 'audio', armed: true },
			{ id: 'microphone', type: 'audio', armed: true },
		],
		routes: {
			display: { kind: 'display', channelStart: 0, channelCount: 2 },
			microphone: { kind: 'device', deviceId: 'denied', channelStart: 0, channelCount: 1 },
		},
		acquireHardware: async () => { throw new Error('permission denied'); },
	});
	const timedState = createTimedState();
	let releases = 0;
	const timed = createTimedRecordingService({
		state: timedState,
		getProjectId: () => 'project-1',
		normalizeStartTime: Number,
		currentTimeMs: () => 1_000,
		prepareInputs: input.service.prepareTimedRecordingInputs,
		prepareContext: async () => {},
		startRecording: async () => {},
		cancelRecordingStart: () => false,
		finalizeRecording: async () => {},
		activatePreparedRecording: async () => {},
		scheduleTimer: () => 1,
		clearTimer: () => {},
		releaseUnretainedRecordingInputs: () => { releases += 1; },
		messages: timedMessages(),
	});

	await assert.rejects(timed.scheduleTimedRecording(2_000), /Every assigned recording input/u);
	assert.equal(releases, 1);
	assert.equal(input.health.display, 'open');
	assert.equal(input.health.microphone, 'unavailable');
});

test('partial preparation leaves retained pool inputs open for the scheduler retention policy', async () => {
	const input = createFixture({
		tracks: [
			{ id: 'display', type: 'audio', armed: true },
			{ id: 'microphone', type: 'audio', armed: true },
		],
		routes: {
			display: { kind: 'display', channelStart: 0, channelCount: 2 },
			microphone: { kind: 'device', deviceId: 'denied', channelStart: 0, channelCount: 1 },
		},
		acquireHardware: async () => { throw new Error('permission denied'); },
	});
	let releases = 0;
	const timed = createTimedRecordingService({
		state: createTimedState(),
		getProjectId: () => 'project-1',
		normalizeStartTime: Number,
		currentTimeMs: () => 1_000,
		prepareInputs: input.service.prepareTimedRecordingInputs,
		prepareContext: async () => {},
		startRecording: async () => {},
		cancelRecordingStart: () => false,
		finalizeRecording: async () => {},
		activatePreparedRecording: async () => {},
		scheduleTimer: () => 1,
		clearTimer: () => {},
		retainInputs: () => true,
		releaseUnretainedRecordingInputs: () => { releases += 1; },
		messages: timedMessages(),
	});

	await assert.rejects(timed.scheduleTimedRecording(2_000), /Every assigned recording input/u);
	assert.equal(releases, 0);
	assert.equal(input.health.display, 'open');
	assert.equal(input.health.microphone, 'unavailable');
});

for (const scenario of ['cancellation', 'disposal', 'project switch'] as const) {
	test(`late preparation cannot publish after ${scenario}`, async () => {
		const acquisition = deferred<TestStream>();
		const input = createFixture({
			routes: {
				'track-1': { kind: 'device', deviceId: 'microphone', channelStart: 0, channelCount: 1 },
			},
			acquireHardware: () => acquisition.promise,
		});
		const timedState = createTimedState();
		let projectId = 'project-1';
		let releases = 0;
		let starts = 0;
		const timed = createTimedRecordingService({
			state: timedState,
			getProjectId: () => projectId,
			normalizeStartTime: Number,
			currentTimeMs: () => 1_000,
			prepareInputs: input.service.prepareTimedRecordingInputs,
			prepareContext: async () => {},
			startRecording: async () => { starts += 1; },
			cancelRecordingStart: () => false,
			finalizeRecording: async () => {},
			activatePreparedRecording: async () => {},
			scheduleTimer: () => 1,
			clearTimer: () => {},
			releaseUnretainedRecordingInputs: () => { releases += 1; },
			syncRecordingPoolSnapshot: () => { input.health['track-1'] = 'unavailable'; },
			messages: timedMessages(),
		});
		const pending = timed.scheduleTimedRecording(2_000);
		assert.equal(input.health['track-1'], 'opening');
		if (scenario === 'cancellation') timed.cancelTimedRecording();
		else if (scenario === 'disposal') timedState.disposed = true;
		else projectId = 'project-2';
		acquisition.resolve(stream('late'));

		assert.equal(await pending, null);
		assert.equal(input.health['track-1'], 'unavailable');
		assert.equal(starts, 0);
		assert.equal(releases, 1);
	});
}

test('invalid track, routing, stream, and channel capabilities preserve controller errors and health', async () => {
	const invalidTrack = createFixture();
	await assert.rejects(
		invalidTrack.service.prepareTimedRecordingInputs({ trackId: 'missing' }, currentScope),
		/Arm a track/u,
	);

	const unarmed = createFixture({ tracks: [{ id: 'track-1', type: 'audio', armed: false }] });
	await assert.rejects(
		unarmed.service.prepareTimedRecordingInputs({}, currentScope),
		/Arm a track/u,
	);

	const unassigned = createFixture();
	await assert.rejects(
		unassigned.service.prepareTimedRecordingInputs({}, currentScope),
		/Assign an input/u,
	);
	assert.equal(unassigned.health['track-1'], 'skipped');

	const closedDisplay = createFixture({
		routes: { 'track-1': { kind: 'display', channelStart: 0, channelCount: 2 } },
		acquireDisplay: async () => stream('closed-display', 2, { videoLive: false }),
	});
	await assert.rejects(
		closedDisplay.service.prepareTimedRecordingInputs({ trackId: 'track-1' }, currentScope),
		/prepared recording input closed/u,
	);

	const undersized = createFixture({
		routes: {
			'track-1': { kind: 'device', deviceId: 'interface', channelStart: 2, channelCount: 2 },
		},
		acquireHardware: async () => stream('stereo', 2),
	});
	await assert.rejects(
		undersized.service.prepareTimedRecordingInputs({}, currentScope),
		/Every assigned recording input/u,
	);
	assert.equal(undersized.health['track-1'], 'skipped');
});

function createTimedState(): TimedRecordingMutableState<number> {
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
	};
}

function timedMessages() {
	return {
		projectReadOnly: 'read only',
		past: 'past',
		preparing: 'preparing',
		missed: 'missed',
		scheduled: (time: string) => `scheduled ${time}`,
		cancelled: 'cancelled',
	};
}

function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
}
