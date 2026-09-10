/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { adaptNativeAudioInventory } from '../src/common/editor/controller/recording/native-audio-inventory.ts';
import type { RecordingInputRoute } from '../src/common/editor/controller/recording/internal/recording-input-coordination-service.ts';
import { createFixture, type OutputDeviceResult } from './helpers/recording-routing-service-fixture.ts';

test('input channel preferences do not route a missing selected track', async () => {
	const fixture = createFixture();
	fixture.state.selectedTrackId = null;

	assert.equal(await fixture.service.setPreferredInputChannelCount(2), 2);
	assert.deepEqual(fixture.assignedTrackIds, []);
});

test('input selection moves the matching active route and persists it without opening a display chooser', async () => {
	const fixture = createFixture();
	fixture.state.recordingRouting = {
		routes: { track: { kind: 'device', deviceId: 'default', channelStart: 0, channelCount: 1 } },
		offsets: {},
	};
	await fixture.service.setPreferredInputDevice('display');
	assert.equal(fixture.state.recordingRouting.routes.track.kind, 'display');
	assert.deepEqual(fixture.hardwareRequests, []);
	assert.ok(fixture.persistCalls.some(([key, value]) => key === 'routing:project'
		&& value === fixture.state.recordingRouting));
	await fixture.service.setPreferredInputDevice('default');
	assert.equal(fixture.state.recordingRouting.routes.track.kind, 'device');
	assert.deepEqual(fixture.hardwareRequests, ['default']);
});

test('input selection preserves other device routes and routes in an active recording', async () => {
	for (const recording of [false, true]) {
		const fixture = createFixture();
		const route: RecordingInputRoute = {
			kind: 'device', deviceId: recording ? 'default' : 'usb-mic', channelStart: 0, channelCount: 1,
		};
		fixture.state.recordingRouting = { routes: { track: route }, offsets: {} };
		fixture.state.recorder = recording ? {} : null;
		await fixture.service.setPreferredInputDevice('display');
		assert.equal(fixture.state.recordingRouting.routes.track, route);
	}
});

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

test('native inventory joins Web devices through the routing action without probing or Web sink substitution', async () => {
	const sinkCalls: string[] = [];
	const fixture = createFixture({
		enumerateDevices: async () => [
			{ kind: 'audioinput', deviceId: 'web-mic', label: 'Web mic', groupId: 'web' },
			{ kind: 'audiooutput', deviceId: 'web-speaker', label: 'Web speaker', groupId: 'web' },
		],
		setOutputDevice: async (deviceId) => { sinkCalls.push(deviceId); return { activeDeviceId: deviceId }; },
	});
	const nativeInventory = adaptNativeAudioInventory({
		backend: 'wasapi', status: 'available', detail: '', devices: [{
			handle: 'studio-interface', label: 'Studio interface', direction: 'duplex',
			channelCount: 32, isDefault: true,
		}],
	});
	fixture.state.preferredOutputDeviceId = 'native:wasapi:out:studio-interface';
	await fixture.service.refreshAudioDevices({ probe: false, nativeInventory });
	assert.deepEqual(fixture.state.recordingDevices.map((device) => device.deviceId), [
		'web-mic', 'native:wasapi:in:studio-interface',
	]);
	assert.deepEqual(fixture.state.audioOutputDevices.map((device) => device.deviceId), [
		'web-speaker', 'native:wasapi:out:studio-interface',
	]);
	const nativeInput = fixture.state.recordingDevices[1];
	assert.deepEqual({
		groupId: nativeInput.groupId, channelCount: nativeInput.channelCount,
		channels: (nativeInput.channels || []).length, status: nativeInput.status,
	}, { groupId: 'native:wasapi:studio-interface', channelCount: 32, channels: 32, status: 'available' });
	assert.deepEqual(fixture.hardwareRequests, [], 'describing inventory must not open either Web or native capture');
	assert.deepEqual(sinkCalls, [], 'a native preference is not passed to the browser setSinkId route');
	assert.equal(fixture.state.audioOutputStatus, 'available');
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

test('an older audio output completion cannot overwrite a newer persisted selection', async () => {
	const speakerA = deferred<OutputDeviceResult>();
	const speakerB = deferred<OutputDeviceResult>();
	const fixture = createFixture({
		setOutputDevice: (deviceId) => deviceId === 'speaker-a' ? speakerA.promise : speakerB.promise,
	});
	fixture.state.audioOutputDevices = [
		{ deviceId: 'speaker-a' },
		{ deviceId: 'speaker-b' },
	];

	const olderSelection = fixture.service.setAudioOutputDevice('speaker-a');
	const newerSelection = fixture.service.setAudioOutputDevice('speaker-b');
	speakerB.resolve({ activeDeviceId: 'speaker-b' });
	assert.equal(await newerSelection, 'speaker-b');
	speakerA.resolve({ activeDeviceId: 'speaker-a' });
	assert.equal(await olderSelection, 'speaker-a');

	assert.equal(fixture.state.preferredOutputDeviceId, 'speaker-b');
	assert.equal(fixture.state.activeOutputDeviceId, 'speaker-b');
	assert.equal(fixture.state.audioOutputStatus, 'active');
	assert.deepEqual(fixture.persistCalls, [[
		'audio-devices',
		{ inputDeviceId: 'default', inputChannelCount: 1, outputDeviceId: 'speaker-b' },
		undefined,
	]]);
	assert.equal(fixture.publishes(), 1);
});

test('a stale audio output failure still rejects without replacing the newer success', async () => {
	const speakerA = deferred<OutputDeviceResult>();
	const speakerB = deferred<OutputDeviceResult>();
	const fixture = createFixture({
		setOutputDevice: (deviceId) => deviceId === 'speaker-a' ? speakerA.promise : speakerB.promise,
	});
	fixture.state.audioOutputDevices = [
		{ deviceId: 'speaker-a' },
		{ deviceId: 'speaker-b' },
	];

	const olderSelection = fixture.service.setAudioOutputDevice('speaker-a');
	const newerSelection = fixture.service.setAudioOutputDevice('speaker-b');
	speakerB.resolve({ activeDeviceId: 'speaker-b' });
	await newerSelection;
	const staleError = Object.assign(new Error('Speaker A access was revoked.'), { name: 'NotAllowedError' });
	speakerA.reject(staleError);

	await assert.rejects(olderSelection, (error) => error === staleError);
	assert.equal(fixture.state.preferredOutputDeviceId, 'speaker-b');
	assert.equal(fixture.state.activeOutputDeviceId, 'speaker-b');
	assert.equal(fixture.state.audioOutputStatus, 'active');
	assert.equal(fixture.persistCalls.length, 1);
	assert.equal(fixture.publishes(), 1);
});

test('an older audio output success cannot erase the newer selection error', async () => {
	const speakerA = deferred<OutputDeviceResult>();
	const speakerB = deferred<OutputDeviceResult>();
	const fixture = createFixture({
		setOutputDevice: (deviceId) => deviceId === 'speaker-a' ? speakerA.promise : speakerB.promise,
	});
	fixture.state.audioOutputDevices = [
		{ deviceId: 'speaker-a' },
		{ deviceId: 'speaker-b' },
	];
	fixture.state.preferredOutputDeviceId = 'previous';
	fixture.state.activeOutputDeviceId = 'previous';

	const olderSelection = fixture.service.setAudioOutputDevice('speaker-a');
	const newerSelection = fixture.service.setAudioOutputDevice('speaker-b');
	const selectionError = Object.assign(new Error('Speaker B access was denied.'), { name: 'NotAllowedError' });
	speakerB.reject(selectionError);
	await assert.rejects(newerSelection, (error) => error === selectionError);
	speakerA.resolve({ activeDeviceId: 'speaker-a' });
	await olderSelection;

	assert.equal(fixture.state.preferredOutputDeviceId, 'previous');
	assert.equal(fixture.state.activeOutputDeviceId, 'previous');
	assert.equal(fixture.state.audioOutputStatus, 'denied');
	assert.deepEqual(fixture.persistCalls, []);
	assert.equal(fixture.publishes(), 1);
});

test('a manual output selection retires an older device reconciliation', async () => {
	const speakerA = deferred<OutputDeviceResult>();
	const speakerB = deferred<OutputDeviceResult>();
	const sinkCalls: string[] = [];
	const fixture = createFixture({
		setOutputDevice: (deviceId) => {
			sinkCalls.push(deviceId);
			if (deviceId === 'speaker-a') return speakerA.promise;
			if (deviceId === 'speaker-b') return speakerB.promise;
			return Promise.resolve({ activeDeviceId: '' });
		},
	});
	fixture.state.audioOutputDevices = [
		{ deviceId: 'speaker-a' },
		{ deviceId: 'speaker-b' },
	];
	fixture.state.preferredOutputDeviceId = 'speaker-a';
	fixture.state.activeOutputDeviceId = 'speaker-a';

	const reconciliation = fixture.service.reconcilePreferredOutputDevice();
	const selection = fixture.service.setAudioOutputDevice('speaker-b');
	speakerB.resolve({ activeDeviceId: 'speaker-b' });
	await selection;
	speakerA.reject(Object.assign(new Error('Speaker A disappeared.'), { name: 'NotAllowedError' }));
	await reconciliation;

	assert.deepEqual(sinkCalls, ['speaker-a', 'speaker-b']);
	assert.equal(fixture.state.preferredOutputDeviceId, 'speaker-b');
	assert.equal(fixture.state.activeOutputDeviceId, 'speaker-b');
	assert.equal(fixture.state.audioOutputStatus, 'active');
	assert.equal(fixture.persistCalls.length, 1);
	assert.equal(fixture.publishes(), 1);
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

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	return { promise, resolve, reject };
}
