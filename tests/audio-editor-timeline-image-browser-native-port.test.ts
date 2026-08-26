/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	openFramescaperBrowserNativeImageV1,
} from '../src/common/editor/timeline-image-browser-native-port.ts';

test('ImageDecoder dimensions come from a decoded frame rather than the track inventory', async (context) => {
	const decoderDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ImageDecoder');
	const canvasDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
	let decodeCalls = 0;
	let closedFrames = 0;
	class FakeImageDecoder {
		static async isTypeSupported(): Promise<boolean> { return true; }
		readonly tracks = {
			ready: Promise.resolve(),
			selectedTrack: { frameCount: 1 },
		};
		async decode(): Promise<Readonly<{ image: FakeImage; complete: true }>> {
			decodeCalls += 1;
			return { image: new FakeImage(), complete: true };
		}
		close(): void {}
	}
	class FakeImage {
		readonly displayWidth = 2;
		readonly displayHeight = 1;
		readonly duration = null;
		close(): void { closedFrames += 1; }
	}
	class FakeOffscreenCanvas {
		constructor(readonly width: number, readonly height: number) {}
		getContext(): object {
			return {
				clearRect() {},
				drawImage() {},
				getImageData: () => ({ data: Uint8ClampedArray.of(
					255, 0, 0, 255, 0, 255, 0, 255,
				) }),
			};
		}
	}
	Object.defineProperty(globalThis, 'ImageDecoder', {
		configurable: true, value: FakeImageDecoder,
	});
	Object.defineProperty(globalThis, 'OffscreenCanvas', {
		configurable: true, value: FakeOffscreenCanvas,
	});
	context.after(() => {
		if (decoderDescriptor) Object.defineProperty(globalThis, 'ImageDecoder', decoderDescriptor);
		else Reflect.deleteProperty(globalThis, 'ImageDecoder');
		if (canvasDescriptor) Object.defineProperty(globalThis, 'OffscreenCanvas', canvasDescriptor);
		else Reflect.deleteProperty(globalThis, 'OffscreenCanvas');
	});

	const session = await openFramescaperBrowserNativeImageV1({
		bytes: Uint8Array.of(1), format: 'png', mimeType: 'image/png',
	});
	assert.deepEqual(session.metadata, {
		width: 2, height: 1, frameCount: 1, topology: 'single',
		runtimeVersion: 'webcodecs-image-decoder-v1',
	});
	assert.deepEqual([...((await session.decodeFrame(0)).rgba)], [
		255, 0, 0, 255, 0, 255, 0, 255,
	]);
	assert.equal(decodeCalls, 2);
	assert.equal(closedFrames, 2);
	session.close();
});

/**
 * The bitmap exists before the abort can be observed, and only the session that
 * is never returned can close it. A cancelled import — the per-file decode
 * deadline, or the operator stopping a batch — would otherwise orphan a raster
 * of up to the admitted maximum per file.
 */
test('a decode cancelled after the bitmap resolves still closes it', async (context) => {
	const decoderDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ImageDecoder');
	const bitmapDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
	let closedBitmaps = 0;
	const controller = new AbortController();
	Reflect.deleteProperty(globalThis, 'ImageDecoder');
	Object.defineProperty(globalThis, 'createImageBitmap', {
		configurable: true,
		value: async () => {
			// Aborted while the decode was in flight, which is the window the guard
			// has to cover.
			controller.abort();
			return {
				width: 2, height: 1,
				close(): void { closedBitmaps += 1; },
			};
		},
	});
	context.after(() => {
		if (decoderDescriptor) Object.defineProperty(globalThis, 'ImageDecoder', decoderDescriptor);
		if (bitmapDescriptor) Object.defineProperty(globalThis, 'createImageBitmap', bitmapDescriptor);
		else Reflect.deleteProperty(globalThis, 'createImageBitmap');
	});

	await assert.rejects(openFramescaperBrowserNativeImageV1({
		bytes: Uint8Array.of(1), format: 'png', mimeType: 'image/png', signal: controller.signal,
	}));
	assert.equal(closedBitmaps, 1, 'the orphaned bitmap is released');
});
