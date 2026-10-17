/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { encodePixelFramePngV1 } from '../src/common/editor/imaging/pixel-frame-png-v1.ts';
import { createDevelopProxyPngV1 } from './browser/helpers/lightscaper-develop-proxy-reference.ts';
import {
	inspectDevelopFullResolutionFramescaperNativeV1,
	inspectDevelopFullResolutionPngNativeV1,
} from './helpers/lightscaper-develop-full-resolution-native.ts';

const WIDTH = 4096, HEIGHT = 3072, BYTES = WIDTH * HEIGHT * 4;
let png: Promise<Blob> | undefined;
function originalPng(): Promise<Blob> {
	return png ??= (async () => {
		const fixture = await createDevelopProxyPngV1();
		try { return new Blob([fixture.bytes], { type: 'image/png' }); }
		finally { fixture.bytes.fill(0); }
	})();
}
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>(accept => { resolve = accept; });
	return { promise, resolve };
}
async function failureOf(work: Promise<unknown>): Promise<unknown> {
	try { await work; } catch (error) { return error; }
	assert.fail('The operation must refuse this input.');
}
async function remainsPending(work: Promise<unknown>): Promise<boolean> {
	let settled = false; void work.then(() => { settled = true; }, () => { settled = true; });
	await new Promise<void>(resolve => { setTimeout(resolve, 20); }); return !settled;
}

// These are explicit Node native-API controls, never a browser decode or ACK
// claim. The actual PNG container is the independently pinned large fixture.
async function withNativeControl(run: (control: ReturnType<typeof nativeControl>) => Promise<void>,
	options: Parameters<typeof nativeControl>[0] = {}): Promise<void> {
	const control = nativeControl(options), originals = new Map<string, PropertyDescriptor | undefined>();
	for (const [key, value] of Object.entries({ createImageBitmap: control.createImageBitmap, OffscreenCanvas: control.Canvas })) {
		originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
	}
	try { await run(control); }
	finally { for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
	} }
}
function nativeControl(options: { fullPlane?: boolean; drawFailure?: unknown; closeFailure?: unknown; widthFailure?: unknown; onOpen?: () => void } = {}) {
	let opens = 0, closes = 0, draws = 0;
	const readback = new Uint8ClampedArray(options.fullPlane ? BYTES : 4);
	if (!options.fullPlane) readback.set([23, 71, 149, 255]);
	if (options.fullPlane) for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
		const gray = [40, 100, 160][(Math.floor(x / 2) + Math.floor(y / 2)) % 3]!, offset = 4 * (y * WIDTH + x);
		readback.set([gray, gray, gray, 255], offset);
	}
	const canvases: Canvas[] = [];
	class Canvas {
		constructor(public width: number, public height: number) { canvases.push(this); }
		getContext(kind: string, attributes: unknown) {
			assert.equal(kind, '2d'); assert.deepEqual(attributes, { alpha: true, willReadFrequently: true, colorSpace: 'srgb' });
			return { clearRect() {}, drawImage() { draws++; if (Object.hasOwn(options, 'drawFailure')) throw options.drawFailure; },
				getImageData(x: number, y: number, width: number, height: number, settings: unknown) {
					assert.deepEqual([x, y, width, height], [0, 0, WIDTH, HEIGHT]); assert.deepEqual(settings, { colorSpace: 'srgb' });
					return { data: readback };
				} };
		}
	}
	return { Canvas, readback, canvases,
		get opens() { return opens; }, get closes() { return closes; }, get draws() { return draws; },
		async createImageBitmap(body: Blob, settings: unknown) {
			opens++; assert.ok(body instanceof Blob);
			assert.deepEqual(settings, { imageOrientation: 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
			options.onOpen?.();
			return { get width() { if (Object.hasOwn(options, 'widthFailure')) throw options.widthFailure; return WIDTH; }, height: HEIGHT,
				close() { closes++; if (Object.hasOwn(options, 'closeFailure')) throw options.closeFailure; } };
		},
	};
}

test('Light full-resolution PNG native control returns scalar whole-plane facts and retires its readback and bitmap', async () => {
	const body = await originalPng(), originalSha = createHash('sha256').update(new Uint8Array(await body.arrayBuffer())).digest('hex');
	await withNativeControl(async native => {
		const result = await inspectDevelopFullResolutionPngNativeV1({ body, stage: 'before' });
		assert.equal(result.encodedByteLength, body.size); assert.equal(result.encodedSha256, originalSha);
		assert.deepEqual(result.container, { width: WIDTH, height: HEIGHT, bitDepth: 8, colorType: 6, srgbIntent: 0, iccProfileCount: 0 });
		assert.equal(result.validation.byteLength, BYTES); assert.equal(result.validation.mismatchCount, 0);
		assert.equal(result.validation.maximumChannelError, 0); assert.equal(result.validation.firstMismatch, null);
		assert.equal(result.validation.actualRgbaSha256, result.validation.expectedRgbaSha256);
		assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.container), true);
		assert.equal(native.opens, 1); assert.equal(native.closes, 1); assert.equal(native.draws, 1);
		assert.equal(native.readback.every(byte => byte === 0), true);
		assert.deepEqual(native.canvases.map(canvas => [canvas.width, canvas.height]), [[0, 0]]);
		assert.equal(createHash('sha256').update(new Uint8Array(await body.arrayBuffer())).digest('hex'), originalSha);
	}, { fullPlane: true });
});

test('Light full-resolution native request admission refuses closed-record and foreign-signal violations before native work', async () => {
	const body = await originalPng(); let getters = 0;
	const accessor = Object.defineProperty({ body, stage: 'before' }, 'body', { get() { getters++; return body; } });
	for (const inspect of [inspectDevelopFullResolutionPngNativeV1, inspectDevelopFullResolutionFramescaperNativeV1]) {
		for (const request of [accessor, Object.create({ body, stage: 'before' }) as unknown,
			{ body, stage: 'before', extra: true }, { body, stage: 'future-stage' }, { body, stage: 'before', signal: {} },
			{ body: { size: 1, arrayBuffer() { getters++; return new ArrayBuffer(1); } }, stage: 'before' }]) {
			await failureOf(inspect(request as Parameters<typeof inspect>[0]));
		}
	}
	assert.equal(getters, 0);
});

test('Light full-resolution PNG refuses empty, excessive, wrong-signature and wrong-extent bodies before native acquisition', async () => {
	const smallPixels = new Uint8Array(16).fill(255);
	const smallPng = await encodePixelFramePngV1({ descriptor: { schemaVersion: 1, width: 2, height: 2,
		sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: smallPixels });
	await withNativeControl(async native => {
		for (const body of [new Blob(), new Blob([new Uint8Array(64 * 1024 * 1024 + 1)]), new Blob(['not a PNG']), new Blob([smallPng])]) {
			await failureOf(inspectDevelopFullResolutionPngNativeV1({ body, stage: 'before' }));
		}
		assert.equal(native.opens, 0); assert.equal(native.closes, 0);
	});
	smallPixels.fill(0); smallPng.fill(0);
});

test('Light full-resolution PNG uses intrinsic immutable Blob access and pins the native constructor before its first yield', async () => {
	const body = await originalPng(); let getters = 0;
	for (const key of ['size', 'slice', 'arrayBuffer']) Object.defineProperty(body, key, { configurable: true, get() { getters++; throw Symbol(key); } });
	try { await withNativeControl(async native => {
		const work = inspectDevelopFullResolutionPngNativeV1({ body, stage: 'before' });
		Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: () => { throw Symbol('late constructor'); } });
		await failureOf(work); assert.equal(native.opens, 1); assert.equal(native.closes, 1); assert.equal(getters, 0);
	}); } finally { for (const key of ['size', 'slice', 'arrayBuffer']) Reflect.deleteProperty(body, key); }
});

test('Light full-resolution PNG retains an opaque primary and independently attempted native cleanup', async () => {
	const primary = Symbol('draw refusal'), cleanup = Symbol('bitmap cleanup refusal'), body = await originalPng();
	await withNativeControl(async native => {
		const failure = await failureOf(inspectDevelopFullResolutionPngNativeV1({ body, stage: 'before' }));
		assert.ok(failure instanceof AggregateError); assert.equal(failure.cause, primary); assert.deepEqual(failure.errors, [primary, cleanup]);
		assert.equal(native.closes, 1); assert.deepEqual(native.canvases.map(canvas => [canvas.width, canvas.height]), [[0, 0]]);
	}, { drawFailure: primary, closeFailure: cleanup });
});

test('Light full-resolution PNG closes an acquired bitmap when its dimension read refuses', async () => {
	const primary = Symbol('dimension refusal'), body = await originalPng();
	await withNativeControl(async native => {
		assert.equal(await failureOf(inspectDevelopFullResolutionPngNativeV1({ body, stage: 'before' })), primary);
		assert.equal(native.closes, 1); assert.equal(native.canvases.length, 0);
	}, { widthFailure: primary });
});

test('Light full-resolution PNG joins its captured beforeClose observation even after a readback refusal', async () => {
	const body = await originalPng(), entered = deferred(), release = deferred(); let observations = 0;
	await withNativeControl(async native => {
		const dependencies = { beforeClose: async function(this: unknown) {
			assert.equal(this, dependencies); observations++; entered.resolve(); await release.promise;
		} };
		const work = inspectDevelopFullResolutionPngNativeV1({ body, stage: 'before' }, dependencies);
		dependencies.beforeClose = async () => { throw Symbol('late observation'); };
		await entered.promise; assert.equal(await remainsPending(work), true); assert.equal(native.closes, 0);
		release.resolve(); await failureOf(work); assert.equal(observations, 1); assert.equal(native.closes, 1);
		assert.equal(native.readback.every(byte => byte === 0), true);
	});
});

test('Light full-resolution PNG preserves native cancellation after an acquired bitmap joins', async () => {
	const body = await originalPng(), controller = new AbortController(), reason = Symbol('native read cancelled');
	await withNativeControl(async native => {
		assert.equal(await failureOf(inspectDevelopFullResolutionPngNativeV1({ body, stage: 'before', signal: controller.signal })), reason);
		assert.equal(native.closes, 1); assert.deepEqual([...native.readback], [23, 71, 149, 255]);
	}, { onOpen: () => { controller.abort(reason); } });
});
