/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const ANALYZER_ID = 'va' + '1'.repeat(30);
const INSTALLATION_ID = 'vi' + '2'.repeat(30);
const DIGEST = 'a'.repeat(64);
const SESSION_ID = 'vamp_session_1';

test('Vamp preload exposes a pathless catalog and exact finite-session requests', async () => {
	const catalog = [{
		analyzerId: ANALYZER_ID, stableId: INSTALLATION_ID, binarySha256: DIGEST,
		name: 'Onsets', maker: 'Example', programs: [], parameters: [], outputs: [{ id: 'onsets',
			name: 'Onsets', description: '', unit: '', sampleType: 'variable-sample-rate', sampleRate: null,
			hasDuration: false }], configuration: { inputDomain: 'time', minimumChannels: 1,
		maximumChannels: 2, preferredStepSize: 512, preferredBlockSize: 1024 },
	}];
	const fixture = await loadPreload([
		catalog,
		sessionProjection('created', 0, null),
		sessionProjection('configured', 0, 4),
		{ session: sessionProjection('configured', 4, 4), features: [] },
		{ session: sessionProjection('finished', 4, 4), features: [] },
		true,
	]);
	assert.deepEqual(JSON.parse(JSON.stringify(await fixture.bridge.listNativeVampAnalyzers())), catalog);
	await fixture.bridge.startNativeVampAnalyzer({
		analyzerId: ANALYZER_ID, stableId: INSTALLATION_ID, binarySha256: DIGEST, sessionId: null,
	});
	await fixture.bridge.configureNativeVampAnalyzer({
		sessionId: SESSION_ID, sampleRate: 48_000, channelCount: 1, stepSize: 512,
		blockSize: 1_024, frameCount: 4, parameters: { threshold: 0.5 }, program: null,
	});
	const inputChannel = Float32Array.of(0, 0.5, -0.5, 0);
	await fixture.bridge.pushNativeVampAnalyzerPcm({
		sessionId: SESSION_ID, startFrame: 0, channels: [inputChannel],
	});
	await fixture.bridge.finishNativeVampAnalyzer({ sessionId: SESSION_ID });
	await fixture.bridge.cancelNativeVampAnalyzer({ sessionId: SESSION_ID, reason: 'renderer-aborted' });
	assert.deepEqual(fixture.invocations.map(([channel]) => channel), [
		'soundscaper:v1:native-vamp:inventory', 'soundscaper:v1:native-vamp:session:start',
		'soundscaper:v1:native-vamp:session:configure', 'soundscaper:v1:native-vamp:session:push',
		'soundscaper:v1:native-vamp:session:finish', 'soundscaper:v1:native-vamp:session:cancel',
	]);
	const pushed = fixture.invocations[3][1];
	assert.equal(pushed.channels[0] instanceof Float32Array, true);
	assert.notEqual(pushed.channels[0], inputChannel);
});

test('Vamp preload rejects path leaks, oversized PCM, and malformed identities before IPC', async () => {
	const leaked = [{
		analyzerId: ANALYZER_ID, stableId: INSTALLATION_ID, binarySha256: DIGEST,
		name: 'Onsets', maker: 'Example', programs: [], parameters: [], outputs: [],
		configuration: { inputDomain: 'time', minimumChannels: 1, maximumChannels: 1,
			preferredStepSize: 0, preferredBlockSize: 0 }, libraryPath: '/secret/onsets.so',
	}];
	const fixture = await loadPreload([leaked]);
	await assert.rejects(() => fixture.bridge.listNativeVampAnalyzers(), /invalid.*catalog/iu);
	assert.throws(() => fixture.bridge.startNativeVampAnalyzer({
		analyzerId: 'bad', stableId: INSTALLATION_ID, binarySha256: DIGEST, sessionId: null,
	}), /analyzer id/iu);
	assert.throws(() => fixture.bridge.pushNativeVampAnalyzerPcm({
		sessionId: SESSION_ID, startFrame: 0, channels: [new Float32Array(65_537)],
	}), /PCM/iu);
	assert.equal(fixture.invocations.length, 1);
});

async function loadPreload(invocationResults) {
	let bridge;
	const invocations = [];
	const source = await readFile(new URL('../desktop/preload.mjs', import.meta.url), 'utf8');
	vm.runInNewContext(source, {
		AggregateError, ArrayBuffer, Array, BigInt, Float32Array, JSON, Map, Number, Object, Promise,
		RangeError, Set, String, TypeError, Uint8Array, URL,
		require: () => ({
			contextBridge: { exposeInMainWorld(name, value) { if (name === 'scapeDesktop') bridge = value.v1; } },
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

function sessionProjection(state, processedFrames, totalFrames) {
	return {
		kind: 'analyzer-session', format: 'vamp', sessionId: SESSION_ID,
		analyzerId: ANALYZER_ID, installationId: INSTALLATION_ID, binarySha256: DIGEST,
		state, processedFrames, totalFrames, outputs: [],
	};
}
