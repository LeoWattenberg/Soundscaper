/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperVideoFrameAddressFinishing } from
	'../src/framescaper/video-frame-address-finishing.ts';

test('the default decoder admits full-size temporal frame requests through the preview extractor', async () => {
	const originals = new Map<string, PropertyDescriptor | undefined>();
	for (const name of ['document', 'createImageBitmap']) {
		originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
	}
	let capturedWidth = 0;
	let capturedHeight = 0;
	const video = fakeVideo();
	const document = {
		createElement(name: string) {
			if (name === 'video') return video;
			if (name !== 'canvas') throw new Error(`Unexpected element ${name}.`);
			const canvas = {
				width: 0,
				height: 0,
				getContext() {
					return {
						drawImage() {},
						getImageData: () => ({
							data: new Uint8ClampedArray(canvas.width * canvas.height * 4),
						}),
					};
				},
				toBlob(callback: (body: Blob | null) => void, mimeType: string) {
					capturedWidth = canvas.width;
					capturedHeight = canvas.height;
					callback(new Blob(['captured'], { type: mimeType }));
				},
			};
			return canvas;
		},
	};
	Object.defineProperties(globalThis, {
		document: { configurable: true, value: document },
		createImageBitmap: {
			configurable: true,
			value: async () => ({
				width: capturedWidth, height: capturedHeight, close() {},
			}),
		},
	});
	const addressing = createFramescaperVideoFrameAddressFinishing({
		sources: new Map([['video-source', new Blob(['video'], { type: 'video/mp4' })]]),
		timingViewsBySourceId: new Map([[
			'video-source', { kind: 'cfr' as const, rate: { num: 30, den: 1 }, frameCount: 1 },
		]]),
	});
	try {
		const frame = await addressing.resolve({
			sourceId: 'video-source', sourceFrame: 0, width: 1_280, height: 720,
			signal: new AbortController().signal,
		});
		assert.deepEqual({ width: frame.width, height: frame.height }, { width: 1_280, height: 720 });
		assert.deepEqual({ width: capturedWidth, height: capturedHeight }, { width: 640, height: 360 });
	} finally {
		await addressing.dispose();
		for (const [name, descriptor] of originals) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else Reflect.deleteProperty(globalThis, name);
		}
	}
});

function fakeVideo(): Record<string, unknown> {
	type Listener = () => void;
	const listeners = new Map<string, Set<Listener>>();
	let currentTime = 0;
	const emit = (name: string) => {
		for (const listener of [...(listeners.get(name) ?? [])]) listener();
	};
	return {
		duration: 1,
		videoWidth: 1_280,
		videoHeight: 720,
		preload: '',
		muted: false,
		playsInline: false,
		src: '',
		get currentTime() { return currentTime; },
		set currentTime(value: number) {
			currentTime = value;
			queueMicrotask(() => emit('seeked'));
		},
		addEventListener(name: string, listener: Listener) {
			const entries = listeners.get(name) ?? new Set<Listener>();
			entries.add(listener);
			listeners.set(name, entries);
			if (name === 'loadedmetadata') queueMicrotask(() => emit(name));
		},
		removeEventListener(name: string, listener: Listener) {
			listeners.get(name)?.delete(listener);
		},
		pause() {},
		removeAttribute() {},
		load() {},
	};
}
