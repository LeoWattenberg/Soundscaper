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
