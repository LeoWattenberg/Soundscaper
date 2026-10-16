/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { RecordingRoutingMediaDevice } from '../src/common/editor/controller/recording/internal/recording-routing-service-types.d.ts';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';
import { createFixture, type OutputDeviceResult } from './helpers/recording-routing-service-fixture.ts';

const microphone = (id: string): RecordingRoutingMediaDevice => ({ kind: 'audioinput', deviceId: id, label: id });

test('disposal cancels passive enumeration without late inventory, sink, or document publication', async () => {
	const devices = deferred<readonly RecordingRoutingMediaDevice[]>();
	const requested = deferred<void>();
	const sinks: string[] = [];
	const f = createFixture({
		enumerateDevices: () => { requested.resolve(); return devices.promise; },
		setOutputDevice: async id => { sinks.push(id); return { activeDeviceId: id }; },
	});
	const before = structuredClone(f.state);
	const discovery = f.service.refreshAudioDevices({ probe: false });
	const observed = discovery.then(() => null, (error: unknown) => error);
	await requested.promise;
	f.lifetime.beginDisposal();
	try {
		assert.equal(await remainsPending(observed), false, 'disposal must settle before the native read answers');
		assert.equal(await observed, f.lifetime.signal.reason);
	} finally {
		devices.resolve([microphone('late microphone')]);
	}
	await settle();
	assert.deepEqual(f.state, before);
	assert.deepEqual(sinks, []);
	assert.deepEqual(f.hardwareRequests, []);
	assert.equal(f.publishes(), 0);
});

test('a disposed controller never starts another native device enumeration', async () => {
	let enumerations = 0;
	const f = createFixture({ enumerateDevices: async () => { enumerations += 1; return []; } });
	f.lifetime.beginDisposal();
	await assert.rejects(f.service.refreshAudioDevices({ probe: true }), { code: 'DISPOSED' });
	assert.equal(enumerations, 0);
	assert.deepEqual(f.hardwareRequests, []);
	assert.equal(f.publishes(), 0);
});

test('the latest inventory wins when an earlier enumeration finishes afterward', async () => {
	const older = deferred<readonly RecordingRoutingMediaDevice[]>();
	const newer = deferred<readonly RecordingRoutingMediaDevice[]>();
	let request = 0;
	const f = createFixture({ enumerateDevices: () => ++request === 1 ? older.promise : newer.promise });
	const first = f.service.refreshAudioDevices({ probe: false });
	const second = f.service.refreshAudioDevices({ probe: false });
	newer.resolve([microphone('new microphone')]);
	await second;
	older.resolve([microphone('old microphone')]);
	await first;
	assert.deepEqual(f.state.audioInputDevices.map(device => device.deviceId), ['new microphone']);
	assert.deepEqual([...f.state.recordingEnumeratedDeviceIds], ['new microphone']);
	assert.equal(f.publishes(), 1, 'an obsolete enumeration must not republish its result');
});

test('a superseded output reconciliation cannot overwrite the latest inventory state', async () => {
	const speaker = deferred<OutputDeviceResult>();
	const sinkRequested = deferred<void>();
	const devices = [[{ kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' }], []];
	const sinks: string[] = [];
	let inventory = 0;
	const f = createFixture({
		enumerateDevices: async () => devices[inventory++]!,
		setOutputDevice: async id => {
			sinks.push(id);
			if (id === 'speaker') { sinkRequested.resolve(); return speaker.promise; }
			return { activeDeviceId: id };
		},
	});
	f.state.preferredOutputDeviceId = 'speaker';
	const first = f.service.refreshAudioDevices({ probe: false });
	await sinkRequested.promise;
	const second = f.service.refreshAudioDevices({ probe: false });
	await second;
	speaker.resolve({ activeDeviceId: 'speaker' });
	await first;
	assert.equal(f.state.preferredOutputDeviceId, 'speaker');
	assert.equal(f.state.activeOutputDeviceId, '');
	assert.equal(f.state.audioOutputStatus, 'unavailable');
	assert.deepEqual(f.state.audioOutputDevices, []);
	assert.deepEqual(sinks, ['speaker', '']);
	assert.equal(f.publishes(), 1);
});

test('a newer passive inventory preserves an explicit probe and its unretained cleanup', async () => {
	const older = deferred<readonly RecordingRoutingMediaDevice[]>();
	let inventory = 0;
	const f = createFixture({ enumerateDevices: () => ++inventory === 1
		? older.promise : Promise.resolve([microphone('new microphone')]) });
	f.state.preferences.recording.retainInputs = false;
	const probe = f.service.refreshAudioDevices({ probe: true });
	await f.service.refreshAudioDevices({ probe: false });
	older.resolve([microphone('probed microphone')]);
	await probe;
	assert.deepEqual(f.hardwareRequests, ['probed microphone']);
	assert.equal(f.releaseAllCalls(), 1, 'the superseded inventory still releases unretained probe resources');
	assert.deepEqual([...f.state.recordingEnumeratedDeviceIds], ['new microphone']);
	assert.deepEqual(f.state.audioInputDevices.map(device => device.deviceId), ['new microphone']);
	assert.equal(f.publishes(), 1);
});
