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
const CAPABILITY_QUERY = Object.freeze({
	schemaVersion: 1,
	operations: Object.freeze([
		Object.freeze({ operation: 'audio-encode', format: 'opus', sampleRate: 48_000, channelCount: 1 }),
		Object.freeze({ operation: 'audio-decode', format: 'flac', sampleRate: 48_000, channelCount: 2 }),
	]),
});
const CAPABILITY_RESULT = Object.freeze({
	schemaVersion: 1,
	capabilities: Object.freeze([
		Object.freeze({ ...CAPABILITY_QUERY.operations[0], available: true, provider: 'external-ffmpeg', reason: null }),
		Object.freeze({ ...CAPABILITY_QUERY.operations[1], available: false, provider: null, reason: 'unsupported-by-configured-ffmpeg' }),
	]),
});

test('sandbox preload exposes a correlated pathless audio capability query', async () => {
	const calls = [];
	const bridge = await preloadBridge((channel, value) => {
		calls.push([channel, value]);
		return Promise.resolve(CAPABILITY_RESULT);
	});
	const result = await bridge.v1.getDesktopAudioCodecCapabilities(CAPABILITY_QUERY);
	assert.deepEqual(JSON.parse(JSON.stringify(result)), CAPABILITY_RESULT);
	assert.notEqual(calls[0][1], CAPABILITY_QUERY);
	assert.deepEqual(calls[0], ['soundscaper:v1:codecs:audio:capabilities', calls[0][1]]);
	for (const query of [
		{ ...CAPABILITY_QUERY, executablePath: '/renderer/ffmpeg' },
		{ ...CAPABILITY_QUERY, operations: [] },
		{ ...CAPABILITY_QUERY, operations: [CAPABILITY_QUERY.operations[0], CAPABILITY_QUERY.operations[0]] },
	]) await assert.rejects(() => bridge.v1.getDesktopAudioCodecCapabilities(query), /capability/iu);
	for (const malicious of [
		{ ...CAPABILITY_RESULT, executablePath: '/main/ffmpeg' },
		{ ...CAPABILITY_RESULT, capabilities: [{ ...CAPABILITY_RESULT.capabilities[0], format: 'mp3' }, CAPABILITY_RESULT.capabilities[1]] },
		{ ...CAPABILITY_RESULT, capabilities: [{ ...CAPABILITY_RESULT.capabilities[0], provider: 'renderer' }, CAPABILITY_RESULT.capabilities[1]] },
	]) {
		const unsafe = await preloadBridge(() => Promise.resolve(malicious));
		await assert.rejects(() => unsafe.v1.getDesktopAudioCodecCapabilities(CAPABILITY_QUERY), /capability/iu);
	}
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

test('sandbox preload preserves main-reported decoded source geometry', async () => {
	const request = Object.freeze({
		operation: 'audio-decode', format: 'flac', input: Uint8Array.of(1, 2, 3),
		sampleRate: null, channelCount: null, settings: Object.freeze({ sampleFormat: 'f32le' }),
		maximumOutputBytes: 64, requestId: `desktop-audio-${'c'.repeat(32)}`,
	});
	const result = Object.freeze({
		operation: 'audio-decode', bytes: new Uint8Array(8), requestId: request.requestId,
		metadata: Object.freeze({
			kind: 'decoded-audio', sourceFormat: 'flac', sampleFormat: 'f32le',
			interleaving: 'interleaved', sampleRate: 44_100, channelCount: 1, frameCount: 2,
		}),
	});
	const bridge = await preloadBridge(() => Promise.resolve(result));
	const decoded = await bridge.v1.runDesktopAudioCodecOperation(request);
	assert.equal(decoded.metadata.sampleRate, 44_100);
	assert.equal(decoded.metadata.channelCount, 1);
	await assert.rejects(() => bridge.v1.runDesktopAudioCodecOperation({
		...request, sampleRate: 48_000, channelCount: 2,
	}), /geometry authority/iu);
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
