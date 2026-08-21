/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createWebVcrCroppedVideoTrack } from '../src/common/editor/controller/web-vcr-video-frame-crop.ts';

test('Web VCR crops before encoding, freezes first-frame geometry, and closes every frame', async () => {
	const inputs = [frame(1_921, 1_081, 0), frame(1_921, 1_081, 33_333)];
	const outputOptions: unknown[] = [];
	const outputs: Array<{ closeCount: number }> = [];
	let stopped = 0;
	const cropped = createWebVcrCroppedVideoTrack({
		source: { kind: 'video', stop() {} },
		crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
		runtime: {
			MediaStreamTrackProcessor: class {
				readable = { getReader: () => reader(inputs) };
			},
			MediaStreamTrackGenerator: class {
				kind = 'video';
				writable = { getWriter: () => writer() };
				stop() { stopped += 1; }
			},
			VideoFrame: class {
				codedWidth = 0; codedHeight = 0; timestamp = 0; closeCount = 0;
				constructor(_source: unknown, options: unknown) { outputOptions.push(options); outputs.push(this); }
				close() { this.closeCount += 1; }
			},
		},
		onError(error) { throw error; },
	});

	assert.deepEqual(await cropped.firstFrame, {
		inputSize: { width: 1_921, height: 1_081 },
		outputSize: { width: 962, height: 542 },
	});
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	assert.equal(inputs.every(({ closeCount }) => closeCount === 1), true);
	assert.equal(outputs.every(({ closeCount }) => closeCount === 1), true);
	assert.deepEqual(outputOptions, [
		{ visibleRect: { x: 192, y: 108, width: 962, height: 542 }, displayWidth: 962, displayHeight: 542, timestamp: 0 },
		{ visibleRect: { x: 192, y: 108, width: 962, height: 542 }, displayWidth: 962, displayHeight: 542, timestamp: 33_333 },
	]);
	await cropped.dispose();
	assert.equal(stopped, 1);
});

test('Web VCR crop pipeline reports capture-surface drift and rejects first-frame failure', async () => {
	const failures: unknown[] = [];
	const cropped = createWebVcrCroppedVideoTrack({
		source: { kind: 'video', stop() {} }, crop: { x: 0, y: 0, width: 1, height: 1 },
		runtime: runtime([frame(1_280, 720, 0), frame(1_920, 1_080, 1)]),
		onError: (error) => { failures.push(error); },
	});
	await cropped.firstFrame;
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	assert.match(String(failures[0]), /dimensions changed/iu);
	await cropped.dispose();

	const empty = createWebVcrCroppedVideoTrack({
		source: { kind: 'video', stop() {} }, crop: { x: 0, y: 0, width: 1, height: 1 },
		runtime: runtime([]), onError() {},
	});
	await assert.rejects(empty.firstFrame, /before the first/iu);
	await empty.dispose();
});

function frame(codedWidth: number, codedHeight: number, timestamp: number) {
	return { codedWidth, codedHeight, timestamp, closeCount: 0, close() { this.closeCount += 1; } };
}

function reader(values: ReturnType<typeof frame>[]) {
	return {
		async read() { const value = values.shift(); return value ? { done: false, value } : { done: true }; },
		async cancel() {}, releaseLock() {},
	};
}

function writer() {
	return { async write() {}, async close() {}, async abort() {}, releaseLock() {} };
}

function runtime(values: ReturnType<typeof frame>[]) {
	return {
		MediaStreamTrackProcessor: class { readable = { getReader: () => reader(values) }; },
		MediaStreamTrackGenerator: class { kind = 'video'; writable = { getWriter: writer }; stop() {} },
		VideoFrame: class {
			codedWidth = 0; codedHeight = 0; timestamp = 0;
			constructor() {} close() {}
		},
	};
}
