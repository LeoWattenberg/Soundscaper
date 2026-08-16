/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { HelperSupervisionError, type HelperJobRequest } from '../desktop/helper-supervisor.ts';
import type { NativeAddonAvailability } from '../desktop/native-addon-payload.ts';
import {
	DesktopNativeAudioService,
	NATIVE_AUDIO_INVENTORY_HANDLE,
	type NativeAudioInventoryOutcome,
	PUBLISHABLE_NATIVE_AUDIO_BACKENDS,
} from '../desktop/native-helper-service.ts';

const AVAILABLE_PAYLOAD: NativeAddonAvailability = Object.freeze({
	status: 'available',
	descriptor: Object.freeze({
		target: 'linux-x64',
		path: '/verified/soundscaper_helper.node',
		byteLength: 1,
		sha256: 'a'.repeat(64),
		addonVersion: '1.0.0',
		napiVersion: 8,
		toolchainIdentity: 'cc (test) 1.0',
	}),
});

const ALSA_INVENTORY = Object.freeze({
	backend: 'alsa',
	status: 'available',
	detail: '',
	devices: [{ handle: 'hw:0,0', label: 'Built-in', direction: 'duplex' }],
});

function failed(outcome: NativeAudioInventoryOutcome): Readonly<{ code: string; message: string }> {
	assert.equal(outcome.status, 'failed');
	if (outcome.status !== 'failed') throw new Error('unreachable');
	return outcome;
}

interface Harness {
	readonly service: DesktopNativeAudioService;
	readonly requests: HelperJobRequest<'audio-device'>[];
	readonly disposals: number[];
}

function createService({
	enabled = true,
	quarantined = false,
	payload = AVAILABLE_PAYLOAD,
	run = async () => ALSA_INVENTORY as unknown,
}: Partial<{
	enabled: boolean;
	quarantined: boolean;
	payload: NativeAddonAvailability;
	run: (request: HelperJobRequest<'audio-device'>) => Promise<unknown>;
}> = {}): Harness {
	const requests: HelperJobRequest<'audio-device'>[] = [];
	const disposals: number[] = [];
	const service = new DesktopNativeAudioService({
		supervisor: {
			runJob: async (request) => {
				requests.push(request);
				const result = await run(request);
				return request.validateResult ? request.validateResult(result) : result;
			},
			snapshot: () => Object.freeze({ state: 'ready', quarantined }),
			clearQuarantine: () => disposals.push(-1),
			dispose: () => disposals.push(1),
		},
		isEnabled: () => enabled,
		describePayload: async () => payload,
	});
	return { service, requests, disposals };
}

test('the synthetic loopback backend is never published or accepted', async () => {
	assert.equal(PUBLISHABLE_NATIVE_AUDIO_BACKENDS.includes('synthetic' as never), false);
	assert.deepEqual([...PUBLISHABLE_NATIVE_AUDIO_BACKENDS], ['coreaudio', 'wasapi', 'asio', 'jack', 'alsa', 'pipewire']);
	const { service, requests } = createService();
	assert.equal(failed(await service.describeBackend({ owner: {}, backend: 'synthetic' })).code, 'unknown-backend');
	assert.equal(requests.length, 0, 'a refused backend must never reach the helper');
});

test('availability reports the payload reason without naming a path or library', async () => {
	const { service } = createService({
		payload: Object.freeze({
			status: 'unavailable',
			reason: 'payload-pending-external',
			detail: 'No Windows ARM64 build host is provisioned.',
		}),
	});
	const availability = await service.availability();
	assert.equal(availability.enabled, true);
	assert.equal(availability.payload.status, 'unavailable');
	assert.equal(availability.payload.reason, 'payload-pending-external');
	assert.deepEqual(availability.backends, PUBLISHABLE_NATIVE_AUDIO_BACKENDS);
});

test('a disabled, quarantined or unbuilt surface degrades with a typed status', async () => {
	const disabled = createService({ enabled: false });
	assert.equal(failed(await disabled.service.describeBackend({ owner: {}, backend: 'alsa' })).code, 'helper-disabled');
	assert.equal(disabled.requests.length, 0);

	const quarantined = createService({ quarantined: true });
	assert.equal(failed(await quarantined.service.describeBackend({ owner: {}, backend: 'alsa' })).code, 'helper-quarantined');
	assert.equal(quarantined.requests.length, 0);

	const unbuilt = createService({
		payload: Object.freeze({ status: 'unavailable', reason: 'payload-pending-external', detail: 'No build host.' }),
	});
	const outcome = failed(await unbuilt.service.describeBackend({ owner: {}, backend: 'alsa' }));
	assert.equal(outcome.code, 'helper-unavailable');
	assert.equal(outcome.message, 'No build host.');
	assert.equal(unbuilt.requests.length, 0, 'an unverifiable payload must never be spawned');
});

test('an admitted backend is asked for its inventory through the reserved handle', async () => {
	const { service, requests } = createService();
	const outcome = await service.describeBackend({ owner: {}, backend: 'alsa' });
	assert.equal(outcome.status, 'described');
	assert.equal(outcome.inventory.backend, 'alsa');
	assert.deepEqual(outcome.inventory.devices.map(({ handle }) => handle), ['hw:0,0']);
	assert.equal(requests.length, 1);
	assert.deepEqual(requests[0].grant, {
		backend: 'alsa',
		deviceHandle: NATIVE_AUDIO_INVENTORY_HANDLE,
		direction: 'duplex',
		mode: 'shared',
	});
	assert.equal(requests[0].kind, 'audio-device');
});

test('a helper answer that fails admission is a failure, never a passed-through result', async () => {
	const { service } = createService({
		run: async () => ({ backend: 'alsa', status: 'available', detail: '', devices: [{ handle: '', label: '', direction: 'sideways' }] }),
	});
	assert.equal(failed(await service.describeBackend({ owner: {}, backend: 'alsa' })).code, 'helper-failed');
});

test('supervision faults map to the status the surface shows', async () => {
	for (const [cause, code] of [
		['cancelled', 'helper-cancelled'],
		['quarantined', 'helper-quarantined'],
		['disposed', 'helper-disabled'],
		['binary-mismatch', 'helper-unavailable'],
		['helper-exit', 'helper-failed'],
	] as const) {
		const { service } = createService({
			run: () => Promise.reject(new HelperSupervisionError(cause, `simulated ${cause}`)),
		});
		assert.equal(failed(await service.describeBackend({ owner: {}, backend: 'alsa' })).code, code,
			`${cause} must surface as ${code}`);
	}
});

function settleOnAbort(request: HelperJobRequest<'audio-device'>): Promise<unknown> {
	return new Promise((resolve) => {
		request.signal?.addEventListener('abort', () => resolve(ALSA_INVENTORY), { once: true });
	});
}

async function nextTick(): Promise<void> {
	await new Promise((resolve) => { setTimeout(resolve, 0); });
}

test('a renderer that asks twice aborts its own older request', async () => {
	const owner = {};
	const signals: AbortSignal[] = [];
	const { service } = createService({
		run: (request) => {
			signals.push(request.signal as AbortSignal);
			return settleOnAbort(request);
		},
	});
	const first = service.describeBackend({ owner, backend: 'alsa' });
	await nextTick();
	service.revokeOwner(owner);
	await first;
	assert.equal(signals.length, 1);
	assert.equal(signals[0].aborted, true);
});

test('an owner revoked while its payload is still being verified never reaches the helper', async () => {
	const owner = {};
	let releasePayload: (value: NativeAddonAvailability) => void = () => undefined;
	const { service, requests } = createService({
		payload: AVAILABLE_PAYLOAD,
		run: settleOnAbort,
	});
	const slow = new DesktopNativeAudioService({
		supervisor: {
			runJob: async (request) => {
				requests.push(request);
				return settleOnAbort(request);
			},
			snapshot: () => Object.freeze({ state: 'ready', quarantined: false }),
			clearQuarantine: () => undefined,
			dispose: () => undefined,
		},
		isEnabled: () => true,
		describePayload: () => new Promise((resolve) => { releasePayload = resolve; }),
	});
	void service;
	const pending = slow.describeBackend({ owner, backend: 'alsa' });
	await nextTick();
	slow.revokeOwner(owner);
	releasePayload(AVAILABLE_PAYLOAD);
	assert.equal(failed(await pending).code, 'helper-cancelled');
	assert.equal(requests.length, 0, 'a revoked owner must never spawn a helper job');
});

test('disposal aborts every outstanding request and disposes the supervisor exactly once', async () => {
	const { service, disposals } = createService({ run: settleOnAbort });
	const pending = service.describeBackend({ owner: {}, backend: 'alsa' });
	await nextTick();
	service.dispose();
	service.dispose();
	await pending;
	assert.deepEqual(disposals, [1]);
	assert.equal(failed(await service.describeBackend({ owner: {}, backend: 'alsa' })).code, 'helper-disabled');
});
