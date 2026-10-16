/* SPDX-License-Identifier: AGPL-3.0-only */

import { fileURLToPath } from 'node:url';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';

test.use({ browserCoverage: false });
test.skip(({ browserName }) => test.info().project.name !== 'lightscaper-software-gpu' && browserName !== 'firefox',
	'Geometry conformance requires pinned software Chromium or actual Firefox capability/fallback.');
const PROGRAM = '/__lightscaper_native_gpu_geometry_current.js';
let program;
test.beforeAll(async () => {
	program = await compileNativeImageHandoffScript('native-gpu-geometry-current.js', fileURLToPath(new URL('./helpers/lightscaper-native-gpu-geometry-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]);
});
const effect = params => ({ id: 'geometry', type: 'develop-geometry-v1', enabled: true, params });
const legacy = params => ({ crop: null, rotationDegrees: 0, flipHorizontal: false, flipVertical: false, ...params });
const opaqueGrid = () => Array.from({ length: 15 }, (_, i) => [i + 1, -2 - (i + 1) / 8, (i + 1) / 1024, 1]).flat();
const permutation = (source, indices) => indices.flatMap(index => source.slice(index * 4, index * 4 + 4));

test('odd3×5 legacy quarterturn executes an exact5×3 native integer permutation', async ({ page }) => {
	const values = opaqueGrid(), value = await run(page, { width: 3, height: 5, values, geometry: legacy({ rotationDegrees: 90 }) });
	accepted(value, [[9, 5, 3]], true, true);
	expect(value.values).toEqual(permutation(values, [12, 9, 6, 3, 0, 13, 10, 7, 4, 1, 14, 11, 8, 5, 2]));
});

test('authored integer crop plus quarterturn and output flip changes3×5 to5×2 without resampling', async ({ page }) => {
	const values = opaqueGrid(), value = await run(page, { width: 3, height: 5, values,
		effects: [effect({ cropX: 1 / 3, cropWidth: 2 / 3, rotationDegrees: 90, flipHorizontal: 1 })] });
	accepted(value, [[9, 5, 2]], true, true);
	expect(value.values).toEqual(permutation(values, [1, 4, 7, 10, 13, 2, 5, 8, 11, 14]));
});

test('explicit identity geometry clears hidden RGBA and canonicalizes signed RGB zero on the GPU', async ({ page }) => {
	for (const [values, expected] of [[[7, -4, 2, 0], [0, 0, 0, 0]], [[-0, .25, -0, 1], [0, .25, 0, 1]]]) {
		const value = await run(page, { width: 1, height: 1, values, effects: [effect({})] });
		accepted(value, [[9, 1, 1]], true, true); expect(value.values).toEqual(expected); expect(value.bits).toEqual(floatBits(expected));
	}
});

test('dyadic fractional crop then clockwise permutation uses unrounded premultiplied alpha', async ({ page }) => {
	const value = await run(page, { width: 2, height: 2, values: [0, 0, 0, .25, 1, 2, -1, .75, 4, -4, 1, 1, 100, 200, 8, 0],
		effects: [effect({ cropX: .25, cropWidth: .5, rotationDegrees: 90 })] });
	accepted(value, [[9, 2, 1]]); expect(value.expected.values).toEqual([4, -4, 1, .5, .75, 1.5, -.75, .5]);
	expect(value.bits).toEqual(floatBits([4, -4, 1, .5, .75, 1.5, -.75, .5]));
});

test('perspective rectification has independent rational native samples and exact opaque alpha', async ({ page }) => {
	const value = await run(page, { width: 2, height: 2, values: [0, .125, -0, 1, 100, 100.125, -100, 1, 50, 50.125, -50, 1, 150, 150.125, -150, 1],
		effects: [effect({ perspective: 1, bottomRightX: .75, bottomLeftX: .25 })] });
	accepted(value, [[9, 2, 2]]);
	for (const [index, red] of [25, 105, 500 / 7, 900 / 7].entries()) {
		expect(value.expected.values.slice(index * 4, index * 4 + 4)).toEqual([Math.fround(red), Math.fround(red + .125), Math.fround(-red), 1]);
	}
});

test('non-quarter rotation preserves transparent corners and fractional HDR center or truthfully falls back', async ({ page }) => {
	const values = [-2, -1.875, 2, 1, .125, .25, -.125, 1, 4, 4.125, -4, 1, 8, 8.125, -8, 1];
	const value = await run(page, { width: 2, height: 2, values, effects: [effect({ rotationDegrees: 45 })] });
	accepted(value, [[9, 3, 3]], false); expect(value.expected.values.slice(0, 4)).toEqual([0, 0, 0, 0]);
	expect(value.expected.values.slice(16, 20)).toEqual([2.53125, 2.65625, -2.53125, 1]);
});

test('color→geometry→verified LUT→geometry preserves authored order through two changing extents', async ({ page }) => {
	const values = Array.from({ length: 15 }, (_, i) => [(i + 1) / 32, (i + 2) / 32, (i + 3) / 32, 1]).flat();
	const value = await run(page, { width: 3, height: 5, values, mixed: true });
	accepted(value, [[1, 3, 5], [9, 5, 2], [8, 5, 2], [9, 2, 5]]);
	const expected = permutation(values, [14, 13, 11, 10, 8, 7, 5, 4, 2, 1]).map((n, at, pixels) => at % 4 === 0
		? pixels[at + 2] * .5 : at % 4 === 2 ? pixels[at - 2] * 2 : n);
	expect(value.values).toEqual(expected); expect(value.sourceCalls).toBeGreaterThan(0); expect(value.maximumActive).toBe(1); expect(value.sourceActiveAtDelivery).toBe(0);
});

test('tiny-alpha interpolation retains the actual CPU zero/alpha rules before any GPU delivery', async ({ page }) => {
	const value = await run(page, { width: 2, height: 1, values: [100, -100, 8, 0, -2, 4, 1 / 65535, 2 ** -149],
		effects: [effect({ cropX: .25, cropWidth: .5 })] });
	accepted(value, [[9, 1, 1]], false); expect(value.expected.values).toEqual([0, 0, 0, 0]); expect(value.bits).toEqual(value.expected.bits);
});

for (const fault of ['preabort', 'held-abort', 'opaque', 'held-loss']) test(`${fault}: changed-extent native result, source and resources join before physical retirement`, async ({ page }) => {
	const values = Array.from({ length: 15 }, (_, i) => [(i + 1) / 32, (i + 2) / 32, (i + 3) / 32, 1]).flat();
	const value = await run(page, { width: 3, height: 5, values, mixed: true, fault });
	expect(value.sourceBits).toEqual(value.before); expect(value.sourceRetired).toBe(true); retired(value.observation);
	if (fault === 'preabort') { expect(value.rejected).toBe(true); expect(value.exactReason).toBe(true); expect(value.callbacks).toBe(0); expect(value.pixelReads).toBe(0); expect(value.sourceCalls).toBe(0); expect(value.observation.attempts).toBe(0); }
	else {
		expect(value.callbacks).toBe(1); expect(value.outputRetired).toBe(true);
		if (fault.startsWith('held-')) { expect(value.pending).toBe(true); expect(value.heldNonzero).toBe(true); }
		if (fault !== 'held-loss') { expect(value.rejected).toBe(true); expect(value.exactReason).toBe(true); }
		if (test.info().project.name === 'lightscaper-software-gpu') { expect(value.backend).toBe('webgl2'); if (fault === 'held-loss') { expect(value.loss).toBe(true); expect(value.rejected).toBe(true); } }
	}
});

async function run(page, value) { await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source }));
	await page.goto(resolveBrowserProductTestUrl('/lightscaper/en/')); return page.evaluate(async ({ path, value }) => (await import(path)).qualifyNativeGpuGeometryCurrentV1(value), { path: PROGRAM, value }); }
function accepted(value, stages, positive = true, exact = false) {
	expect(value.rejected).toBe(false); expect(value.callbacks).toBe(1); expect(value.sourceBits).toEqual(value.before); expect(value.sourceRetired).toBe(true); expect(value.outputRetired).toBe(true); retired(value.observation);
	expect(value.descriptor).toEqual(value.expected.descriptor); expect(value.byteOffset).toBe(0); expect(value.byteLength).toBe(value.descriptor.width * value.descriptor.height * 16);
	if (positive && (test.info().project.name === 'lightscaper-software-gpu' || value.observation.normalFloatSupported)) expect(value.backend, value.reason).toBe('webgl2');
	if (value.backend === 'cpu') { expect(typeof value.reason).toBe('string'); expect(value.bits).toEqual(value.expected.bits); return; }
	expect(value.observation.geometryPrograms).toBeGreaterThan(0); const read = value.observation.readbacks.at(-1); expect(read).toBeTruthy();
	expect([read.width, read.height]).toEqual([value.descriptor.width, value.descriptor.height]); expect(read.bits).toEqual(value.bits);
	expect(read.passes.map(pass => [pass.kind, pass.width, pass.height])).toEqual(stages);
	if (exact) { expect(read.passes.filter(pass => pass.kind === 9).every(pass => pass.integer === 1)).toBe(true); expect(value.bits).toEqual(value.expected.bits); }
	else for (let at = 0; at < value.bits.length; at++) { const expected = value.expected.values[at], n = value.expected.bits[at];
		if (at % 4 === 3 || expected === 0 || Math.abs(expected) < 2 ** -60) expect(value.bits[at], `exact sample${at}`).toBe(n);
		else expect(Math.abs(ordered(value.bits[at]) - ordered(n)), `8ULP sample${at}`).toBeLessThanOrEqual(8); }
	expect(value.observation.sourceUploads.some(source => source.every((n, at) => n === value.before[at]))).toBe(true);
}
function retired(value) { expect(value.aliveHandles).toBe(0); expect(value.readbacksRetired).toBe(true); expect(value.uploadBackingsRetired).toBe(true); expect(value.changingReadbacksRetired).toBe(true);
	for (const kind of Object.keys(value.created)) expect(value.deleted[kind], kind).toBe(value.created[kind]);
	if (test.info().project.name === 'lightscaper-software-gpu') for (const context of value.contexts) expect(context.renderer).toContain('SwiftShader'); }
function floatBits(values) { return [...new Uint32Array(Float32Array.from(values).buffer)]; }
function ordered(bits) { return bits & 0x80000000 ? 0x80000000 - (bits & 0x7fffffff) : 0x80000000 + bits; }
