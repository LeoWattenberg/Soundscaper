/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('preload rejects FFmpeg bitrate clamps and unsupported AAC sample rates before IPC', async () => {
	const fixture = await preload();
	for (const request of [
		encodeRequest('mp3', 8_000, 2, 80),
		encodeRequest('aac-m4a', 8_000, 1, 64),
		encodeRequest('aac-m4a', 192_000, 2, 192),
	]) {
		await assert.rejects(
			() => fixture.bridge.runDesktopAudioCodecOperation(request),
			/codec (?:encode settings|PCM geometry)/iu,
		);
	}
	assert.equal(fixture.invocations.length, 0);

	await assert.rejects(
		() => fixture.bridge.runDesktopAudioCodecOperation(
			encodeRequest('aac-m4a', 64_000, 2, 192),
		),
		(error) => error === fixture.mainFailure,
	);
	assert.equal(fixture.invocations.length, 1);
	assert.equal(fixture.invocations[0]?.[0], 'soundscaper:v1:codecs:audio:execute');
});

function encodeRequest(format, sampleRate, channelCount, bitrateKbps) {
	return {
		operation: 'audio-encode', format,
		input: new Uint8Array(channelCount * Float32Array.BYTES_PER_ELEMENT),
		sampleRate, channelCount, settings: { bitrateKbps }, maximumOutputBytes: 8_192,
		requestId: `desktop-audio-${'1'.repeat(32)}`,
	};
}

async function preload() {
	let bridge;
	const invocations = [];
	const mainFailure = new Error('main witness');
	const source = await readFile(new URL('../desktop/preload.mjs', import.meta.url), 'utf8');
	vm.runInNewContext(source, {
		ArrayBuffer, clearTimeout, Date, Float32Array, Object, Promise, RangeError,
		setTimeout, String, structuredClone, TextEncoder, TypeError, Uint8Array, URL,
		window: { postMessage() {} },
		require: () => ({
			contextBridge: {
				exposeInMainWorld(name, value) { if (name === 'soundscaperDesktop') bridge = value.v1; },
			},
			ipcRenderer: {
				invoke(channel, value) {
					invocations.push([channel, value]);
					return Promise.reject(mainFailure);
				},
				send() {}, on() {}, removeListener() {}, postMessage() {},
			},
		}),
	});
	assert.ok(bridge);
	return { bridge, invocations, mainFailure };
}
