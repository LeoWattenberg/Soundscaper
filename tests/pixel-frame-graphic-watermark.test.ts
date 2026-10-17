/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withGraphicWatermarkPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-graphic-watermark-v1.ts';
import { deferred } from './helpers/async-test-control.ts';

const limits = { maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 67_108_864 };
const options = { limits, maximumWorkingBytes: 134_217_728 };
const descriptor = (width: number, height: number) => ({ schemaVersion: 1, width, height,
	sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const });
const frame = (width: number, height: number, pixels: Uint8Array | Uint8ClampedArray) => ({ descriptor: descriptor(width, height), pixels });
const placement = { anchor: 'bottom-right', widthFraction: 1, marginPixels: 0, opacity: 1 };
const request = (pixels = Uint8Array.of(0, 0, 255, 255), graphic = Uint8Array.of(255, 0, 0, 128)) => ({
	frame: frame(1, 1, pixels), graphic: frame(1, 1, graphic), placement });

test('normal source-over uses independent linear-light and straight-alpha literals', async () => {
	for (const [background, expected] of [
		[[0, 0, 255, 255], [188, 0, 187, 255]],
		[[0, 0, 255, 128], [213, 0, 156, 192]],
	] as const) {
		const input = request(Uint8Array.from(background)); const before = input.frame.pixels.slice(), mark = input.graphic.pixels.slice();
		let output: Uint8Array | undefined;
		await withGraphicWatermarkPixelFrameV1(input, result => {
			assert.deepEqual(result.descriptor, descriptor(1, 1)); assert.deepEqual([...result.pixels], expected);
			assert.notEqual(result.pixels.buffer, input.frame.pixels.buffer); assert.notEqual(result.pixels.buffer, input.graphic.pixels.buffer);
			output = result.pixels as Uint8Array;
		}, options);
		assert.deepEqual(input.frame.pixels, before); assert.deepEqual(input.graphic.pixels, mark); assert.ok(output!.every(byte => byte === 0));
	}
});

test('explicit half opacity multiplies graphic alpha once and preserves transparent graphic holes', async () => {
	await withGraphicWatermarkPixelFrameV1({ ...request(undefined, Uint8Array.of(255, 0, 0, 255)), placement: { ...placement, opacity: 0.5 } },
		result => assert.deepEqual([...result.pixels], [188, 0, 188, 255]), options);
	const input = { frame: frame(2, 1, Uint8Array.of(13, 71, 19, 0, 0, 0, 255, 255)),
		graphic: frame(2, 1, Uint8Array.of(255, 93, 51, 0, 255, 0, 0, 128)), placement };
	await withGraphicWatermarkPixelFrameV1(input, result => assert.deepEqual([...result.pixels], [13, 71, 19, 0, 188, 0, 187, 255]), options);
});

test('all nine anchors pin concrete positions without changing untouched source pixels', async () => {
	for (const [vertical, y] of [['top', 0], ['middle', 2], ['bottom', 4]] as const) {
		for (const [horizontal, x] of [['left', 0], ['center', 2], ['right', 4]] as const) {
			const base = Uint8Array.from({ length: 100 }, (_unused, index) => index % 4 === 3 ? 255 : 17);
			const expected = base.slice(); expected.set([255, 0, 0, 255], (y * 5 + x) * 4);
			await withGraphicWatermarkPixelFrameV1({ frame: frame(5, 5, base), graphic: frame(1, 1, Uint8Array.of(255, 0, 0, 255)),
				placement: { ...placement, anchor: `${vertical}-${horizontal}`, widthFraction: 0.2 } },
				result => assert.deepEqual(result.pixels, expected), options);
		}
	}
});

test('margin and aspect-fit scaling use actual delivery geometry and shared bilinear samples', async () => {
	const base = Uint8Array.from({ length: 100 }, (_unused, index) => index % 4 === 3 ? 255 : 0), expected = base.slice();
	for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) expected.set([0, 255, 0, 255], (y * 5 + x) * 4);
	await withGraphicWatermarkPixelFrameV1({ frame: frame(5, 5, base), graphic: frame(1, 1, Uint8Array.of(0, 255, 0, 255)),
		placement: { ...placement, marginPixels: 1 } }, result => assert.deepEqual(result.pixels, expected), options);
	const small = request(Uint8Array.of(0, 0, 0, 255));
	await withGraphicWatermarkPixelFrameV1({ ...small, graphic: frame(2, 2, Uint8Array.of(
		0, 0, 0, 255, 200, 0, 0, 255, 0, 200, 0, 255, 200, 200, 0, 255)) },
		result => assert.deepEqual([...result.pixels], [100, 100, 0, 255]), options);
	const rectangle = Uint8Array.from({ length: 4 * 3 * 4 }, (_unused, index) => index % 4 === 3 ? 255 : 0), fitted = rectangle.slice();
	fitted.set([255, 0, 0, 255, 0, 255, 0, 255], (2 * 4 + 2) * 4);
	await withGraphicWatermarkPixelFrameV1({ frame: frame(4, 3, rectangle), graphic: frame(2, 1, Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 255)),
		placement: { ...placement, widthFraction: 0.5 } }, result => assert.deepEqual(result.pixels, fitted), options);
});

test('offset views and zero opacity preserve hidden RGB and both complete backing buffers', async () => {
	const backing = Uint8Array.of(91, 92, 3, 71, 255, 0, 11, 29, 83, 127, 93), mark = Uint8Array.of(81, 255, 0, 0, 255, 82);
	const before = backing.slice(), markBefore = mark.slice(); let output: Uint8Array | undefined;
	await withGraphicWatermarkPixelFrameV1({ frame: frame(2, 1, new Uint8ClampedArray(backing.buffer, 2, 8)),
		graphic: frame(1, 1, mark.subarray(1, 5)), placement: { ...placement, opacity: 0 } }, result => {
		assert.deepEqual([...result.pixels], [3, 71, 255, 0, 11, 29, 83, 127]); output = result.pixels as Uint8Array;
	}, options);
	assert.deepEqual(backing, before); assert.deepEqual(mark, markBefore); assert.ok(output!.every(byte => byte === 0));
	await withGraphicWatermarkPixelFrameV1({ frame: frame(2, 1, new Uint8ClampedArray(backing.buffer, 2, 8)),
		graphic: frame(1, 1, mark.subarray(1, 5)), placement: { ...placement, widthFraction: 0.5 } },
		result => assert.deepEqual([...result.pixels], [3, 71, 255, 0, 255, 0, 0, 255]), options);
	assert.deepEqual(backing, before); assert.deepEqual(mark, markBefore);
});

test('captured placement and workspace capacity cannot change after the first task yield', async () => {
	const base = Uint8Array.from({ length: 512 * 128 * 4 }, (_unused, index) => index % 4 === 3 ? 255 : 0);
	const selected = { ...placement, anchor: 'top-left', widthFraction: 1 / 512 }, budget = { ...options };
	const pending = withGraphicWatermarkPixelFrameV1({ frame: frame(512, 128, base), graphic: request().graphic, placement: selected }, result => {
		assert.deepEqual([...result.pixels.subarray(0, 4)], [188, 0, 0, 255]); assert.deepEqual([...result.pixels.subarray(-4)], [0, 0, 0, 255]);
	}, budget);
	selected.anchor = 'bottom-right'; selected.opacity = 0; budget.maximumWorkingBytes = 1;
	await pending;
});

test('queued cancellation interrupts bounded task work before output delivery', async () => {
	const stop = new AbortController(), reason = Symbol('queued watermark cancellation');
	const source = Uint8Array.from({ length: 512 * 128 * 4 }, (_unused, index) => index % 4 === 3 ? 255 : 71), before = source.slice();
	const timer = setTimeout(() => { stop.abort(reason); }, 0);
	try { await assert.rejects(withGraphicWatermarkPixelFrameV1({ frame: frame(512, 128, source), graphic: request().graphic,
		placement, signal: stop.signal }, () => assert.fail('cancelled delivery'), options), error => Object.is(error, reason)); }
	finally { clearTimeout(timer); }
	assert.deepEqual(source, before);
});

test('cancellation joins held consumer settlement before wiping its independent output', async () => {
	const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = Symbol('held watermark consumer');
	let output: Uint8Array | undefined, settled = false;
	const pending = withGraphicWatermarkPixelFrameV1({ ...request(), signal: stop.signal }, async result => {
		output = result.pixels as Uint8Array; entered.resolve(); await release.promise;
	}, options).finally(() => { settled = true; });
	await entered.promise; stop.abort(reason); await Promise.resolve(); assert.equal(settled, false); assert.ok(output!.some(byte => byte !== 0));
	release.resolve(); await assert.rejects(pending, error => Object.is(error, reason)); assert.ok(output!.every(byte => byte === 0));
});

test('opaque consumer failure preserves identity and wipes only owned output', async () => {
	const input = request(), before = input.frame.pixels.slice(), graphic = input.graphic.pixels.slice(), reason = Symbol('codec refusal');
	let output: Uint8Array | undefined;
	await assert.rejects(withGraphicWatermarkPixelFrameV1(input, result => { output = result.pixels as Uint8Array; throw reason; }, options), error => Object.is(error, reason));
	assert.ok(output!.every(byte => byte === 0)); assert.deepEqual(input.frame.pixels, before); assert.deepEqual(input.graphic.pixels, graphic);
});

test('closed parameters, unsupported profiles and native-signal refusals precede delivery', async () => {
	const original = request(), consume = () => assert.fail('invalid delivery');
	const refused = (error: unknown) => error instanceof TypeError || error instanceof RangeError;
	for (const invalid of [{ ...original, extra: 1 }, { ...original, signal: { aborted: false } },
		...[{ anchor: 'future' }, { widthFraction: 0 }, { widthFraction: 1.01 }, { marginPixels: 0.5 }, { marginPixels: 1 },
			{ opacity: -0.1 }, { opacity: NaN }, { extra: 1 }].map(change => ({ ...original, placement: { ...placement, ...change } })),
		{ ...original, frame: { ...original.frame, descriptor: { ...original.frame.descriptor, primaries: 'display-p3' } } },
		{ ...original, graphic: { ...original.graphic, descriptor: { ...original.graphic.descriptor, sampleFormat: 'float32' } } },
		{ ...original, graphic: { ...original.graphic, pixels: new Uint8Array(3) } }]) {
		await assert.rejects(withGraphicWatermarkPixelFrameV1(invalid, consume, options), refused);
	}
	await assert.rejects(withGraphicWatermarkPixelFrameV1(original, consume, { ...options, maximumWorkingBytes: 0 }), refused);
	await assert.rejects(withGraphicWatermarkPixelFrameV1(original, consume, { ...options, maximumWorkingBytes: 10 }), /working|capacity/u);
	await assert.rejects(withGraphicWatermarkPixelFrameV1(original, consume, { ...options, limits: { ...limits, maximumBytes: 3 } }), refused);
});

test('pre-abort and later source or graphic detachment refuse without publishing', async () => {
	const reason = Symbol('preabort'), stop = new AbortController(); stop.abort(reason);
	await assert.rejects(withGraphicWatermarkPixelFrameV1({ ...request(), signal: stop.signal }, () => assert.fail('preabort delivery'), options), error => Object.is(error, reason));
	for (const owner of ['frame', 'graphic'] as const) {
		const base = Uint8Array.from({ length: 512 * 128 * 4 }, (_unused, index) => index % 4 === 3 ? 255 : 0);
		const input = { frame: frame(512, 128, base), graphic: request().graphic, placement };
		const pending = withGraphicWatermarkPixelFrameV1(input, () => assert.fail('detached delivery'), options);
		structuredClone(input[owner].pixels.buffer, { transfer: [input[owner].pixels.buffer] });
		await assert.rejects(pending, /detached/u);
	}
});

test('output detachment during the scoped consumer refuses successful delivery', async () => {
	await assert.rejects(withGraphicWatermarkPixelFrameV1(request(), result => {
		structuredClone(result.pixels.buffer, { transfer: [result.pixels.buffer] });
	}, options), /detached/u);
});

test('Rec.709 delivery keeps its declared transfer while blending an sRGB graphic in shared linear light', async () => {
	const source = { descriptor: { ...descriptor(2, 1), primaries: 'bt709', transfer: 'bt709' },
		pixels: Uint8Array.of(19, 83, 125, 0, 0, 0, 255, 255) };
	const input = { frame: source, graphic: frame(2, 1, Uint8Array.of(255, 0, 0, 0, 255, 0, 0, 128)), placement };
	const before = source.pixels.slice();
	await withGraphicWatermarkPixelFrameV1(input, result => {
		assert.deepEqual(result.descriptor, source.descriptor);
		assert.deepEqual([...result.pixels], [19, 83, 125, 0, 180, 0, 180, 255]);
	}, options);
	assert.deepEqual(source.pixels, before);
	await withGraphicWatermarkPixelFrameV1({ ...input, placement: { ...placement, opacity: 0 } },
		result => assert.deepEqual(result.pixels, before), { ...options, maximumWorkingBytes: 8 });
});

test('only the source admits Rec.709 and its additional transfer lookup fits the captured workspace ceiling', async () => {
	const input = request(), rec709 = { ...input.frame, descriptor: { ...input.frame.descriptor, primaries: 'bt709', transfer: 'bt709' } };
	await withGraphicWatermarkPixelFrameV1({ ...input, frame: rec709 }, result => assert.deepEqual([...result.pixels], [180, 0, 180, 255]),
		{ ...options, maximumWorkingBytes: 4 + 4 + 64 + 4096 });
	await assert.rejects(withGraphicWatermarkPixelFrameV1({ ...input, frame: rec709 }, () => assert.fail('capacity refused'),
		{ ...options, maximumWorkingBytes: 4 + 4 + 64 + 4095 }), /capacity/u);
	for (const change of [{ primaries: 'srgb', transfer: 'bt709' }, { primaries: 'bt709', transfer: 'linear' }]) {
		await assert.rejects(withGraphicWatermarkPixelFrameV1({ ...input, frame: { ...input.frame, descriptor: { ...input.frame.descriptor, ...change } } },
			() => assert.fail('mixed or linear profile refused'), options), /profile/u);
	}
	await assert.rejects(withGraphicWatermarkPixelFrameV1({ ...input, graphic: rec709 }, () => assert.fail('graphic must stay sRGB'), options), /profile/u);
});
