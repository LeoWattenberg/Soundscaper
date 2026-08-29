/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { SoundscaperNativeServicesBridge } from '../src/common/editor/ui/soundscaper-native-services-bridge.ts';
import { createSoundscaperNativeServicesDialogRuntime } from '../src/common/editor/ui/soundscaper-native-services-dialog-runtime.ts';

test('native-service actions publish in request order when bridge responses overlap', async () => {
	const alsa = deferred<unknown>();
	const wasapi = deferred<unknown>();
	const calls: string[] = [];
	const bridge = {
		describeNativeAudioBackend: ({ backend }: Readonly<{ backend: string }>) => {
			calls.push(backend);
			return backend === 'alsa' ? alsa.promise : wasapi.promise;
		},
	} as unknown as SoundscaperNativeServicesBridge;
	const runtime = createSoundscaperNativeServicesDialogRuntime(bridge);

	const first = runtime.perform({ type: 'describe-devices', backend: 'alsa' });
	const second = runtime.perform({ type: 'describe-devices', backend: 'wasapi' });
	assert.deepEqual(calls, ['alsa'], 'the second bridge action must wait for the admitted first action');

	alsa.resolve(inventory('alsa'));
	await first;
	assert.deepEqual(calls, ['alsa', 'wasapi']);
	wasapi.resolve(inventory('wasapi'));
	await second;

	const devices = runtime.getState().devices;
	assert.equal(devices?.status, 'described');
	if (devices?.status === 'described') assert.equal(devices.inventory.backend, 'wasapi');
});

function inventory(backend: string) {
	return Object.freeze({
		status: 'described' as const,
		inventory: Object.freeze({
			backend, status: 'ready', detail: '', devices: Object.freeze([]),
		}),
	});
}

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
}
