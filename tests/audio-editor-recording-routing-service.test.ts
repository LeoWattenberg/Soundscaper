/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createRecordingRoutingService,
	type RecordingRoutingServiceRuntime,
} from '../src/common/editor/controller/recording-routing-service.ts';

interface TestProject {
	readonly id: string;
	readonly tracks: ReadonlyArray<{ readonly id: string }>;
}

interface FixtureOptions {
	readonly project?: TestProject | null;
	readonly loadSetting?: (key: string, fallback: unknown) => Promise<unknown>;
	readonly normalizeRouting?: (saved?: unknown, tracks?: TestProject['tracks']) => Record<string, unknown>;
	readonly enumerateDevices?: () => Promise<ReadonlyArray<Record<string, unknown>>>;
	readonly acquireHardware?: (deviceId: string) => Promise<unknown>;
	readonly persistSetting?: (key: string, value: unknown, options?: unknown) => Promise<unknown>;
	readonly setOutputDevice?: (deviceId: string) => Promise<unknown>;
}

function createFixture(options: FixtureOptions = {}) {
	const project = options.project === undefined
		? { id: 'project', tracks: [{ id: 'track' }] }
		: options.project;
	const normalizationCalls: Array<{ saved: unknown; tracks: unknown }> = [];
	const loadCalls: Array<[string, unknown]> = [];
	const hardwareRequests: string[] = [];
	const persistCalls: Array<[string, unknown, unknown]> = [];
	const stopMeterCalls: unknown[] = [];
	const releasedHardware: string[] = [];
	let publishes = 0;
	let meterInvalidations = 0;
	let releaseAllCalls = 0;
	let releaseDisplayCalls = 0;
	let poolSources: ReadonlyArray<Record<string, unknown>> = [];
	const state = {
		recordingRouting: {
			routes: {} as Record<string, Readonly<Record<string, unknown>>>,
			offsets: {} as Record<string, number>,
		},
		recordingDevices: [] as ReadonlyArray<Record<string, unknown>>,
		recordingRouteHealth: {} as Record<string, string>,
		recordingEnumeratedDeviceIds: new Set<string>(),
		recordingPoolSources: [] as ReadonlyArray<Record<string, unknown>>,
		audioInputDevices: [] as ReadonlyArray<Record<string, unknown>>,
		audioOutputDevices: [] as ReadonlyArray<Record<string, unknown>>,
		audioInputAccess: false,
		preferredInputDeviceId: 'default',
		preferredInputChannelCount: 1,
		preferredOutputDeviceId: '',
		activeOutputDeviceId: '',
		audioOutputStatus: 'default',
		selectedTrackId: 'track',
		preferences: { recording: { retainInputs: true } },
		recorder: null as object | null,
		recordingStarting: false,
		timedRecordingPreparing: false,
		timedRecording: null,
		recordingFinishing: false,
		recordingReleaseAfterStop: false,
		microphoneMetering: false,
	};
	const recordingCapturePool = {
		async acquireHardware(deviceId: string) {
			hardwareRequests.push(deviceId);
			return options.acquireHardware?.(deviceId);
		},
		getSnapshot: () => poolSources,
		releaseAll() {
			releaseAllCalls += 1;
			poolSources = [];
			return 2;
		},
		releaseDisplay: () => {
			releaseDisplayCalls += 1;
			return true;
		},
		releaseHardware: (deviceId: string) => {
			releasedHardware.push(deviceId);
			return true;
		},
	};
	const runtime = {
		AUDIO_DEVICE_PREFERENCES_SETTING_KEY: 'audio-devices',
		RECORDING_CHANNEL_COUNT_MAXIMUM: 32,
		RECORDING_DEFAULT_DEVICE_ID: 'default',
		RECORDING_DISPLAY_SOURCE_KEY: 'display',
		assignPreferredInputToTrack: () => undefined,
		engine: { setOutputDevice: options.setOutputDevice || (async (deviceId: string) => ({ activeDeviceId: deviceId })) },
		mediaDevices: {
			getUserMedia: () => undefined,
			enumerateDevices: options.enumerateDevices || (async () => []),
		},
		microphoneMeterDeviceId: () => 'meter-device',
		getMicrophoneMeterSession: () => null,
		invalidateMicrophoneMeter: () => { meterInvalidations += 1; },
		normalizePreferredInputDeviceId: (value: unknown) => String(value || 'default'),
		normalizePreferredOutputDeviceId: (value: unknown) => String(value || ''),
		normalizeRecordingRouting(saved?: unknown, tracks?: TestProject['tracks']) {
			normalizationCalls.push({ saved, tracks });
			return options.normalizeRouting?.(saved, tracks) || { routes: {}, offsets: {} };
		},
		persistSetting(key: string, value: unknown, persistOptions?: unknown) {
			persistCalls.push([key, value, persistOptions]);
			return options.persistSetting?.(key, value, persistOptions) ?? Promise.resolve(value);
		},
		productSettingKey: (key: string) => key,
		getProject: () => project,
		projectSampleRate: () => 48_000,
		publishDocumentSnapshot: () => { publishes += 1; },
		recordingCapturePool,
		recordingRouteSourceKey: (route: { kind?: string; deviceId?: string }) => (
			route.kind === 'display' ? 'display' : `device:${route.deviceId}`
		),
		recordingRoutingSettingKey: (projectId: string) => `routing:${projectId}`,
		setRecordingSourceOffset: (routing: typeof state.recordingRouting, sourceKey: string, value: unknown) => ({
			...routing,
			offsets: { ...routing.offsets, [sourceKey]: Number(value) || 0 },
		}),
		setRecordingTrackInput: async () => undefined,
		state,
		stopMicrophoneMetering: (stopOptions: unknown) => { stopMeterCalls.push(stopOptions); },
		store: {
			async loadSetting(key: string, fallback: unknown) {
				loadCalls.push([key, fallback]);
				return options.loadSetting?.(key, fallback) ?? fallback;
			},
		},
		updatePreferences: async (patch: { recording?: { retainInputs?: boolean } }) => {
			if (typeof patch.recording?.retainInputs === 'boolean') {
				state.preferences.recording.retainInputs = patch.recording.retainInputs;
			}
			return state.preferences;
		},
	} as RecordingRoutingServiceRuntime;
	return {
		service: createRecordingRoutingService(runtime),
		state,
		hardwareRequests,
		loadCalls,
		normalizationCalls,
		persistCalls,
		releasedHardware,
		stopMeterCalls,
		setPoolSources: (sources: ReadonlyArray<Record<string, unknown>>) => { poolSources = sources; },
		publishes: () => publishes,
		meterInvalidations: () => meterInvalidations,
		releaseAllCalls: () => releaseAllCalls,
		releaseDisplayCalls: () => releaseDisplayCalls,
	};
}

test('recording routing loading uses an empty fallback and handles a missing project locally', async () => {
	const noProject = createFixture({ project: null });
	assert.deepEqual(await noProject.service.loadRecordingRouting(), { routes: {}, offsets: {} });
	assert.deepEqual(noProject.loadCalls, []);
	assert.deepEqual(noProject.normalizationCalls, [{ saved: undefined, tracks: undefined }]);
	assert.deepEqual(noProject.state.recordingDevices, []);
	assert.deepEqual(noProject.state.recordingRouteHealth, {});

	const loadError = new Error('storage unavailable');
	const project = { id: 'fallback', tracks: [{ id: 'track' }] };
	const fallback = createFixture({
		project,
		loadSetting: async () => { throw loadError; },
		normalizeRouting: (_saved, tracks) => ({
			routes: Object.fromEntries((tracks || []).map((track) => [track.id, {
				kind: 'device', deviceId: 'missing', channelStart: 0, channelCount: 1,
			}])),
			offsets: {},
		}),
	});
	await fallback.service.loadRecordingRouting();
	assert.deepEqual(fallback.loadCalls, [['routing:fallback', null]]);
	assert.deepEqual(fallback.normalizationCalls, [{ saved: {}, tracks: project.tracks }]);
	assert.equal(fallback.state.recordingRouteHealth.track, 'unavailable');
});

test('input access settles each device request once and tolerates partial failures', async () => {
	const devices = [
		{ kind: 'audioinput', deviceId: 'default', label: 'Default' },
		{ kind: 'audioinput', deviceId: 'microphone-a', label: 'A' },
		{ kind: 'audioinput', deviceId: 'microphone-b', label: 'B' },
	];
	const defaultError = new Error('default failed');
	const partial = createFixture({
		enumerateDevices: async () => devices,
		acquireHardware: async (deviceId) => {
			if (deviceId !== 'microphone-a') throw deviceId === 'default' ? defaultError : new Error(`${deviceId} failed`);
		},
	});
	assert.equal((await partial.service.requestInputAccess()).length, 3);
	assert.deepEqual(partial.hardwareRequests.sort(), ['default', 'microphone-a', 'microphone-b']);
	assert.equal(partial.state.audioInputAccess, true);

	const allFailed = createFixture({
		enumerateDevices: async () => devices,
		acquireHardware: async (deviceId) => { throw deviceId === 'default' ? defaultError : new Error(`${deviceId} failed`); },
	});
	await assert.rejects(() => allFailed.service.requestInputAccess(), (error) => error === defaultError);
	assert.deepEqual(allFailed.hardwareRequests.sort(), ['default', 'microphone-a', 'microphone-b']);
});

test('audio output failures restore the preference and classify browser errors', async () => {
	for (const [name, expectedStatus] of [
		['NotSupportedError', 'unsupported'],
		['NotAllowedError', 'denied'],
		['SecurityError', 'denied'],
		['AbortError', 'error'],
	] as const) {
		const outputError = Object.assign(new Error(name), { name });
		const fixture = createFixture({ setOutputDevice: async () => { throw outputError; } });
		fixture.state.audioOutputDevices = [{ deviceId: 'speaker' }];
		fixture.state.preferredOutputDeviceId = 'previous';
		await assert.rejects(() => fixture.service.setAudioOutputDevice('speaker'), (error) => error === outputError);
		assert.equal(fixture.state.preferredOutputDeviceId, 'previous');
		assert.equal(fixture.state.audioOutputStatus, expectedStatus);
		assert.deepEqual(fixture.persistCalls, []);
		assert.equal(fixture.publishes(), 1);
	}
});

test('input release is guarded while active and invalidates idle microphone metering', () => {
	const fixture = createFixture();
	fixture.state.recorder = {};
	assert.equal(fixture.service.releaseInputs(), false);
	assert.equal(fixture.releaseAllCalls(), 0);
	assert.equal(fixture.meterInvalidations(), 0);

	fixture.state.recorder = null;
	fixture.state.microphoneMetering = true;
	assert.equal(fixture.service.releaseInputs(), 2);
	assert.equal(fixture.state.microphoneMetering, false);
	assert.equal(fixture.meterInvalidations(), 1);
	assert.deepEqual(fixture.stopMeterCalls, [{ releaseInput: false }]);
	assert.deepEqual(fixture.persistCalls, [['microphone-metering', false, undefined]]);
	assert.equal(fixture.releaseAllCalls(), 1);
	assert.equal(fixture.publishes(), 1);
});

test('routing persistence is required and storage failures remain actionable', async () => {
	const persistenceError = new Error('storage unavailable');
	const fixture = createFixture({
		persistSetting: async () => { throw persistenceError; },
	});

	await assert.rejects(
		fixture.service.setRecordingSourceLatency('device:interface', 25),
		(error) => error === persistenceError,
	);
	assert.equal(fixture.state.recordingRouting.offsets['device:interface'], 25);
	assert.equal(fixture.publishes(), 1);
	assert.deepEqual(fixture.persistCalls, [[
		'routing:project',
		fixture.state.recordingRouting,
		{ policy: 'required' },
	]]);

	const noProject = createFixture({ project: null });
	assert.deepEqual(await noProject.service.persistRecordingRouting(), { routes: {}, offsets: {} });
	assert.deepEqual(noProject.persistCalls, []);
});

test('retain-input preference defers active cleanup and releases idle inputs', async () => {
	const idle = createFixture();
	assert.equal(await idle.service.setRetainInputs(false), false);
	assert.equal(idle.state.preferences.recording.retainInputs, false);
	assert.equal(idle.releaseAllCalls(), 1);
	assert.equal(idle.state.recordingReleaseAfterStop, false);

	const active = createFixture();
	active.state.recorder = {};
	assert.equal(await active.service.setRetainInputs(false), false);
	assert.equal(active.releaseAllCalls(), 0);
	assert.equal(active.state.recordingReleaseAfterStop, true);
	assert.equal(await active.service.setRetainInputs(true), true);
	assert.equal(active.state.recordingReleaseAfterStop, false);
	assert.equal(active.releaseAllCalls(), 0);
});

test('unretained cleanup preserves the active meter input and force bypasses retention', () => {
	const metering = createFixture();
	metering.state.preferences.recording.retainInputs = false;
	metering.state.microphoneMetering = true;
	metering.setPoolSources([
		{ key: 'device:meter-device', kind: 'device', deviceId: 'meter-device', channelCount: 2 },
		{ key: 'device:other', kind: 'device', deviceId: 'other', channelCount: 2 },
		{ key: 'display', kind: 'display', channelCount: 2 },
	]);

	assert.equal(metering.service.releaseUnretainedRecordingInputs(), true);
	assert.deepEqual(metering.releasedHardware, ['other']);
	assert.equal(metering.releaseDisplayCalls(), 1);
	assert.equal(metering.releaseAllCalls(), 0);

	const retained = createFixture();
	assert.equal(retained.service.releaseUnretainedRecordingInputs(), false);
	assert.equal(retained.releaseAllCalls(), 0);
	assert.equal(retained.service.releaseUnretainedRecordingInputs({ force: true }), 2);
	assert.equal(retained.releaseAllCalls(), 1);
});

test('pool synchronization publishes sources before reconciling route health', () => {
	const fixture = createFixture();
	fixture.state.recordingRouting = {
		routes: {
			open: { kind: 'device', deviceId: 'interface', channelStart: 0, channelCount: 2 },
			wide: { kind: 'device', deviceId: 'interface', channelStart: 2, channelCount: 2 },
			missing: { kind: 'device', deviceId: 'missing', channelStart: 0, channelCount: 1 },
		},
		offsets: {},
	};
	fixture.state.recordingRouteHealth = { missing: 'disconnected' };
	fixture.setPoolSources([
		{ key: 'device:interface', kind: 'device', deviceId: 'interface', channelCount: 2 },
	]);

	fixture.service.syncRecordingPoolSnapshot();

	assert.deepEqual(fixture.state.recordingPoolSources, [
		{ key: 'device:interface', kind: 'device', deviceId: 'interface', channelCount: 2 },
	]);
	assert.deepEqual(fixture.state.recordingRouteHealth, {
		open: 'open',
		wide: 'skipped',
		missing: 'disconnected',
	});
	assert.equal(
		fixture.state.recordingDevices.some((device) => device.deviceId === 'interface'),
		true,
	);
});
