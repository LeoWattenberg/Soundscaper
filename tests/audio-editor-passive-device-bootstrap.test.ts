/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { startController } from '../src/common/editor/controller/composition/controller-startup.ts';
import { createProjectBootstrapService } from '../src/common/editor/controller/document/internal/project/project-bootstrap-service.ts';
import type { EditorControllerPhase } from '../src/common/editor/controller/shared/lifecycle.ts';
import type { RecordingRoutingMediaDevice } from '../src/common/editor/controller/recording/internal/recording-routing-service-types.d.ts';
import { deferred, settle } from './helpers/async-test-control.ts';
import { createFixture as createBootstrapFixture } from './helpers/audio-editor-project-bootstrap-fixture.ts';
import { createFixture as createRoutingFixture } from './helpers/recording-routing-service-fixture.ts';

function fixture() {
	const bootstrap = createBootstrapFixture();
	const devices = deferred<readonly RecordingRoutingMediaDevice[]>();
	const requested = deferred<void>();
	const routing = createRoutingFixture({ lifetime: bootstrap.lifetime,
		enumerateDevices: () => { requested.resolve(); return devices.promise; } });
	let discovery: ReturnType<typeof routing.service.refreshAudioDevices> | null = null;
	const service = createProjectBootstrapService({
		...bootstrap.runtime,
		refreshAudioDevices: options => {
			discovery = routing.service.refreshAudioDevices(options);
			return discovery;
		},
	});
	const state: { phase: EditorControllerPhase; microphoneMetering: boolean } = {
		phase: 'booting', microphoneMetering: false,
	};
	const ready = startController({
		lifetime: bootstrap.lifetime, state, bootstrap: token => service.bootstrap(token),
		initializeCapture: () => undefined, getSnapshot: () => ({ phase: state.phase }),
		publish: () => undefined, startMicrophoneMeter: async () => undefined,
		handleError: error => bootstrap.errors.push(error),
	});
	return { bootstrap, routing, ready, devices, requested: requested.promise, discovery: () => {
		assert.ok(discovery, 'startup must request passive device discovery');
		return discovery;
	} };
}

test('passive device inventory does not block project readiness and publishes its later result', async () => {
	const f = fixture();
	let phase: EditorControllerPhase | null = null;
	const observed = f.ready.then(snapshot => { phase = snapshot.phase; });
	await f.requested;
	await settle();
	try {
		assert.equal(phase, 'ready');
		assert.ok(f.bootstrap.events.includes('new-project'));
		assert.equal(f.routing.publishes(), 0, 'an unresolved discovery must not publish an invented inventory');
	} finally {
		f.devices.resolve([{ kind: 'audioinput', deviceId: 'usb', label: 'USB microphone' }]);
		await observed;
		await f.discovery();
	}
	assert.deepEqual(f.routing.state.audioInputDevices.map(device => device.deviceId), ['usb']);
	assert.equal(f.routing.publishes(), 1, 'a late initial inventory must publish after readiness');
	assert.deepEqual(f.routing.hardwareRequests, [], 'passive discovery must not request microphone access');
});

test('a rejected passive inventory leaves the opened project ready and reports the discovery failure', async () => {
	const f = fixture();
	const failure = new DOMException('The device service is unavailable.', 'NotReadableError');
	await f.requested;
	const rejection = assert.rejects(f.discovery(), error => error === failure);
	f.devices.reject(failure);
	await rejection;
	assert.deepEqual(await f.ready, { phase: 'ready' });
	await settle();
	assert.ok(f.bootstrap.events.includes('new-project'));
	assert.deepEqual(f.bootstrap.errors, [failure]);
	assert.equal(f.routing.publishes(), 0);
});

test('disposing a ready project cancels its pending discovery without a late error or publication', async () => {
	const f = fixture();
	await f.requested;
	assert.deepEqual(await f.ready, { phase: 'ready' });
	const rejection = assert.rejects(f.discovery(), { code: 'DISPOSED' });
	f.bootstrap.lifetime.beginDisposal();
	await rejection;
	f.devices.resolve([{ kind: 'audioinput', deviceId: 'late', label: 'Late microphone' }]);
	await settle();
	assert.deepEqual(f.bootstrap.errors, []);
	assert.deepEqual(f.routing.state.audioInputDevices, []);
	assert.equal(f.routing.publishes(), 0);
});
