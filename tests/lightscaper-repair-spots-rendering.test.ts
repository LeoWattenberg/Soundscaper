/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withRepairSpotsPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-repair-spots-v1.ts';

const PROFILE = { limits: { maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 64 * 1024 * 1024 } };
type Spot = { id: string; mode: 'clone' | 'heal'; enabled: boolean; target: { x: number; y: number };
	source: { x: number; y: number }; radius: number; feather: number; opacity: number };
function spot(mode: Spot['mode'], changes: Partial<Spot> = {}): Spot {
	return { id: 'repair', mode, enabled: true, target: { x: 0.5, y: 0.5 },
		source: { x: 0.5, y: 0.5 }, radius: 0.2, feather: 0, opacity: 1, ...changes };
}
function frame(width: number, height: number, gray = 0) {
	const pixels = new Uint8Array(width * height * 4);
	for (let index = 0; index < pixels.length; index += 4) pixels.set([gray, gray, gray, 255], index);
	return { descriptor: { schemaVersion: 1 as const, width, height, sampleFormat: 'unorm8' as const,
		primaries: 'srgb' as const, transfer: 'srgb' as const }, pixels };
}
function put(value: ReturnType<typeof frame>, x: number, y: number, rgba: readonly number[]) {
	value.pixels.set(rgba, (y * value.descriptor.width + x) * 4);
}
function patch(value: ReturnType<typeof frame>, left: number, top: number, width: number, height: number, gray: number) {
	for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) put(value, x, y, [gray, gray, gray, 255]);
}
function pixel(bytes: readonly number[], width: number, x: number, y: number) {
	return bytes.slice((y * width + x) * 4, (y * width + x + 1) * 4);
}
async function render(value: ReturnType<typeof frame>, spots: readonly Spot[]) {
	const original = value.pixels.slice();
	const result = await withRepairSpotsPixelFrameV1({ frame: value, repairs: { schemaVersion: 1, spots } }, output => {
		assert.deepEqual(output.descriptor, value.descriptor); assert.notEqual(output.pixels, value.pixels);
		return [...output.pixels];
	}, PROFILE);
	assert.deepEqual(value.pixels, original, 'The caller-owned original must remain byte exact');
	return result;
}
function unchangedExcept(actual: readonly number[], original: Uint8Array, indices: readonly number[]) {
	const expected = [...original];
	for (const index of indices) expected.splice(index * 4, 4, ...actual.slice(index * 4, index * 4 + 4));
	assert.deepEqual(actual, expected);
}
function twoCell() {
	const value = frame(10, 5); patch(value, 0, 1, 4, 3, 64);
	for (const [x, y] of [[8, 2], [7, 1], [7, 3]]) put(value, x!, y!, [255, 255, 255, 255]);
	return value;
}
function separateDonors() {
	const value = frame(11, 3); patch(value, 0, 0, 3, 3, 32); put(value, 1, 1, [64, 64, 64, 255]);
	patch(value, 4, 0, 3, 3, 64); put(value, 5, 1, [192, 192, 192, 255]);
	patch(value, 8, 0, 3, 3, 128); put(value, 9, 1, [0, 0, 0, 255]); return value;
}

test('Heal reconstructs two distinct boundary solutions rather than cloning or applying a mean offset', async () => {
	const value = twoCell(), definition = spot('heal', { target: { x: 0.7, y: 0.5 }, source: { x: 0.2, y: 0.5 }, radius: 0.15 });
	const healed = await render(value, [definition]), cloned = await render(value, [{ ...definition, mode: 'clone' }]);
	// Flat donor guidance and paired boundary mean .5 give 5uL-uR=.5, 5uR-uL=3.5.
	// Thus linear RGB is (.25,.75); the independent encoded-sRGB literals are (137,225).
	assert.deepEqual(pixel(healed, 10, 6, 2), [137, 137, 137, 255]);
	assert.deepEqual(pixel(healed, 10, 7, 2), [225, 225, 225, 255]);
	assert.deepEqual(pixel(cloned, 10, 6, 2), [64, 64, 64, 255]);
	assert.deepEqual(pixel(cloned, 10, 7, 2), [64, 64, 64, 255]);
	assert.notDeepEqual([healed[104], healed[108]], [188, 188], 'A boundary offset alone is not Heal');
	unchangedExcept(healed, value.pixels, [26, 27]); unchangedExcept(cloned, value.pixels, [26, 27]);
});

test('moving a Heal source changes its guidance while original target context stays unchanged', async () => {
	const value = separateDonors(), definition = spot('heal', { target: { x: 9.5 / 11, y: 0.5 }, source: { x: 1.5 / 11, y: 0.5 } });
	const first = await render(value, [definition]);
	const moved = await render(value, [{ ...definition, source: { x: 5.5 / 11, y: 0.5 } }]);
	// Single-cell solutions are D(128)+D(64)-D(32) and D(128)+D(192)-D(64).
	assert.deepEqual(pixel(first, 11, 9, 1), [138, 138, 138, 255]);
	assert.deepEqual(pixel(moved, 11, 9, 1), [217, 217, 217, 255]);
	unchangedExcept(first, value.pixels, [20]); unchangedExcept(moved, value.pixels, [20]);
});

test('Clone bilinear sampling is premultiplied linear RGB and attenuates by donor alpha only once', async () => {
	const value = frame(6, 3);
	for (const [x, y, rgba] of [[0, 0, [255, 0, 0, 255]], [1, 0, [0, 255, 0, 255]],
		[0, 1, [0, 0, 255, 255]], [1, 1, [255, 255, 255, 255]]] as const) put(value, x, y, rgba);
	put(value, 4, 1, [0, 0, 0, 128]);
	const definition = spot('clone', { target: { x: 4.5 / 6, y: 0.5 }, source: { x: 1 / 6, y: 1 / 3 } });
	const opaque = await render(value, [definition]);
	assert.deepEqual(pixel(opaque, 6, 4, 1), [188, 188, 188, 128]); // E(.5), not encoded average 128.
	put(value, 1, 0, [255, 255, 255, 0]); put(value, 0, 1, [13, 237, 91, 0]); put(value, 1, 1, [203, 17, 255, 0]);
	const transparent = await render(value, [definition]);
	assert.deepEqual(pixel(transparent, 6, 4, 1), [137, 0, 0, 128]); // E(.25), not E(.25*.25).
	unchangedExcept(transparent, value.pixels, [10]);
});

test('missing bilinear taps remain transparent at image edges and unavailable donors are exact no-ops', async () => {
	const value = frame(5, 3); put(value, 0, 1, [255, 0, 0, 255]);
	const edge = spot('clone', { target: { x: 3.5 / 5, y: 0.5 }, source: { x: 0, y: 0.5 } });
	assert.deepEqual(pixel(await render(value, [edge]), 5, 3, 1), [188, 0, 0, 255]); // Half the taps are missing.
	const single = frame(1, 1); put(single, 0, 0, [73, 29, 151, 255]);
	const unavailable = spot('clone', { target: { x: 1, y: 0.5 }, source: { x: 0, y: 0.5 }, radius: 1 });
	assert.deepEqual(await render(single, [unavailable]), [...single.pixels]);
	put(single, 0, 0, [73, 29, 151, 0]);
	assert.deepEqual(await render(single, [spot('clone', { radius: 1 })]), [73, 29, 151, 0]);
});

test('partial alpha Heal retains target alpha and zero-alpha targets retain hidden RGB exactly', async () => {
	const value = separateDonors(); put(value, 1, 1, [64, 64, 64, 128]); put(value, 9, 1, [0, 0, 0, 128]);
	const definition = spot('heal', { target: { x: 9.5 / 11, y: 0.5 }, source: { x: 1.5 / 11, y: 0.5 } });
	assert.deepEqual(pixel(await render(value, [definition]), 11, 9, 1), [100, 100, 100, 128]);
	put(value, 9, 1, [97, 31, 219, 0]);
	assert.deepEqual(await render(value, [definition]), [...value.pixels]);
});

test('ordered Clone overlaps blend current destinations while every donor remains the immutable original', async () => {
	const value = frame(5, 1); [0, 64, 128, 192, 255].forEach((gray, x) => put(value, x, 0, [gray, gray, gray, 255]));
	const first = spot('clone', { id: 'first', target: { x: 0.7, y: 0.5 }, source: { x: 0.3, y: 0.5 }, radius: 0.1 });
	const second = spot('clone', { id: 'second', target: { x: 0.7, y: 0.5 }, source: { x: 0.5, y: 0.5 }, radius: 0.1, opacity: 0.5 });
	assert.deepEqual(pixel(await render(value, [first, second]), 5, 3, 0), [102, 102, 102, 255]);
	assert.deepEqual(pixel(await render(value, [second, first]), 5, 3, 0), [64, 64, 64, 255]);
	const reused = await render(value, [
		{ ...first, target: { x: 0.5, y: 0.5 }, source: { x: 0.1, y: 0.5 } },
		{ ...second, target: { x: 0.9, y: 0.5 }, source: { x: 0.5, y: 0.5 }, opacity: 1 },
	]);
	assert.deepEqual(pixel(reused, 5, 2, 0), [0, 0, 0, 255]); assert.deepEqual(pixel(reused, 5, 4, 0), [128, 128, 128, 255]);
});

test('ordered Heal overlaps keep original boundary solves and deterministic repeat output', async () => {
	const value = separateDonors(), first = spot('heal', { id: 'first', target: { x: 9.5 / 11, y: 0.5 },
		source: { x: 1.5 / 11, y: 0.5 }, opacity: 0.5 });
	const second = { ...first, id: 'second', source: { x: 5.5 / 11, y: 0.5 } };
	const forward = await render(value, [first, second]), reverse = await render(value, [second, first]);
	assert.deepEqual(pixel(forward, 11, 9, 1), [171, 171, 171, 255]);
	assert.deepEqual(pixel(reverse, 11, 9, 1), [149, 149, 149, 255]);
	unchangedExcept(forward, value.pixels, [20]);
	for (let run = 0; run < 3; run++) assert.deepEqual(await render(value, [first, second]), forward);
});

test('feather and opacity interpolate decoded RGB with exact hard and zero coverage endpoints', async () => {
	const value = frame(9, 5); patch(value, 0, 0, 5, 5, 255);
	const definition = spot('clone', { target: { x: 7.5 / 9, y: 0.5 }, source: { x: 2.5 / 9, y: 0.5 }, radius: 0.4, feather: 1 });
	const soft = await render(value, [definition]);
	assert.deepEqual(pixel(soft, 9, 5, 2), [0, 0, 0, 255]); assert.deepEqual(pixel(soft, 9, 6, 2), [188, 188, 188, 255]);
	assert.deepEqual(pixel(soft, 9, 7, 2), [255, 255, 255, 255]); assert.deepEqual(pixel(soft, 9, 8, 2), [188, 188, 188, 255]);
	const hard = await render(value, [{ ...definition, feather: 0 }]); assert.deepEqual(pixel(hard, 9, 5, 2), [255, 255, 255, 255]);
	const half = await render(value, [{ ...definition, radius: 0.1, feather: 0, opacity: 0.5 }]);
	assert.deepEqual(pixel(half, 9, 7, 2), [188, 188, 188, 255]); unchangedExcept(half, value.pixels, [25]);
});

test('nonempty Heal with no paired boundary context refuses instead of silently cloning; empty domains are unchanged', async () => {
	const value = frame(1, 1, 64); let delivered = 0;
	await assert.rejects(withRepairSpotsPixelFrameV1({ frame: value, repairs: { schemaVersion: 1, spots: [spot('heal', { radius: 1 })] } },
		() => { delivered++; }, PROFILE), /context|boundary/iu);
	assert.equal(delivered, 0); assert.deepEqual([...value.pixels], [64, 64, 64, 255]);
	put(value, 0, 0, [231, 19, 47, 0]); assert.deepEqual(await render(value, [spot('heal', { radius: 1 })]), [...value.pixels]);
	assert.deepEqual(await render(value, [spot('heal', { target: { x: 0, y: 0 }, radius: 0.1 })]), [...value.pixels]);
});

test('disabled and zero-opacity repairs are exact no-ops and generated integer donors preserve arbitrary target alpha', async () => {
	const original = twoCell(), active = spot('heal', { target: { x: 0.7, y: 0.5 }, source: { x: 0.2, y: 0.5 }, radius: 0.15 });
	assert.deepEqual(await render(original, [{ ...active, enabled: false }]), [...original.pixels]);
	assert.deepEqual(await render(original, [{ ...active, opacity: 0 }]), [...original.pixels]);
	assert.deepEqual(await render(original, []), [...original.pixels]);
	for (let sample = 0; sample < 24; sample++) {
		const value = frame(3, 1), donor = [(sample * 37) % 256, (sample * 91) % 256, (sample * 13) % 256, 255];
		const alpha = sample * 11 % 256; put(value, 0, 0, donor); put(value, 2, 0, [17, 29, 43, alpha]);
		const result = await render(value, [spot('clone', { target: { x: 5 / 6, y: 0.5 }, source: { x: 1 / 6, y: 0.5 }, radius: 0.1 })]);
		assert.deepEqual(pixel(result, 3, 2, 0), alpha === 0 ? [17, 29, 43, 0] : [...donor.slice(0, 3), alpha]);
	}
});
