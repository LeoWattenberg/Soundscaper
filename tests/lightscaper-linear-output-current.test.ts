/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareLinearExportResizeV1, writeLinearExportResizeV1 } from '../src/common/editor/imaging/pixel-frame-linear-export-resize-v1.ts';
import { prepareLinearGraphicOverlayV1, writeLinearGraphicOverlayV1 } from '../src/common/editor/imaging/pixel-frame-linear-graphic-overlay-v1.ts';
import { withExportResizedPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-export-resize-v1.ts';
import { withGraphicWatermarkPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-graphic-watermark-v1.ts';
import { imageExportGraphicPlacement } from '../src/common/editor/image-export-graphic-request.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
const LIMITS = { maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 268_435_456 };
function descriptor(width: number, height = 1) { return { schemaVersion: 1 as const, width, height, sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const }; }
function frame(values: readonly number[], width = values.length / 4, height = 1) { return { descriptor: descriptor(width, height), pixels: new Float32Array(values) }; }
function graphic(values: readonly number[], width = values.length / 4, height = 1): PixelFrameV1 { return { descriptor: { ...descriptor(width, height), sampleFormat: 'unorm8', transfer: 'srgb' }, pixels: new Uint8Array(values) }; }
function close(actual: number, expected: number): void { assert.ok(Math.abs(actual - expected) <= 2e-7 * Math.max(1, Math.abs(expected)), `${String(actual)} != ${String(expected)}`); }
function decode(value: number): number { return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }
function byte(value: number): number { const n = Math.max(0, Math.min(1, value)); return Math.round(255 * (n <= .0031308 ? n * 12.92 : 1.055 * n ** (1 / 2.4) - .055)); }
const place = (anchor = 'middle-center', widthFraction = 1, marginPixels = 0, opacity = 1) => ({ anchor, widthFraction, marginPixels, opacity });
async function resized(source: ReturnType<typeof frame>, sizing: unknown, quality: 'nearest' | 'bilinear') {
	const plan = prepareLinearExportResizeV1(sizing, quality, source.descriptor, LIMITS), pixels = new Float32Array(plan.sampleCount), before = source.pixels.slice();
	await writeLinearExportResizeV1(plan, source, pixels); assert.deepEqual(source.pixels, before); return { descriptor: plan.descriptor, pixels };
}
async function marked(source: ReturnType<typeof frame>, mark: PixelFrameV1, placement = place()) {
	const plan = prepareLinearGraphicOverlayV1(placement, mark.descriptor, source.descriptor, LIMITS), pixels = new Float32Array(plan.sampleCount);
	const before = source.pixels.slice(), graphicBefore = mark.pixels.slice();
	await writeLinearGraphicOverlayV1(plan, source, mark, pixels); assert.deepEqual(source.pixels, before); assert.deepEqual(mark.pixels, graphicBefore); return pixels;
}

test('native output sizing reuses all scalar policies and copies exact unchanged Float32 bits', async () => {
	const source = frame([-2, 3, 2 ** -149, 0, .25, .5, 2, .375, .1, .2, .3, 1, .4, .5, .6, 1, .7, .8, .9, 1, 1, 2, 3, 1, 4, 5, 6, 1, 7, 8, 9, 1], 4, 2);
	for (const quality of ['nearest', 'bilinear'] as const) assert.deepEqual((await resized(source, { kind: 'original' }, quality)).pixels, source.pixels);
	for (const sizing of [{ kind: 'percentage', percentage: 50 }, { kind: 'long-edge', pixels: 2, allowUpscale: true }, { kind: 'fit', width: 2, height: 2, allowUpscale: false }]) {
		const output = await resized(source, sizing, 'nearest'); assert.equal(output.descriptor.width, 2); assert.equal(output.descriptor.height, 1);
	}
	const one = await resized(source, { kind: 'megapixels', megapixels: .000001, allowUpscale: false }, 'nearest');
	assert.equal(one.descriptor.width * one.descriptor.height, 1);
});

test('nearest output keeps established top-left sampling and adjacent native-word/subnormal distinctions', async () => {
	const source = frame([32767 / 65535, 32768 / 65535, 32769 / 65535, 1, -2, 3, 2 ** -149, .375]);
	const output = await resized(source, { kind: 'percentage', percentage: 200 }, 'nearest');
	assert.equal(output.descriptor.width, 4); assert.equal(output.descriptor.height, 2);
	for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) assert.deepEqual(output.pixels.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 4), source.pixels.slice(Math.floor(x / 2) * 4, Math.floor(x / 2) * 4 + 4));
	assert.notEqual(output.pixels[0], output.pixels[1]); assert.notEqual(output.pixels[1], output.pixels[2]);
});

test('bilinear output filters linear premultiplied HDR RGB and straight alpha without hidden-color bleed', async () => {
	const sizing = { kind: 'fit', width: 1, height: 1, allowUpscale: false };
	const output = await resized(frame([-2, 0, 0, .25, 0, 0, 4, .75]), sizing, 'bilinear');
	assert.deepEqual(output.pixels, new Float32Array([-.5, 0, 3, .5]));
	const transparent = await resized(frame([100, -50, 20, 0, -.5, .25, 2, 1]), sizing, 'bilinear');
	assert.deepEqual(transparent.pixels, new Float32Array([-.5, .25, 2, .5]));
	const linear = await resized(frame([0, 0, 0, 1, 1, 1, 1, 1]), sizing, 'bilinear');
	assert.deepEqual(linear.pixels, new Float32Array([.5, .5, .5, 1])); assert.equal(byte(linear.pixels[0]!), 188);
	// The permanent encoded-byte filter intentionally gives128 for this contrast;
	// its coordinates are shared, while the new filter's color domain is linear.
	const old = await withExportResizedPixelFrameV1({ frame: graphic([0, 0, 0, 255, 255, 255, 255, 255]), sizing, quality: 'bilinear' }, view => [...view.pixels], { limits: LIMITS });
	assert.deepEqual(old, [128, 128, 128, 255]);
});

test('bilinear output retains centered-contain coordinates and rounded natural sizing', async () => {
	const output = await resized(frame([0, 0, 0, 1, 2, 2, 2, 1]), { kind: 'percentage', percentage: 150 }, 'bilinear');
	assert.equal(output.descriptor.width, 3); assert.equal(output.descriptor.height, 2);
	for (let y = 0; y < 2; y++) for (const [x, value] of [0, 1, 2].entries()) close(output.pixels[(y * 3 + x) * 4]!, value);
});

test('native graphic and glyph overlay uses true linear alpha-over with HDR source and independently preserved alpha', async () => {
	const output = await marked(frame([-2, 3, .5, .25]), graphic([255, 0, 0, 128]), place('middle-center', 1, 0, .5));
	for (const [index, value] of [-42 / 149, 191 / 149, 191 / 894, 149 / 340].entries()) close(output[index]!, value);
	assert.ok(output[0]! < 0); assert.ok(output[1]! > 1);
	const tinyCoverage = await marked(frame([0, 0, 0, 1, 0, 0, 0, 1]), graphic([255, 255, 255, 1, 255, 255, 255, 2]));
	close(tinyCoverage[0]!, 1 / 255); close(tinyCoverage[4]!, 2 / 255); assert.notEqual(tinyCoverage[0], tinyCoverage[4]);
});

test('all nine watermark anchors and shared fractional-margin placement fit only the graphic', async () => {
	const source = frame(Array.from({ length: 15 }, () => [0, 0, 0, 1]).flat(), 5, 3), mark = graphic([255, 0, 0, 255]);
	for (const [vertical, y] of [['top', 0], ['middle', 1], ['bottom', 2]] as const) for (const [horizontal, x] of [['left', 0], ['center', 2], ['right', 4]] as const) {
		const output = await marked(source, mark, place(`${vertical}-${horizontal}`, .2));
		for (let index = 0; index < 15; index++) assert.equal(output[index * 4], index === y * 5 + x ? 1 : 0);
	}
	const placement = imageExportGraphicPlacement({ anchor: 'bottom-right', widthFraction: .2, marginFraction: .49, opacity: 1 }, 5, 3);
	const output = await marked(source, mark, placement); assert.equal(output[(1 * 5 + 3) * 4], 1); assert.equal(output[0], 0);
});

test('graphic bilinear fitting decodes its RGB before premultiplied filtering and leaves zero coverage exact', async () => {
	const source = frame([2, -.5, .125, .25]);
	const output = await marked(source, graphic([255, 0, 0, 0, 0, 0, 255, 255]));
	// Half-opacity blue over alpha.25: outputalpha.625, premultRGBA[.25,-.0625,.515625,.625].
	for (const [index, value] of [.4, -.1, .825, .625].entries()) close(output[index]!, value);
	assert.deepEqual(await marked(source, graphic([255, 255, 255, 0])), source.pixels);
	assert.deepEqual(await marked(source, graphic([255, 255, 255, 255]), place('middle-center', 1, 0, 0)), source.pixels);
	assert.deepEqual(await marked(frame([100, -50, 2 ** -149, 0]), graphic([255, 255, 255, 0])), new Float32Array([100, -50, 2 ** -149, 0]));
});

test('unchanged byte owners remain a nearest/constant-graphic baseline after explicit native presentation', async () => {
	const pixels = [64, 128, 192, 255, 192, 64, 128, 128], source = frame(pixels.map((value, index) => index % 4 === 3 ? value / 255 : decode(value / 255)));
	const sizing = { kind: 'percentage', percentage: 200 }, output = await resized(source, sizing, 'nearest');
	const old = await withExportResizedPixelFrameV1({ frame: graphic(pixels), sizing, quality: 'nearest' }, view => [...view.pixels], { limits: LIMITS });
	for (let index = 0; index < output.pixels.length; index++) assert.equal(index % 4 === 3 ? Math.round(output.pixels[index]! * 255) : byte(output.pixels[index]!), old[index]);
	const mark = graphic([128, 64, 192, 128]), placement = place('middle-center', 1, 0, .5), markedOutput = await marked(source, mark, placement);
	const baseline = await withGraphicWatermarkPixelFrameV1({ frame: graphic(pixels), graphic: mark, placement }, view => [...view.pixels], { limits: LIMITS, maximumWorkingBytes: 268_435_456 });
	for (let index = 0; index < markedOutput.length; index++) assert.ok(Math.abs((index % 4 === 3 ? Math.round(markedOutput[index]! * 255) : byte(markedOutput[index]!)) - baseline[index]!) <= 1);
});

test('output metadata is owned before pixels; forged plans, profile drift, padding and aliases refuse before writes', async () => {
	const source = frame([.25, .5, .75, 1]), plan = prepareLinearExportResizeV1({ kind: 'original' }, 'nearest', source.descriptor, LIMITS);
	const target = new Float32Array(4).fill(19); assert.ok(Object.isFrozen(plan));
	await assert.rejects(writeLinearExportResizeV1({ ...plan }, source, target), /owning|authenticated/u); assert.equal(target[0], 19);
	await assert.rejects(writeLinearExportResizeV1(plan, source, source.pixels));
	await assert.rejects(writeLinearExportResizeV1(plan, { ...source, descriptor: { ...source.descriptor, primaries: 'bt709' } }, target));
	await assert.rejects(writeLinearExportResizeV1(plan, { ...source, pixels: new Float32Array(new ArrayBuffer(32), 4, 4) }, target));
	assert.throws(() => prepareLinearExportResizeV1({ kind: 'percentage', percentage: 0 }, 'nearest', source.descriptor, LIMITS));
	assert.throws(() => prepareLinearExportResizeV1({ kind: 'original' }, 'future', source.descriptor, LIMITS));
	const mark = graphic([255, 0, 0, 255]), overlay = prepareLinearGraphicOverlayV1(place(), mark.descriptor, source.descriptor, LIMITS);
	await assert.rejects(writeLinearGraphicOverlayV1(overlay, source, { ...mark, pixels: new Uint8Array(new ArrayBuffer(8), 1, 4) } as PixelFrameV1, target));
	assert.equal(target[0], 19);
});

test('real output task yields retain opaque cancellation and pinned detach checks without mutating source or graphic', async () => {
	for (const overlay of [false, true]) {
		const source = frame(Array.from({ length: 128 * 128 }, () => [.25, .5, 2, 1]).flat(), 128, 128), before = source.pixels.slice(), target = new Float32Array(source.pixels.length);
		const controller = new AbortController(), reason = Object.create(null) as object, mark = graphic([255, 0, 0, 255]);
		setTimeout(() => { controller.abort(reason); }, 0);
		const operation = overlay ? writeLinearGraphicOverlayV1(prepareLinearGraphicOverlayV1(place(), mark.descriptor, source.descriptor, LIMITS), source, mark, target, controller.signal)
			: writeLinearExportResizeV1(prepareLinearExportResizeV1({ kind: 'original' }, 'bilinear', source.descriptor, LIMITS), source, target, controller.signal);
		try { await operation; assert.fail('expected cancellation'); } catch (error) { assert.equal(error, reason); }
		assert.deepEqual(source.pixels, before); assert.deepEqual([...mark.pixels], [255, 0, 0, 255]);
	}
	const source = frame(Array.from({ length: 128 * 128 }, () => [.25, .5, 2, 1]).flat(), 128, 128), target = new Float32Array(source.pixels.length);
	const plan = prepareLinearExportResizeV1({ kind: 'original' }, 'nearest', source.descriptor, LIMITS);
	setTimeout(() => { structuredClone(target.buffer, { transfer: [target.buffer] }); }, 0);
	await assert.rejects(writeLinearExportResizeV1(plan, source, target), /detached|changed/u);
});
