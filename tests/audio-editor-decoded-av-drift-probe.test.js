/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	collectDecodedAvDriftSamples,
} from './browser/helpers/decoded-av-drift-probe.js';

class FakeAudioContext {
	static instances = [];
	static outputTimestampCalls = 0;

	currentTime = 999;
	destination = {};
	#frameIndex = 0;

	constructor(options) {
		assert.deepEqual(options, { sampleRate: 48_000 });
		this.closed = false;
		this.resumed = false;
		FakeAudioContext.instances.push(this);
	}

	async decodeAudioData() {
		return { sampleRate: 48_000, numberOfChannels: 1, length: 48_000 };
	}

	createBufferSource() {
		return {
			buffer: null,
			connect() {},
			start() {},
			stop() {},
		};
	}

	createGain() {
		return { gain: { value: 1 }, connect() {} };
	}

	getOutputTimestamp() {
		const frameIndex = this.#frameIndex;
		this.#frameIndex += 1;
		FakeAudioContext.outputTimestampCalls += 1;
		const expectedDisplayTime = 1_000 + frameIndex * 1_000 / 15;
		const timestampAgeMs = 20 + frameIndex * 3;
		const presentationTime = 10 + frameIndex / 15 + frameIndex / 1_000;
		return {
			contextTime: presentationTime - timestampAgeMs / 1_000,
			performanceTime: expectedDisplayTime - timestampAgeMs,
		};
	}

	async resume() {
		this.resumed = true;
	}

	async close() {
		this.closed = true;
	}
}

class FakeVideo {
	style = {};
	error = null;
	src = '';
	#frameIndex = 0;

	load() {
		if (this.src !== '') queueMicrotask(() => this.oncanplay?.());
	}

	async play() {}
	pause() {}
	remove() {}

	removeAttribute(name) {
		if (name === 'src') this.src = '';
	}

	requestVideoFrameCallback(callback) {
		const frameIndex = this.#frameIndex;
		this.#frameIndex += 1;
		queueMicrotask(() => callback(0, {
			expectedDisplayTime: 1_000 + frameIndex * 1_000 / 15,
			mediaTime: frameIndex / 15,
		}));
		return frameIndex + 1;
	}
}

test('decoded A/V drift correlates video presentation with the audio output clock', async () => {
	const originalAudioContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
	const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
	const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
	const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
	Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeAudioContext });
	Object.defineProperty(globalThis, 'document', {
		configurable: true,
		value: {
			body: { append() {} },
			createElement: (name) => {
				assert.equal(name, 'video');
				return new FakeVideo();
			},
		},
	});
	Object.defineProperty(URL, 'createObjectURL', {
		configurable: true,
		value: () => 'blob:decoded-av-probe',
	});
	Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value() {} });
	try {
		const samples = await collectDecodedAvDriftSamples([
			{ id: 'landscape', mimeType: 'video/webm', base64: 'AA==' },
			{ id: 'portrait', mimeType: 'video/webm', base64: 'AA==' },
		]);

		assert.equal(samples.length, 24);
		assert.equal(FakeAudioContext.outputTimestampCalls, 24);
		for (const fixtureId of ['landscape', 'portrait']) {
			const fixtureSamples = samples.filter((sample) => sample.fixtureId === fixtureId);
			assert.equal(fixtureSamples.length, 12);
			fixtureSamples.forEach((sample, frameIndex) => {
				assert.ok(Math.abs(sample.driftMs - frameIndex) < 0.000_000_01);
			});
		}
		assert.ok(FakeAudioContext.instances.every(({ resumed, closed }) => resumed && closed));
	} finally {
		restoreProperty(globalThis, 'AudioContext', originalAudioContext);
		restoreProperty(globalThis, 'document', originalDocument);
		restoreProperty(URL, 'createObjectURL', originalCreateObjectUrl);
		restoreProperty(URL, 'revokeObjectURL', originalRevokeObjectUrl);
	}
});

function restoreProperty(target, key, descriptor) {
	if (descriptor === undefined) delete target[key];
	else Object.defineProperty(target, key, descriptor);
}
