import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createMicrophoneMeterService,
	type MeterMediaStream,
	type MicrophoneMeterState,
} from '../src/common/editor/controller/microphone-meter-service.ts';

test('microphone meter chooses the selected hardware route and exposes a stable key', () => {
	const harness = createHarness();
	harness.state.selectedTrackId = 'selected';
	harness.state.recordingRouting = {
		routes: {
			fallback: deviceRoute('fallback-device', 0, 1),
			selected: deviceRoute('selected-device', 2, 2),
		},
	};

	assert.deepEqual(harness.service.getRoute(), deviceRoute('selected-device', 2, 2));
	assert.equal(harness.service.getRouteKey(), 'selected-device:2:2');
	assert.equal(harness.service.getDeviceId(), 'selected-device');
});

test('disabling during asynchronous acquisition prevents late meter resurrection', async () => {
	const acquisition = deferred<FakeStream>();
	const harness = createHarness({ acquireHardware: () => acquisition.promise });

	const starting = harness.service.setMicrophoneMetering(true);
	assert.equal(harness.acquireCount, 1);
	await harness.service.setMicrophoneMetering(false);
	acquisition.resolve(fakeStream('late'));

	assert.equal(await starting, false);
	assert.equal(harness.service.getSession(), null);
	assert.deepEqual(harness.releasedDevices, ['default']);
	assert.equal(harness.contextRequests, 0);
	assert.equal(harness.state.microphoneMetering, false);
});

test('disabling during loudness worklet setup tears down the pending graph and input', async () => {
	const loudness = deferred<void>();
	const harness = createHarness({ loudnessGate: loudness.promise });
	const starting = harness.service.setMicrophoneMetering(true);
	await harness.flush();
	await harness.service.setMicrophoneMetering(false);
	loudness.resolve();
	assert.equal(await starting, false);
	assert.equal(harness.service.getSession(), null);
	assert.equal(harness.intervalCount, 0);
	assert.equal(harness.loudnessDisposeCount, 1);
	assert.deepEqual(harness.releasedDevices, ['default']);
});

test('concurrent enable requests share one acquisition and one meter session', async () => {
	const acquisition = deferred<FakeStream>();
	const harness = createHarness({ acquireHardware: () => acquisition.promise });

	const first = harness.service.setMicrophoneMetering(true);
	const second = harness.service.setMicrophoneMetering(true);
	assert.equal(harness.acquireCount, 1);
	acquisition.resolve(fakeStream('shared'));

	assert.equal(await first, true);
	assert.equal(await second, true);
	assert.equal(harness.acquireCount, 1);
	assert.equal(harness.service.getSession()?.deviceId, 'default');
	assert.equal(harness.intervalCount, 1);
});

test('route synchronization replaces a live meter exactly once', async () => {
	const harness = createHarness();
	await harness.service.setMicrophoneMetering(true);
	assert.equal(harness.acquireCount, 1);

	harness.state.recordingRouting = {
		routes: {
			track: deviceRoute('replacement', 0, 1),
		},
	};
	harness.state.selectedTrackId = 'track';
	assert.equal(harness.service.synchronizeTarget(), true);
	await harness.flush();

	assert.equal(harness.service.getSession()?.deviceId, 'replacement');
	assert.equal(harness.acquireCount, 2);
	assert.equal(harness.disconnectCount > 0, true);
	assert.equal(harness.service.synchronizeTarget(), false);
});

test('ended input disables metering and persists the reconciled state', async () => {
	const harness = createHarness();
	await harness.service.setMicrophoneMetering(true);
	const stream = harness.service.getSession()?.stream as FakeStream | undefined;
	assert.ok(stream);

	stream.end();

	assert.equal(harness.service.getSession(), null);
	assert.equal(harness.state.microphoneMetering, false);
	assert.deepEqual(harness.persisted.at(-1), ['microphone-metering', false]);
});

test('late ended-session reconciliation cannot tear down its replacement', async () => {
	const harness = createHarness();
	await harness.service.setMicrophoneMetering(true);
	const endedSession = harness.service.getSession();
	assert.ok(endedSession);
	const replacement = fakeStream('replacement');
	harness.replaceStream(endedSession.deviceId, replacement);

	assert.equal(harness.service.reconcileInput({ endedSession }), true);
	await harness.flush();
	const replacementSession = harness.service.getSession();
	assert.ok(replacementSession);
	assert.equal(replacementSession.stream, replacement);
	assert.notEqual(replacementSession, endedSession);

	assert.equal(harness.service.reconcileInput({ endedSession }), false);
	assert.equal(harness.service.getSession(), replacementSession);
	assert.equal(harness.state.microphoneMetering, true);
});

test('input loudness controls address both live and routed meters', async () => {
	const harness = createHarness();
	await harness.service.setMicrophoneMetering(true);
	const routed = fakeLoudnessMeter();
	harness.service.setRoutedLoudnessMeter(routed, 'route');

	assert.equal(harness.service.pauseLoudnessMeasurement(), true);
	assert.equal(harness.state.inputLoudnessMeasurementManuallyPaused, true);
	assert.deepEqual(routed.running, [false]);

	harness.state.transportState = 'recording';
	assert.equal(harness.service.continueLoudnessMeasurement(), true);
	assert.deepEqual(routed.running, [false, true]);

	assert.equal(harness.service.resetLoudnessMeasurement(), true);
	assert.equal(routed.resetCount, 1);
	assert.deepEqual(harness.state.inputMeter, routed.snapshotValue);
});

interface FakeTrack {
	addEventListener(type: string, listener: () => void): void;
	removeEventListener(type: string, listener: () => void): void;
	getSettings(): Readonly<{ channelCount: number }>;
}

interface FakeStream extends MeterMediaStream {
	readonly id: string;
	end(): void;
	getAudioTracks(): readonly FakeTrack[];
}

function createHarness(overrides: Readonly<{
	acquireHardware?: (deviceId: string) => Promise<FakeStream>;
	loudnessGate?: Promise<void>;
}> = {}) {
	const state: MicrophoneMeterState = {
		disposed: false,
		microphoneMetering: false,
		recorder: null,
		recordingStarting: false,
		timedRecordingPreparing: false,
		timedRecording: null,
		preferences: { recording: { retainInputs: false } },
		recordingInputGain: 1,
		transportState: 'stopped',
		inputLoudnessMeasurementManuallyPaused: false,
		inputLoudnessMeasurementExplicitlyRunning: false,
		inputMeterDb: -60,
		inputMeter: null,
		selectedTrackId: null,
		recordingRouting: { routes: {} },
	};
	const releasedDevices: string[] = [];
	const persisted: Array<readonly [string, unknown]> = [];
	let acquireCount = 0;
	let contextRequests = 0;
	let intervalCount = 0;
	let loudnessDisposeCount = 0;
	let disconnectCount = 0;
	let nextInterval = 0;
	const streams = new Map<string, FakeStream>();
	const scheduled = new Map<number, () => void>();
	const node = () => ({
		connect: () => undefined,
		disconnect: () => { disconnectCount += 1; },
	});
	const context = {
		destination: node(),
		createMediaStreamSource: () => node(),
		createChannelSplitter: () => ({
			...node(),
			connect: () => undefined,
		}),
		createChannelMerger: () => node(),
		createAnalyser: () => ({
			...node(),
			fftSize: 256,
			smoothingTimeConstant: 0,
			getFloatTimeDomainData: (target: Float32Array) => target.fill(0.25),
		}),
	};
	const service = createMicrophoneMeterService({
		state,
		defaultDeviceId: 'default',
		recordingCapturePool: {
			getHardware: (deviceId) => streams.get(deviceId) ?? null,
			acquireHardware: async (deviceId) => {
				acquireCount += 1;
				const stream = overrides.acquireHardware
					? await overrides.acquireHardware(deviceId)
					: fakeStream(deviceId);
				streams.set(deviceId, stream);
				return stream;
			},
			releaseHardware: (deviceId) => {
				releasedDevices.push(deviceId);
				streams.delete(deviceId);
			},
		},
		getAudioContext: async () => {
			contextRequests += 1;
			return context;
		},
		createLoudnessMeterNode: async () => {
			await overrides.loudnessGate;
			return { ...fakeLoudnessMeter(), node: node(),
				dispose: () => { loudnessDisposeCount += 1; } };
		},
		streamAudioChannelCount: fakeStreamAudioChannelCount,
		projectSampleRate: () => 48_000,
		persistSetting: async (key, value) => { persisted.push([key, value]); },
		publishDocumentSnapshot: () => undefined,
		publishTelemetrySnapshot: () => undefined,
		syncRecordingPoolSnapshot: () => undefined,
		handleError: (error) => { throw error; },
		scheduleInterval: (callback) => {
			intervalCount += 1;
			nextInterval += 1;
			scheduled.set(nextInterval, callback);
			return nextInterval;
		},
		clearInterval: (identifier) => { scheduled.delete(Number(identifier)); },
	});
	return {
		service,
		state,
		releasedDevices,
		persisted,
		replaceStream(deviceId: string, stream: FakeStream) {
			streams.set(deviceId, stream);
		},
		get acquireCount() { return acquireCount; },
		get contextRequests() { return contextRequests; },
		get intervalCount() { return intervalCount; },
		get loudnessDisposeCount() { return loudnessDisposeCount; },
		get disconnectCount() { return disconnectCount; },
		async flush() {
			await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
		},
	};
}

function deviceRoute(deviceId: string, channelStart: number, channelCount: number) {
	return { kind: 'device' as const, deviceId, channelStart, channelCount };
}

function fakeStream(id: string): FakeStream {
	const listeners = new Set<() => void>();
	const track: FakeTrack = {
		addEventListener: (_type, listener) => { listeners.add(listener); },
		removeEventListener: (_type, listener) => { listeners.delete(listener); },
		getSettings: () => ({ channelCount: 2 }),
	};
	return {
		id,
		end: () => { for (const listener of [...listeners]) listener(); },
		getAudioTracks: () => [track],
	};
}

function fakeStreamAudioChannelCount(stream: MeterMediaStream): number {
	const track = stream.getAudioTracks?.()[0];
	if (!track || !('getSettings' in track) || typeof track.getSettings !== 'function') return 1;
	const settings: unknown = track.getSettings();
	if (!settings || typeof settings !== 'object' || !('channelCount' in settings)) return 1;
	return Number(settings.channelCount) || 1;
}

function fakeLoudnessMeter() {
	const snapshotValue = Object.freeze({ dbfs: -12 });
	return {
		running: [] as boolean[],
		resetCount: 0,
		snapshotValue,
		setRunning(running: boolean) { this.running.push(running); },
		setInputGain: (_value: number) => undefined,
		requestSnapshot: () => undefined,
		reset() { this.resetCount += 1; },
		snapshot: () => snapshotValue,
		dispose: () => undefined,
	};
}

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((fulfill) => { resolve = fulfill; });
	return { promise, resolve };
}
