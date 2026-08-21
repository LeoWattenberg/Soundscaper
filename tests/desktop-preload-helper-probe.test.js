/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const CAPABILITY_ID = 'ab'.repeat(32);
const PROBE_ID = 'cd'.repeat(20);

test('the helper probe bridge validates ids in both directions and copies binary out', async () => {
	const timingBytes = new Uint8Array(40).fill(7);
	const fixture = await loadPreload([
		{ probeId: PROBE_ID },
		{
			status: 'probed',
			timingAsset: timingBytes,
			nominalRate: { num: 30_000, den: 1_001 },
			characteristics: { backend: 'ffmpeg', extra: true },
		},
		{ cancelled: true },
	]);

	const begun = await fixture.bridge.beginVideoSourceProbe({ capabilityId: CAPABILITY_ID });
	assert.equal(fixture.invocations[0][0], 'soundscaper:v1:helper:probe-begin');
	assert.deepEqual({ ...fixture.invocations[0][1] }, { capabilityId: CAPABILITY_ID });
	assert.deepEqual({ ...begun }, { probeId: PROBE_ID });

	const completion = await fixture.bridge.awaitVideoSourceProbe({ probeId: PROBE_ID });
	assert.equal(completion.status, 'probed');
	assert.deepEqual({ ...completion.nominalRate }, { num: 30_000, den: 1_001 });
	assert.equal(completion.timingAsset.byteLength, 40);
	timingBytes.fill(0);
	assert.equal(completion.timingAsset[0], 7, 'the timing asset is copied, never shared');
	assert.equal(Object.isFrozen(completion), true);

	const cancelled = await fixture.bridge.cancelVideoSourceProbe({ probeId: PROBE_ID });
	assert.deepEqual({ ...cancelled }, { cancelled: true });
});

test('the helper probe bridge refuses malformed ids before anything reaches main', async () => {
	const fixture = await loadPreload([]);
	for (const capabilityId of ['', 'short', CAPABILITY_ID.toUpperCase(), `${CAPABILITY_ID}00`, null]) {
		assert.throws(() => fixture.bridge.beginVideoSourceProbe({ capabilityId }), /Invalid opaque identifier/u);
	}
	for (const probeId of ['', CAPABILITY_ID, 'zz'.repeat(20), 42]) {
		assert.throws(() => fixture.bridge.awaitVideoSourceProbe({ probeId }), /Invalid opaque identifier/u);
		assert.throws(() => fixture.bridge.cancelVideoSourceProbe({ probeId }), /Invalid opaque identifier/u);
	}
	assert.deepEqual(fixture.invocations, [], 'nothing reached the main process');
});

test('the helper probe bridge refuses malformed completions from main', async () => {
	const oversized = await loadPreload([{
		status: 'probed',
		timingAsset: new Uint8Array(16_000_064),
		nominalRate: { num: 30, den: 1 },
		characteristics: null,
	}]);
	await assert.rejects(
		oversized.bridge.awaitVideoSourceProbe({ probeId: PROBE_ID }),
		/timing asset is out of range/u,
	);
	const badRate = await loadPreload([{
		status: 'probed',
		timingAsset: new Uint8Array(64),
		nominalRate: { num: 0, den: 1 },
		characteristics: null,
	}]);
	await assert.rejects(badRate.bridge.awaitVideoSourceProbe({ probeId: PROBE_ID }), /positive safe integer/u);
	const unknownStatus = await loadPreload([{ status: 'partial' }]);
	await assert.rejects(
		unknownStatus.bridge.awaitVideoSourceProbe({ probeId: PROBE_ID }),
		/unsupported helper probe completion/u,
	);
	const failed = await loadPreload([{ status: 'failed', code: 'helper-disabled', message: 'x'.repeat(5_000) }]);
	const completion = await failed.bridge.awaitVideoSourceProbe({ probeId: PROBE_ID });
	assert.equal(completion.code, 'helper-disabled');
	assert.equal(completion.message.length <= 2_048, true, 'failure messages are truncated');
});

test('the helper probe availability report is reduced to two booleans', async () => {
	const fixture = await loadPreload([{ enabled: 1, quarantined: 'yes', secret: true }]);
	const availability = await fixture.bridge.probeHelperAvailability();
	assert.deepEqual({ ...availability }, { enabled: false, quarantined: false });
	assert.equal('secret' in availability, false);
});

test('the native-audio setter validates its acknowledgement with its own contract error', async () => {
	const accepted = await loadPreload([true]);
	assert.equal(await accepted.bridge.setNativeAudioHelperEnabled(true), true);
	assert.deepEqual(accepted.invocations, [['soundscaper:v1:helper:native-audio-set-enabled', true]]);

	const malformed = await loadPreload([{ enabled: true }]);
	await assert.rejects(
		malformed.bridge.setNativeAudioHelperEnabled(true),
		(error) => {
			assert.match(error.message, /native-audio setting result must be a boolean/u);
			assert.doesNotMatch(error.message, /shared-project delete/u);
			return true;
		},
	);
});

test('the desktop host-control bridge closes and sanitizes its action and state contracts', async () => {
	const controls = {
		probeHelperEnabled: true,
		probeHelperQuarantined: false,
		audioHelperEnabled: false,
		audioHelperQuarantined: true,
		nativeEffectDiscoveryEnabled: true,
		secret: '/tmp/helper',
	};
	const fixture = await loadPreload([controls, controls, true]);
	const read = await fixture.bridge.readNativeTierControls();
	assert.deepEqual({ ...read }, {
		probeHelperEnabled: true,
		probeHelperQuarantined: false,
		audioHelperEnabled: false,
		audioHelperQuarantined: true,
		nativeEffectDiscoveryEnabled: true,
	});
	assert.equal(Object.isFrozen(read), true);
	const applied = await fixture.bridge.applyNativeTierControl({
		action: 'set-audio-helper-enabled', enabled: true,
	});
	assert.equal(applied.audioHelperQuarantined, true);
	assert.deepEqual(fixture.invocations.map(([channel, value]) => [channel, value && { ...value }]), [
		['soundscaper:v1:native-tier:controls', undefined],
		['soundscaper:v1:native-tier:apply', { action: 'set-audio-helper-enabled', enabled: true }],
	]);
	assert.throws(
		() => fixture.bridge.applyNativeTierControl({ action: 'set-audio-helper-enabled', enabled: 'yes' }),
		/boolean/u,
	);
	assert.throws(
		() => fixture.bridge.applyNativeTierControl({ action: 'launch-helper', enabled: true }),
		/Unsupported native-tier control action/u,
	);

	assert.equal(await fixture.bridge.runWindowAction('minimize'), true);
	assert.deepEqual(fixture.invocations.at(-1), ['soundscaper:v1:window:action', 'minimize']);
	assert.throws(() => fixture.bridge.runWindowAction('close'), /Unsupported window action/u);
	let state;
	const unsubscribe = fixture.bridge.onWindowStateChanged((value) => { state = value; });
	fixture.listeners.get('soundscaper:v1:event:window-state-changed')?.({}, {
		maximized: 1, fullscreen: true, secret: true,
	});
	assert.deepEqual({ ...state }, { maximized: false, fullscreen: true });
	assert.equal(Object.isFrozen(state), true);
	unsubscribe();
	assert.equal(fixture.listeners.has('soundscaper:v1:event:window-state-changed'), false);
});

async function loadPreload(invocationResults) {
	let bridge;
	const invocations = [];
	const sent = [];
	const listeners = new Map();
	const source = await readFile(new URL('../desktop/preload.mjs', import.meta.url), 'utf8');
	vm.runInNewContext(source, {
		AggregateError, ArrayBuffer, Array, JSON, Number, Object, Promise, RangeError, String, TypeError,
		Uint8Array, URL,
		require: () => ({
			contextBridge: { exposeInMainWorld(name, value) { if (name === 'scapeDesktop') bridge = value.v1; } },
			ipcRenderer: {
				invoke(channel, value) {
					invocations.push([channel, value]);
					const result = invocationResults.shift();
					return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
				},
				send: (channel, value) => { sent.push([channel, value]); },
				on: (channel, handler) => listeners.set(channel, handler),
				removeListener: (channel) => listeners.delete(channel),
			},
		}),
	});
	return { bridge, invocations, listeners, sent };
}
