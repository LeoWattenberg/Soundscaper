/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const SESSION_ID = 'audio_session_0001';
const exactOpen = (channelCount) => ({
	candidates: [{ backend: 'wasapi', deviceHandle: 'device-01' }],
	direction: 'duplex', mode: 'exclusive', sampleRate: 96_000,
	periodFrames: 256, channelCount,
});

test('native-audio preload admits the exact 32-channel and eight-packet route', async () => {
	const fixture = await loadPreload([
		{ status: 'opened', sessionId: SESSION_ID },
		{ status: 'bound', generation: 1 },
	]);
	await fixture.bridge.openNativeAudioSession(exactOpen(32));
	await fixture.bridge.bindNativeAudioSession({ sessionId: SESSION_ID, queueCapacity: 8 });
	assert.deepEqual(fixture.invocations.map(([channel, value]) => [channel, { ...value }]), [
		['soundscaper:v1:native-audio:session:open', {
			...exactOpen(32), candidates: fixture.invocations[0][1].candidates,
		}],
		['soundscaper:v1:native-audio:session:bind', {
			sessionId: SESSION_ID, queueCapacity: 8,
		}],
	]);
	assert.deepEqual({ ...fixture.invocations[0][1].candidates[0] }, exactOpen(32).candidates[0]);
});

test('native-audio preload refuses channel 33 and any non-selected queue capacity before IPC', async () => {
	const fixture = await loadPreload([]);
	assert.throws(() => fixture.bridge.openNativeAudioSession(exactOpen(33)), /channel count/u);
	for (const queueCapacity of [7, 9]) {
		assert.throws(
			() => fixture.bridge.bindNativeAudioSession({ sessionId: SESSION_ID, queueCapacity }),
			/queue capacity/u,
		);
	}
	assert.deepEqual(fixture.invocations, []);
});

test('native-audio transfer and terminal-loss reports retain only their closed scalar contracts', async () => {
	const fixture = await loadPreload([{ state: 'bound' }, { continuity: 'stop-monitoring' }]);
	await fixture.bridge.reportNativeAudioSessionTransfer({
		sessionId: SESSION_ID, framesTransferred: 2_048, lostFrames: 4,
	});
	await fixture.bridge.reportNativeAudioSessionLoss({ sessionId: SESSION_ID, reason: 'device-loss' });
	assert.deepEqual(fixture.invocations.map(([channel, value]) => [channel, { ...value }]), [
		['soundscaper:v1:native-audio:session:report', {
			sessionId: SESSION_ID, framesTransferred: 2_048, lostFrames: 4,
		}],
		['soundscaper:v1:native-audio:session:loss', {
			sessionId: SESSION_ID, reason: 'device-loss',
		}],
	]);
	assert.throws(() => fixture.bridge.reportNativeAudioSessionLoss({
		sessionId: SESSION_ID, reason: 'unknown',
	}), /loss reason/u);
});

async function loadPreload(invocationResults) {
	let bridge;
	const invocations = [];
	const source = await readFile(new URL('../desktop/preload.mjs', import.meta.url), 'utf8');
	vm.runInNewContext(source, {
		AggregateError, ArrayBuffer, Array, JSON, Number, Object, Promise, RangeError, String, TypeError,
		Uint8Array, URL,
		require: () => ({
			contextBridge: {
				exposeInMainWorld(name, value) { if (name === 'scapeDesktop') bridge = value.v1; },
			},
			ipcRenderer: {
				invoke(channel, value) {
					invocations.push([channel, value]);
					return Promise.resolve(invocationResults.shift());
				},
				send() {}, on() {}, removeListener() {},
			},
		}),
	});
	return { bridge, invocations };
}
