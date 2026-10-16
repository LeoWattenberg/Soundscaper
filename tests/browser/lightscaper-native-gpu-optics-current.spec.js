/* SPDX-License-Identifier: AGPL-3.0-only */

import { fileURLToPath } from 'node:url';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';

test.use({ browserCoverage: false });
test.skip(({ browserName }) => test.info().project.name !== 'lightscaper-software-gpu' && browserName !== 'firefox',
	'Native optics conformance requires pinned software Chromium or actual Firefox capability/fallback.');
const PROGRAM = '/__lightscaper_native_gpu_optics_current.js';
let program;
test.beforeAll(async () => {
	program = await compileNativeImageHandoffScript('native-gpu-optics-current.js', fileURLToPath(new URL('./helpers/lightscaper-native-gpu-optics-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]);
});
const effect = (type, params, id = type) => ({ id, type, enabled: true, params });
const lens = amount => effect('lens-distortion-v1', { amount });
const ca = (red, blue) => effect('chromatic-aberration-v1', { red, blue });
const fringe = (purple, green, edgeThreshold = 25) => effect('defringe-v1', { purple, green, edgeThreshold });
const optical = amount => effect('optical-vignette-v1', { amount });
const gray = n => ((n + .055) / 1.055) ** 2.4;
const f32 = values => values.map(Math.fround);

test('native lens10 filters signed HDR with independent inward radial rational literals', async ({ page }) => {
	const values = [-2, 4, .125, 1, 2, -4, .25, 1, 6, 8, .5, 1];
	const value = await run(page, { width: 3, height: 1, values, effects: [lens(-100)] }); accepted(value, [[10, 3, 1]]);
	// r²=.4 and inward displacement=.12: linear RGB uses .88/.12 taps.
	expect(value.expected.values).toEqual(f32([-38 / 25, 76 / 25, 7 / 50, 1, 2, -4, .25, 1, 138 / 25, 164 / 25, 47 / 100, 1]));
});

test('non-dyadic inward lens alpha drift truthfully refuses after a real draw while outward zero extension remains qualified', async ({ page, browserName }) => {
	const value = await run(page, { width: 3, height: 1, values: [2, -.5, .125, 1, 0, 1, 4, .5, 8, 2, -2, 0], effects: [lens(-100)] });
	accepted(value, [[10, 3, 1]], false);
	expect(value.expected.values).toEqual(f32([88 / 47, -19 / 47, 35 / 94, .94, 0, 1, 4, .5, 0, 1, 4, .06]));
	if (test.info().project.name === 'lightscaper-software-gpu' || value.observation.normalFloatSupported) {
		expect(value.observation.opticsPrograms).toBeGreaterThan(0);
		expect(value.observation.readbacks.some(read => read.passes.some(pass => pass.kind === 10))).toBe(true);
	}
	if (browserName === 'chromium') { expect(value.backend).toBe('cpu'); expect(value.reason).toBe('numeric-range'); expect(value.bits).toEqual(value.expected.bits); }
	const outward = await run(page, { width: 3, height: 1, values: [2, -.5, .125, .5, 3, 4, 5, 1, 100, -100, 8, 0], effects: [lens(100)] });
	accepted(outward, [[10, 3, 1]]); expect(outward.expected.values).toEqual(f32([2, -.5, .125, .44, 3, 4, 5, 1, 0, 0, 0, 0]));
});

test('dyadic inward and outward lens filters qualify real GPU fractional alpha and transparent support', async ({ page }) => {
	const values = [2, -.5, .125, 1, 0, 1, 4, .5, 8, 2, -2, 0];
	// Amount gives exact k=±5/32 and edge displacement±1/16. Alpha is
	// therefore exactly representable; its precision contract stays exact.
	for (const [amount, expected] of [[-52.083333333333336, [60 / 31, -14 / 31, 1 / 4, 31 / 32, 0, 1, 4, .5, 0, 1, 4, 1 / 32]],
		[52.083333333333336, [2, -.5, .125, 15 / 16, 0, 1, 4, .5, 0, 0, 0, 0]]]) {
		const value = await run(page, { width: 3, height: 1, values, effects: [lens(amount)] }); accepted(value, [[10, 3, 1]]);
		expect(value.expected.values).toEqual(f32(expected));
	}
});

test('native CA11 reconstructs R from its own unequal-alpha taps and preserves original G A and zero-controlled B', async ({ page }) => {
	const values = [-2, -0, .125, 1, 2, .25, .5, .5, 6, -.5, 4, .25];
	const value = await run(page, { width: 3, height: 1, values, effects: [ca(-100, 0)] }); accepted(value, [[11, 3, 1]]);
	expect(value.expected.values).toEqual(f32([-994 / 499, -0, .125, 1, 2, .25, .5, .5, 1498 / 251, -.5, 4, .25]));
	for (let at = 0; at < values.length; at++) if (at % 4 !== 0) expect(value.bits[at]).toBe(value.before[at]);
});

test('native CA11 outward blue preserves hidden original Green and exact reference alpha', async ({ page }) => {
	const values = [47, -0, 7, 0, 2, .25, .5, .5, 15, -2, 140, 0];
	const value = await run(page, { width: 3, height: 1, values, effects: [ca(0, 100)] }); accepted(value, [[11, 3, 1]]);
	expect(value.expected.values).toEqual([47, -0, 0, 0, 2, .25, .5, .5, 15, -2, 0, 0]);
	for (let at = 0; at < values.length; at++) if (at % 4 !== 2) expect(value.bits[at]).toBe(value.before[at]);
});

for (const [center, luma] of [[[1, 0, 1], 73 / 256], [[0, 1, 0], 183 / 256]]) test(`native defringe12 has an independent full edge-gate ${center.join(',')} gray literal`, async ({ page }) => {
	const value = await run(page, { width: 3, height: 1, values: [0, 0, 0, 1, ...center, 1, 1, 1, 1, 1], effects: [fringe(100, 100)] });
	accepted(value, [[12, 3, 1]]); expect(value.expected.values).toEqual(f32([0, 0, 0, 1, gray(luma), gray(luma), gray(luma), 1, 1, 1, 1, 1]));
});

test('native defringe12 retains a real correction below encoded-byte precision and exact flat regions', async ({ page }) => {
	const values = [0, 0, 0, 1, .001, 0, .001, 1, 1, 1, 1, 1], value = await run(page, { width: 3, height: 1, values, effects: [fringe(100, 0)] });
	accepted(value, [[12, 3, 1]]);
	const r = Math.fround(.001) * 12.92, y = 73 * r / 256, weight = 3 * r;
	expect(value.expected.values).toEqual(f32([0, 0, 0, 1, (r + weight * (y - r)) / 12.92, weight * y / 12.92, (r + weight * (y - r)) / 12.92, 1, 1, 1, 1, 1]));
	expect(value.values[5]).toBeGreaterThan(0); expect(value.values[5]).toBeLessThan(1 / (255 * 12.92));
	const flat = [4, 1e-30, -0, .25, 4, 1e-30, -0, .75, 4, 1e-30, -0, 1];
	const neutral = await run(page, { width: 3, height: 1, values: flat, effects: [fringe(100, 100, 0)] });
	accepted(neutral, [[12, 3, 1]]); expect(neutral.bits).toEqual(floatBits(flat));
});

test('native optical13 multiplies signed HDR by independent2^.8 gain and preserves alpha center black and hidden RGB', async ({ page }) => {
	const values = [2, -.5, .125, .25, 2, -.5, .125, .5, 2, -.5, .125, 1], gain = 2 ** .8;
	const value = await run(page, { width: 3, height: 1, values, effects: [optical(100)] }); accepted(value, [[13, 3, 1]]);
	expect(value.expected.values).toEqual(f32([2 * gain, -.5 * gain, .125 * gain, .25, 2, -.5, .125, .5, 2 * gain, -.5 * gain, .125 * gain, 1]));
	const hidden = [7, -0, 4, 0, 2, -.5, .125, 1, -0, 0, -0, .5], retained = await run(page, { width: 3, height: 1, values: hidden, effects: [optical(100)] });
	accepted(retained, [[13, 3, 1]]); expect(retained.bits).toEqual(floatBits(hidden));
});

test('optical gain uses its actual incoming geometry aperture and does not commute with crop', async ({ page }) => {
	const values = Array.from({ length: 3 }, () => [.125, .25, .5, 1]).flat(), crop = effect('develop-geometry-v1', { cropWidth: 2 / 3 });
	const after = await run(page, { width: 3, height: 1, values, effects: [crop, optical(100)] }); accepted(after, [[9, 2, 1], [13, 2, 1]]);
	const before = await run(page, { width: 3, height: 1, values, effects: [optical(100), crop] }); accepted(before, [[13, 3, 1], [9, 2, 1]]);
	expect(after.expected.values).toEqual(f32(Array.from({ length: 2 }, () => [.125 * 2 ** .4, .25 * 2 ** .4, .5 * 2 ** .4, 1]).flat()));
	expect(before.expected.values).toEqual(f32([.125 * 2 ** .8, .25 * 2 ** .8, .5 * 2 ** .8, 1, .125, .25, .5, 1]));
	expect(after.expected.bits).not.toEqual(before.expected.bits);
});

test('color lens geometry CA verifiedLUT defringe optical execute in authored order on actual native planes', async ({ page }) => {
	const values = Array.from({ length: 9 }, () => [.125, .25, .5, 1]).flat(), value = await run(page, { width: 3, height: 3, values, mixed: true });
	accepted(value, [[1, 3, 3], [10, 3, 3], [9, 3, 3], [11, 3, 3], [8, 3, 3], [12, 3, 3], [13, 3, 3]]);
	expect(value.sourceCalls).toBeGreaterThan(0); expect(value.maximumActive).toBe(1); expect(value.sourceActiveAtDelivery).toBe(0);
	const gain = 2 ** (4 / 9); expect(value.expected.values.slice(0, 4)).toEqual(f32([.25 * gain, .25 * gain, .25 * gain, 1]));
});

for (const [selected, kind] of [[lens(-37.5), 10], [ca(-61.25, 43.75), 11], [fringe(37.5, 62.5, 12.5), 12], [optical(-31.25), 13]]) test(`native optics${kind} whole9×7 signed HDR and varied-alpha corpus delivers within contract or exact wholeCPU`, async ({ page }) => {
	const values = Array.from({ length: 63 }, (_, i) => [((i * 13) % 47 - 11) / 16, ((i * 7) % 31 - 5) / 32, ((i * 19) % 53 - 7) / 16, [0, .25, .5, .75, 1][i % 5]]).flat();
	const value = await run(page, { width: 9, height: 7, values, effects: [selected] }); accepted(value, [[kind, 9, 7]], false);
	if (value.backend === 'cpu' && value.observation.normalFloatSupported) expect(value.reason).toBe('numeric-range');
});

test('CA with a nonrepresentable Float32 coefficient truthfully falls back without losing reconstructed HDR', async ({ page, browserName }) => {
	const values = [47, 31, 7, 0, 3.25, 11, 70, .5, 15, 9, 140, 0], value = await run(page, { width: 3, height: 1, values, effects: [ca(-1e-44, 0)] });
	accepted(value, [[11, 3, 1]], false); expect(value.expected.values).toEqual([3.25, 31, 7, 0, 3.25, 11, 70, .5, 3.25, 9, 140, 0]);
	if (browserName === 'chromium') { expect(value.backend).toBe('cpu'); expect(value.reason).toBe('numeric-range'); }
	expect(value.bits).toEqual(value.expected.bits);
});

test('CA representable coefficient with diagonal weights near1e-49 is checked after a real native optics draw', async ({ page, browserName }) => {
	const values = Array.from({ length: 9 }, (_, at) => [at === 4 ? 3.25 : -2, (at + 1) / 16, (at + 2) / 32, at === 4 ? .5 : 0]).flat();
	const value = await run(page, { width: 3, height: 3, values, effects: [ca(-1e-20, 0)] }); accepted(value, [[11, 3, 3]], false);
	// k=-1e-24 is a nonzero normal Float32 uniform. At a corner, each
	// inward fraction is4e-24/9; only the opaque center's diagonal tap
	// contributes. Its weight8e-48/81 survives Double but underflows F32.
	const expected = values.map((n, at) => at % 4 === 0 ? 3.25 : n);
	expect(value.expected.values).toEqual(expected); expect(value.bits).toEqual(floatBits(expected));
	if (test.info().project.name === 'lightscaper-software-gpu' || value.observation.normalFloatSupported) {
		expect(value.observation.opticsPrograms).toBeGreaterThan(0);
		expect(value.observation.readbacks.some(read => read.passes.some(pass => pass.kind === 11))).toBe(true);
	}
	if (browserName === 'chromium') { expect(value.backend).toBe('cpu'); expect(value.reason).toBe('numeric-range'); }
});

test('neutral and disabled optics keep exact hidden signed zero and subnormal samples without authoring quantization', async ({ page }) => {
	const values = [-0, 2 ** -149, 4, 0, 1e-30, -0, -2, 1];
	for (const effects of [[lens(0), ca(0, 0), fringe(0, 0), optical(0)], [lens(100), ca(100, 100), fringe(100, 100), optical(100)].map(row => ({ ...row, enabled: false }))]) {
		const value = await run(page, { width: 2, height: 1, values, effects }); accepted(value, [], false); expect(value.bits).toEqual(floatBits(values));
	}
});

for (const fault of ['preabort', 'held-abort', 'opaque', 'held-loss']) test(`${fault}: native optics output and source resources remain joined until physical retirement`, async ({ page }) => {
	const values = Array.from({ length: 9 }, () => [.125, .25, .5, 1]).flat(), value = await run(page, { width: 3, height: 3, values, mixed: true, fault });
	expect(value.sourceBits).toEqual(value.before); expect(value.sourceRetired).toBe(true); retired(value.observation);
	if (fault === 'preabort') { expect(value.rejected).toBe(true); expect(value.exactReason).toBe(true); expect(value.callbacks).toBe(0); expect(value.pixelReads).toBe(0); expect(value.sourceCalls).toBe(0); expect(value.observation.attempts).toBe(0); }
	else { expect(value.callbacks).toBe(1); expect(value.outputRetired).toBe(true);
		if (fault.startsWith('held-')) { expect(value.pending).toBe(true); expect(value.heldNonzero).toBe(true); }
		if (fault !== 'held-loss') { expect(value.rejected).toBe(true); expect(value.exactReason).toBe(true); }
		if (test.info().project.name === 'lightscaper-software-gpu') { expect(value.backend).toBe('webgl2'); if (fault === 'held-loss') { expect(value.loss).toBe(true); expect(value.rejected).toBe(true); } }
	}
});

async function run(page, value) { await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source }));
	await page.goto(resolveBrowserProductTestUrl('/lightscaper/en/')); return page.evaluate(async ({ path, value }) => (await import(path)).qualifyNativeGpuOpticsCurrentV1(value), { path: PROGRAM, value }); }
function accepted(value, stages, positive = true) {
	expect(value.rejected).toBe(false); expect(value.callbacks).toBe(1); expect(value.sourceBits).toEqual(value.before); expect(value.sourceRetired).toBe(true); expect(value.outputRetired).toBe(true); retired(value.observation);
	expect(value.descriptor).toEqual(value.expected.descriptor); expect(value.byteOffset).toBe(0); expect(value.byteLength).toBe(value.descriptor.width * value.descriptor.height * 16);
	if (positive && (test.info().project.name === 'lightscaper-software-gpu' || value.observation.normalFloatSupported)) expect(value.backend, value.reason).toBe('webgl2');
	if (value.backend === 'cpu') { expect(typeof value.reason).toBe('string'); expect(value.bits).toEqual(value.expected.bits); return; }
	if (stages.some(stage => stage[0] >= 10)) expect(value.observation.opticsPrograms).toBeGreaterThan(0);
	const read = value.observation.readbacks.at(-1); expect(read).toBeTruthy(); expect([read.width, read.height]).toEqual([value.descriptor.width, value.descriptor.height]); expect(read.bits).toEqual(value.bits);
	expect(read.passes.map(pass => [pass.kind, pass.width, pass.height])).toEqual(stages);
	for (const pass of read.passes) if (pass.kind >= 10) expect(pass.extent).toEqual([pass.width, pass.height]);
	// Geometry, lens and CA reconstruct nonlocal samples. Equal output and
	// Original values at one index do not establish a copied ancestor there;
	// CA's actual copied G/A/zero-controlled channels are checked explicitly.
	const sameIndexAncestor = !stages.some(([kind]) => kind === 9 || kind === 10 || kind === 11);
	for (let at = 0; at < value.bits.length; at++) { const expected = value.expected.values[at], n = value.expected.bits[at];
		if (at % 4 === 3 || expected === 0 || Math.abs(expected) < 2 ** -60 || sameIndexAncestor && n === value.before[at]) expect(value.bits[at], `exact sample${at}`).toBe(n);
		else expect(Math.abs(ordered(value.bits[at]) - ordered(n)), `8ULP sample${at}`).toBeLessThanOrEqual(8); }
	expect(value.observation.sourceUploads.some(source => source.every((n, at) => n === value.before[at]))).toBe(true);
}
function retired(value) { expect(value.aliveHandles).toBe(0); expect(value.readbacksRetired).toBe(true); expect(value.uploadBackingsRetired).toBe(true); expect(value.changingReadbacksRetired).toBe(true); expect(value.opticsReadbacksRetired).toBe(true);
	for (const kind of Object.keys(value.created)) expect(value.deleted[kind], kind).toBe(value.created[kind]);
	if (test.info().project.name === 'lightscaper-software-gpu') for (const context of value.contexts) expect(context.renderer).toContain('SwiftShader'); }
function floatBits(values) { return [...new Uint32Array(Float32Array.from(values).buffer)]; }
function ordered(bits) { return bits & 0x80000000 ? 0x80000000 - (bits & 0x7fffffff) : 0x80000000 + bits; }
