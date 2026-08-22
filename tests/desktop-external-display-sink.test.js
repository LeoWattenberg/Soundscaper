/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('the dedicated sandbox sink verifies and presents one exact SDR RGBA frame', async () => {
	const source = await readFile(new URL('../desktop/external-display-sink-preload.cjs', import.meta.url), 'utf8');
	const listeners = new Map();
	const sends = [];
	const events = new Map();
	const draws = [];
	class Canvas {
		width = 0;
		height = 0;
		getContext() { return { putImageData: (image, x, y) => draws.push({ image, x, y }) }; }
	}
	class FrameImageData {
		constructor(bytes, width, height) { this.bytes = bytes; this.width = width; this.height = height; }
	}
	const canvas = new Canvas();
	vm.runInNewContext(source, {
		Array, ArrayBuffer, Error, Map, Number, Object, Promise, RangeError, Reflect, String,
		TypeError, Uint8Array, Uint8ClampedArray, crypto: webcrypto,
		HTMLCanvasElement: Canvas, ImageData: FrameImageData,
		document: { getElementById: () => canvas },
		window: { addEventListener: (name, listener) => events.set(name, listener) },
		require: () => ({
			ipcRenderer: {
				on: (channel, listener) => listeners.set(channel, listener),
				send: (channel, value) => sends.push({ channel, value }),
			},
		}),
	});
	events.get('DOMContentLoaded')();
	const acknowledgements = [];
	const port = {
		onmessage: null, onmessageerror: null, onclose: null,
		postMessage: (value) => acknowledgements.push(value), start: () => undefined,
		close: () => undefined,
	};
	listeners.get('framescaper:external-display:v1:connect')(
		{ ports: [port] }, { version: 1, pixelFormat: 'rgba8', colorSpace: 'srgb' },
	);
	const rgba = Uint8Array.of(1, 2, 3, 255, 4, 5, 6, 255);
	const sha256 = createHash('sha256').update(rgba).digest('hex');
	port.onmessage({ data: {
		version: 1, type: 'frame', sequence: 1, evaluationFingerprint: 'ab'.repeat(32),
		width: 2, height: 1, dynamicRange: 'sdr', rgbaSha256: sha256, rgba,
	} });
	for (let attempt = 0; attempt < 20 && draws.length === 0; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	assert.equal(draws.length, 1);
	assert.equal(draws[0].image.width, 2);
	assert.deepEqual(JSON.parse(JSON.stringify(acknowledgements)), [
		{ version: 1, type: 'presented', sequence: 1, sha256 },
	]);
	events.get('keydown')({ key: 'Escape', preventDefault: () => undefined });
	assert.deepEqual(JSON.parse(JSON.stringify(sends)), [{
		channel: 'framescaper:external-display:v1:close', value: { reason: 'escape-key' },
	}]);
	assert.doesNotMatch(source, /contextBridge|framescaperDesktop|soundscaperDesktop/u);
});

test('the dedicated sink admits a frame larger than one 16 MiB data-plane chunk', async () => {
	const source = await readFile(new URL('../desktop/external-display-sink-preload.cjs', import.meta.url), 'utf8');
	const listeners = new Map();
	const events = new Map();
	const draws = [];
	class Canvas {
		getContext() { return { putImageData: (image) => draws.push(image) }; }
	}
	class FrameImageData {
		constructor(bytes, width, height) { this.bytes = bytes; this.width = width; this.height = height; }
	}
	const canvas = new Canvas();
	vm.runInNewContext(source, {
		Array, ArrayBuffer, Error, Map, Number, Object, Promise, RangeError, Reflect, String,
		TypeError, Uint8Array, Uint8ClampedArray, crypto: webcrypto,
		HTMLCanvasElement: Canvas, ImageData: FrameImageData,
		document: { getElementById: () => canvas },
		window: { addEventListener: (name, listener) => events.set(name, listener) },
		require: () => ({ ipcRenderer: {
			on: (channel, listener) => listeners.set(channel, listener), send: () => undefined,
		} }),
	});
	events.get('DOMContentLoaded')();
	const acknowledgements = [];
	const port = { onmessage: null, onmessageerror: null, onclose: null,
		postMessage: (value) => acknowledgements.push(value), start: () => undefined,
		close: () => undefined };
	listeners.get('framescaper:external-display:v1:connect')(
		{ ports: [port] }, { version: 1, pixelFormat: 'rgba8', colorSpace: 'srgb' },
	);
	const width = 2_048;
	const height = 2_049;
	const rgba = new Uint8Array(width * height * 4);
	const sha256 = createHash('sha256').update(rgba).digest('hex');
	port.onmessage({ data: {
		version: 1, type: 'frame', sequence: 2, evaluationFingerprint: 'cd'.repeat(32),
		width, height, dynamicRange: 'sdr', rgbaSha256: sha256, rgba,
	} });
	for (let attempt = 0; attempt < 100 && draws.length === 0; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	assert.equal(draws.length, 1);
	assert.equal(draws[0].bytes.byteLength, rgba.byteLength);
	assert.equal(acknowledgements[0].sequence, 2);
});

test('Electron loads only the staged sink document and moves frames over a MessagePort', async () => {
	const source = await readFile(new URL('../desktop/framescaper-native-services-electron-ports.mjs', import.meta.url), 'utf8');
	assert.match(source, /external-display-sink\.html/u);
	assert.match(source, /external-display-sink-preload\.cjs/u);
	assert.match(source, /loadFile\(SINK_HTML\)/u);
	assert.match(source, /new MessageChannelMain\(\)/u);
	assert.match(source, /webContents\.postMessage\(SINK_CONNECT_CHANNEL/u);
	assert.doesNotMatch(source, /framescaper-external-display=1|loadURL\(|webContents\.send\(/u);
});
