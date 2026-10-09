/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { openFramescaperBrowserNativeImageV1 as open } from '../src/common/editor/timeline-image-browser-native-port.ts';
import { ordinaryFramescaperImage } from './helpers/framescaper-ordinary-animation-fixture.ts';
import { createPngFixture } from './helpers/png-fixture.mjs';

function bitmapFallback(context: TestContext) {
	const properties = ['ImageDecoder', 'createImageBitmap'] as const;
	const saved = properties.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
	let opened = 0;
	Reflect.deleteProperty(globalThis, 'ImageDecoder');
	Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true,
		value: async () => { opened += 1; return { width: 16, height: 16, close() {} }; } });
	context.after(() => {
		for (const [name, descriptor] of saved) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else Reflect.deleteProperty(globalThis, name);
		}
	});
	return () => opened;
}

for (const format of ['png', 'gif', 'webp'] as const) {
	test(`static-only browser does not reinterpret an ordinary animated ${format}`, async (context) => {
		const opened = bitmapFallback(context);
		await assert.rejects(() => open({ bytes: ordinaryFramescaperImage(`animated.${format}`),
			format, mimeType: `image/${format}` }), /animated.*decoder/iu);
		assert.equal(opened(), 0, 'admit the real encoded topology before static decode');
	});
	test(`static-only browser retains ordinary single-frame ${format} admission`, async (context) => {
		const opened = bitmapFallback(context);
		const bytes = format === 'png' ? createPngFixture(16) : ordinaryFramescaperImage(`static.${format}`);
		const result = await open({ bytes, format, mimeType: `image/${format}` });
		assert.equal(result.metadata.topology, 'single');
		assert.equal(result.metadata.frameCount, 1);
		assert.equal(opened(), 1);
		result.close();
	});
}

test('an available native animation decoder keeps its ordinary animated PNG route', async (context) => {
	const opened = bitmapFallback(context);
	let closed = 0;
	class NativeDecoder {
		static async isTypeSupported() { return true; }
		readonly tracks = { ready: Promise.resolve(), selectedTrack: { frameCount: 10 } };
		async decode() { return { complete: true, image: { displayWidth: 16, displayHeight: 16,
			duration: 500_000, close() { closed += 1; } } }; }
		close() { closed += 1; }
	}
	Object.defineProperty(globalThis, 'ImageDecoder', { configurable: true, value: NativeDecoder });
	const session = await open({ bytes: ordinaryFramescaperImage('animated.png'), format: 'png', mimeType: 'image/png' });
	assert.equal(session.metadata.frameCount, 10);
	assert.equal(session.metadata.topology, 'animated');
	assert.equal(opened(), 0);
	session.close();
	assert.equal(closed, 2);
});
