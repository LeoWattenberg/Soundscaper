/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const REQUEST = Object.freeze({
	operation: 'audio-encode', format: 'opus', input: Uint8Array.of(0, 0, 0, 0),
	sampleRate: 48_000, channelCount: 1, settings: Object.freeze({ bitrateKbps: 128 }),
	maximumOutputBytes: 4_096, requestId: `desktop-audio-${'a'.repeat(32)}`,
});
const RESULT = Object.freeze({
	operation: 'audio-encode', bytes: Uint8Array.of(1, 2, 3), requestId: REQUEST.requestId,
	metadata: Object.freeze({
		kind: 'encoded-audio', format: 'opus', mimeType: 'audio/ogg', fileExtension: '.opus',
		sampleRate: 48_000, channelCount: 1, frameCount: 1,
	}),
});

test('sandbox preload exposes the closed audio execute and cancel bridge', async () => {
	const calls = [];
	const bridge = await preloadBridge((channel, value) => {
		calls.push([channel, value]);
		return Promise.resolve(channel.endsWith(':cancel') ? true : RESULT);
	});
	const result = await bridge.v1.runDesktopAudioCodecOperation(REQUEST);
	assert.deepEqual({ ...result, bytes: [...result.bytes], metadata: { ...result.metadata } }, {
		...RESULT, bytes: [1, 2, 3], metadata: { ...RESULT.metadata },
	});
	assert.equal(Object.isFrozen(result), true);
	assert.notEqual(calls[0][1].input, REQUEST.input);
	assert.deepEqual(calls[0], ['soundscaper:v1:codecs:audio:execute', calls[0][1]]);
	assert.equal(await bridge.v1.cancelDesktopAudioCodecOperation(REQUEST.requestId), true);
	assert.deepEqual(calls[1], ['soundscaper:v1:codecs:audio:cancel', REQUEST.requestId]);
});

test('sandbox preload rejects renderer paths, argv, malformed results, and cross-request IDs', async () => {
	let invocations = 0;
	const bridge = await preloadBridge(() => { invocations += 1; return Promise.resolve(RESULT); });
	for (const request of [
		{ ...REQUEST, argv: ['-version'] },
		{ ...REQUEST, inputPath: '/renderer/input' },
		{ ...REQUEST, requestId: 'https://attacker.invalid/id' },
		{ ...REQUEST, channelCount: 9 },
	]) await assert.rejects(() => bridge.v1.runDesktopAudioCodecOperation(request), /desktop audio codec/iu);
	assert.equal(invocations, 0);

	for (const malformed of [
		{ ...RESULT, requestId: `desktop-audio-${'b'.repeat(32)}` },
		{ ...RESULT, path: '/main/output' },
		{ ...RESULT, metadata: { ...RESULT.metadata, fileExtension: '.exe' } },
		{ ...RESULT, bytes: new Uint8Array(4_097) },
	]) {
		const malicious = await preloadBridge(() => Promise.resolve(malformed));
		await assert.rejects(() => malicious.v1.runDesktopAudioCodecOperation(REQUEST), /desktop audio codec/iu);
	}
	await assert.rejects(() => bridge.v1.cancelDesktopAudioCodecOperation('../request'), /request ID/iu);
});

async function preloadBridge(invoke) {
	const exposed = new Map();
	const source = await readFile(new URL('../desktop/preload.mjs', import.meta.url), 'utf8');
	vm.runInNewContext(source, {
		AbortSignal, ArrayBuffer, Object, Promise, RangeError, String, TypeError, Uint8Array, URL,
		require: (specifier) => {
			assert.equal(specifier, 'electron');
			return {
				contextBridge: { exposeInMainWorld: (name, value) => { exposed.set(name, value); } },
				ipcRenderer: { invoke, send() {}, on() {}, removeListener() {} },
			};
		},
	});
	return exposed.get('soundscaperDesktop');
}
