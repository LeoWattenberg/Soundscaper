/* SPDX-License-Identifier: AGPL-3.0-only */

import { fileURLToPath } from 'node:url';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';

test.use({ browserCoverage: false });
test.skip(({ browserName }) => test.info().project.name !== 'lightscaper-software-gpu' && browserName !== 'firefox',
	'Native spatial conformance requires pinned software Chromium or actual Firefox capability/fallback.');
const PROGRAM = '/__lightscaper_native_gpu_spatial_current.js', BASE = 2 ** -12;
let program;
test.beforeAll(async () => {
	program = await compileNativeImageHandoffScript('native-gpu-spatial-current.js', fileURLToPath(new URL('./helpers/lightscaper-native-gpu-spatial-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]);
});
const effect = (type, params, id = type) => ({ id, type, enabled: true, params });
const detail = (amount = 100, threshold = 0) => effect('detail-sharpen-v1', { amount, threshold });
const clarity = amount => effect('clarity-v1', { amount });
const texture = amount => effect('texture-v1', { amount });
const haze = amount => effect('dehaze-v1', { amount });
const grain = (size, roughness, seed) => effect('grain-v1', { amount: 100, size, roughness, seed });
const vignette = (amount, params = {}) => effect('post-crop-vignette-v1', { amount, midpoint: 0, feather: 0, ...params });
const noise = params => effect('noise-reduction-v1', { luminance: 0, color: 0, luminanceDetail: 0, luminanceContrast: 0, colorDetail: 0, colorSmoothness: 100, ...params });
const f32 = values => values.map(Math.fround);
const grayRow = values => values.flatMap(n => [n, n, n, 1]);
const encoded = value => { const n = Math.abs(value); return Math.sign(value) * (n <= .0031308 ? n * 12.92 : 1.055 * n ** (1 / 2.4) - .055); };
const decoded = value => { const n = Math.abs(value); return Math.sign(value) * (n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4); };

test('detail14 has independent continuous3tap sharpening literals with replicated borders', async ({ page }) => {
	const values = grayRow([BASE, 2 * BASE, 3 * BASE]), value = await run(page, { width: 3, height: 1, values, effects: [detail()] });
	accepted(value, [[14, 3, 1]]);
	// Replicated3tap blur is .75*a+.25*b at the left edge; no byte
	// mean or RGB quantization occurs before this native Float32 store.
	expect(value.expected.values).toEqual(f32(grayRow([3 / 4 * BASE, 2 * BASE, 13 / 4 * BASE])));
	expect(value.expected.bits).not.toEqual(value.before);
});

test('detail14 threshold127 versus128 preserves the continuous threshold branch and exact inactive channels', async ({ page }) => {
	const values = grayRow([0, 1, 0]);
	const protectedValue = await run(page, { width: 3, height: 1, values, effects: [detail(100, 128)] }); accepted(protectedValue, [[14, 3, 1]]);
	expect(protectedValue.bits).toEqual(protectedValue.before);
	const activeValue = await run(page, { width: 3, height: 1, values, effects: [detail(100, 127)] }); accepted(activeValue, [[14, 3, 1]]);
	// Center difference is one half in continuous encoded coordinates:
	// 127.5 exceeds127 but remains protected by128, without rounding the blur.
	expect(activeValue.expected.values).toEqual(f32(grayRow([0, decoded(1.5), 0])));
});

for (const amount of [-100, 100]) test(`clarity16 amount${amount} uses the direct7tap mean and continuous midtone gate`, async ({ page }) => {
	const values = grayRow([BASE, 4 * BASE, BASE]), value = await run(page, { width: 3, height: 1, values, effects: [clarity(amount)] });
	accepted(value, [[16, 3, 1]]);
	// The center7tap weights are22/20/22 over64, hence blur31/16.
	const gate = 2 * (4 * BASE * 12.92) * 255 / 254;
	expect(value.expected.values[4]).toBe(Math.fround(BASE * (4 + Math.sign(amount) * 33 / 16 * gate)));
	expect(value.expected.bits).not.toEqual(value.before);
});

for (const amount of [-100, 100]) test(`texture19 amount${amount} retains distinct3tap/5tap continuous means`, async ({ page }) => {
	const values = grayRow([BASE, 4 * BASE, BASE]), value = await run(page, { width: 3, height: 1, values, effects: [texture(amount)] });
	accepted(value, [[19, 3, 1]]);
	// Center fine=5/2, coarse=17/8; their difference is3/8.
	const gate = 1 - 4 * 255 * (15 / 8 * BASE * 12.92) / 256;
	expect(value.expected.values[4]).toBe(Math.fround(BASE * (4 + Math.sign(amount) * 3 / 8 * gate)));
	expect(value.expected.bits).not.toEqual(value.before);
});

for (const [params, expected] of [[{ luminance: 100 }, [65 / 16, 17 / 16, 33 / 16]],
	[{ color: 100 }, [151 / 64, 119 / 64, 123 / 64]], [{ luminance: 100, color: 100 }, [155 / 64, 123 / 64, 127 / 64]]]) {
	test(`noise17 luma${params.luminance ?? 0} chroma${params.color ?? 0} reconstructs independent YCoCg rational values`, async ({ page }) => {
		const values = [BASE, 2 * BASE, 3 * BASE, 1, 4 * BASE, BASE, 2 * BASE, 1, 2 * BASE, 3 * BASE, BASE, 1];
		const value = await run(page, { width: 3, height: 1, values, effects: [noise(params)] }); accepted(value, [[17, 3, 1]]);
		// Both reductions sample the immutable input: center Y becomes33/16,
		// while5tap chroma means are Co7/16 and Cg-9/32.
		expect(value.expected.values.slice(4, 8)).toEqual(f32([...expected.map(n => n * BASE), 1]));
		expect(value.expected.bits).not.toEqual(value.before);
	});
}

for (const [size, roughness, seed] of [[1, 0, 3292], [257 / 256, 100, 3292], [577 / 256, 75, 65520]]) {
	test(`grain18 exact integer lattice size${size} roughness${roughness} seed${seed}`, async ({ page }) => {
		const values = [BASE, 2 * BASE, 3 * BASE, .375], value = await run(page, { width: 1, height: 1, values, effects: [grain(size, roughness, seed)] });
		accepted(value, [[18, 1, 1]]);
		// Seed3292 at cell(0,0) gives h65520 before the polynomial. Its
		// exact numerator4294901537 is above INT_MAX but below UINT_MAX.
		if (seed === 3292) { expect((seed * 199 + 101) % 65521).toBe(65520); expect(65520 ** 2 + 31 * 65520 + 17).toBe(4294901537); }
		const n = independentGrainNoise(0, 0, Math.round(size * 256), Math.round(roughness * 256 / 100), seed);
		const channels = values.slice(0, 3).map(encoded), luma = (54 * channels[0] + 183 * channels[1] + 19 * channels[2]) / 256;
		const delta = n * Math.max(0, Math.min(1, 2 * Math.min(luma, 1 - luma))) / 1024;
		expect(value.expected.values).toEqual(f32([...channels.map(channel => decoded(channel + delta)), .375]));
		expect(value.expected.bits).not.toEqual(value.before);
	});
}

for (const amount of [-50, 25]) test(`dehaze20 amount${amount} keeps independent fixed-white native reconstruction`, async ({ page }) => {
	const values = grayRow([.125, .25, .5]), value = await run(page, { width: 3, height: 1, values, effects: [haze(amount)] }); accepted(value, [[20, 3, 1]]);
	const center = encoded(.25), minimum = encoded(.125), gain = Math.round(amount * 256 / 100);
	const target = amount < 0 ? center + (1 - center) * .25 : 1 + (center - 1) / (1 - minimum * gain / 256 * 243 / 256);
	expect(value.expected.values[4]).toBe(Math.fround(decoded(target))); expect(value.expected.bits).not.toEqual(value.before);
});

for (const amount of [-100, 100]) test(`postCrop15 hard feather0 amount${amount} preserves stage pixel centers and signed roundness`, async ({ page }) => {
	const values = Array.from({ length: 3 }, () => [.125, .25, .5, .5]).flat();
	const value = await run(page, { width: 3, height: 1, values, effects: [vignette(amount, { roundness: -100 })] }); accepted(value, [[15, 3, 1]]);
	const edge = amount < 0 ? 0 : 1; expect(value.expected.values).toEqual([edge, edge, edge, .5, .125, .25, .5, .5, edge, edge, edge, .5]);
});

test('postCrop15 highlight protection and feather0 use the geometry output aperture', async ({ page }) => {
	const values = Array.from({ length: 9 }, () => [2, .25, -.125, .5]).flat(), crop = effect('develop-geometry-v1', { cropWidth: 1 / 3, rotationDegrees: 90 });
	const value = await run(page, { width: 3, height: 3, values, effects: [crop, vignette(-100, { roundness: -100, highlights: 100 })] });
	accepted(value, [[9, 3, 1], [15, 3, 1]]); expect(value.expected.values).toEqual(Array.from({ length: 3 }, () => [2, .25, -.125, .5]).flat());
	expect(value.bits).toEqual(value.expected.bits);
	// HDR maximum>1 gives complete protection. Removing protection really
	// darkens the two boundary pixels in the new3×1 aperture.
	const dark = await run(page, { width: 3, height: 3, values, effects: [crop, vignette(-100, { roundness: -100 })] }); accepted(dark, [[9, 3, 1], [15, 3, 1]]);
	expect(dark.expected.values).toEqual([0, 0, 0, .5, 2, .25, -.125, .5, 0, 0, 0, .5]);
});

test('color spatial geometry verifiedLUT lens vignette retain authored order and immutable resources', async ({ page }) => {
	const values = Array.from({ length: 9 }, () => [.125, .25, .5, 1]).flat(), value = await run(page, { width: 3, height: 3, values, mixed: true });
	accepted(value, [[1, 3, 3], [14, 3, 3], [9, 3, 3], [8, 3, 3], [10, 3, 3], [15, 3, 3]]);
	expect(value.sourceCalls).toBeGreaterThan(0); expect(value.maximumActive).toBe(1); expect(value.sourceActiveAtDelivery).toBe(0);
	expect(value.expected.values).toEqual(Array.from({ length: 9 }, (_, at) => [at === 4 ? .25 : 0, at === 4 ? .25 : 0, at === 4 ? .25 : 0, 1]).flat());
	const reversed = await run(page, { width: 3, height: 3, values, mixed: true, mixedReverse: true });
	accepted(reversed, [[1, 3, 3], [14, 3, 3], [9, 3, 3], [8, 3, 3], [15, 3, 3], [10, 3, 3]], false);
	expect(reversed.expected.bits).not.toEqual(value.expected.bits);
});

const corpus = [detail(73.25, 3), vignette(-61.25, { midpoint: 37.5, feather: 62.5, roundness: 43.75, highlights: 25 }), clarity(-37.5),
	noise({ luminance: 50, color: 75, luminanceDetail: 25, luminanceContrast: 50, colorDetail: 12.5, colorSmoothness: 37.5 }), grain(577 / 256, 75, 65520), texture(62.5), haze(43.75)];
for (const [index, selected] of corpus.entries()) test(`${selected.type}: whole9×7 signed HDR varied-alpha native corpus or exact wholeCPU`, async ({ page }) => {
	const values = Array.from({ length: 63 }, (_, at) => [((at * 13) % 47 - 11) / 16, ((at * 7) % 31 - 5) / 32, ((at * 19) % 53 - 7) / 16, [0, .25, .5, .75, 1][at % 5]]).flat();
	const kind = [14, 15, 16, 17, 18, 19, 20][index], value = await run(page, { width: 9, height: 7, values, effects: [selected] }); accepted(value, [[kind, 9, 7]], false);
	for (let at = 0; at < values.length; at++) if (at % 4 === 3 || values[Math.floor(at / 4) * 4 + 3] === 0) expect(value.bits[at]).toBe(value.before[at]);
	if (value.backend === 'cpu' && value.observation.normalFloatSupported) expect(value.reason).toBe('numeric-range');
});

test('normal-alpha products below the Float32 arithmetic floor trigger exact wholeCPU after a real spatial draw', async ({ page, browserName }) => {
	const values = Array.from({ length: 3 }, () => [2 ** -50, 2 ** -49, 2 ** -48, 2 ** -100]).flat();
	const value = await run(page, { width: 3, height: 1, values, effects: [detail()] }); accepted(value, [[14, 3, 1]], false);
	expect(value.expected.bits).toEqual(value.before); expect(value.bits).toEqual(value.before);
	if (test.info().project.name === 'lightscaper-software-gpu' || value.observation.normalFloatSupported) expect(value.observation.readbacks.some(read => read.passes.some(pass => pass.kind === 14))).toBe(true);
	if (browserName === 'chromium') { expect(value.backend).toBe('cpu'); expect(value.reason).toBe('numeric-range'); }
});

test('subnormal alpha retains its exact native value through truthful numerical fallback', async ({ page, browserName }) => {
	const values = grayRow([BASE, 2 * BASE, 3 * BASE]).map((n, at) => at % 4 === 3 ? 2 ** -140 : n);
	const value = await run(page, { width: 3, height: 1, values, effects: [detail()] }); accepted(value, [[14, 3, 1]], false); expect(value.bits).toEqual(value.expected.bits);
	if (browserName === 'chromium') { expect(value.backend).toBe('cpu'); expect(value.reason).toBe('numeric-range'); }
});

test('disabled and Q8-neutral spatial stages preserve exact hidden RGB signed zero and tiny samples', async ({ page }) => {
	const values = [-0, 2 ** -149, 4, 0, 1e-30, -0, -2, 1], neutral = corpus.map(row => ({ ...row, params: row.type === 'noise-reduction-v1' ? { luminance: .1, color: .1 } : { amount: .1 } }));
	for (const effects of [neutral, corpus.map(row => ({ ...row, enabled: false }))]) {
		const value = await run(page, { width: 2, height: 1, values, effects }); accepted(value, [], false); expect(value.bits).toEqual(floatBits(values));
	}
});

for (const fault of ['preabort', 'held-abort', 'opaque', 'detach-opaque', 'held-loss']) test(`${fault}: spatial native output and source resources join physical retirement`, async ({ page }) => {
	const values = Array.from({ length: 9 }, () => [.125, .25, .5, 1]).flat(), value = await run(page, { width: 3, height: 3, values, mixed: true, fault });
	expect(value.sourceBits).toEqual(value.before); expect(value.sourceRetired).toBe(true); retired(value.observation);
	if (fault === 'preabort') { expect(value.rejected).toBe(true); expect(value.exactReason).toBe(true); expect(value.callbacks).toBe(0); expect(value.pixelReads).toBe(0); expect(value.sourceCalls).toBe(0); expect(value.observation.attempts).toBe(0); }
	else { expect(value.callbacks).toBe(1); expect(value.outputRetired).toBe(true);
		if (fault.startsWith('held-')) { expect(value.pending).toBe(true); expect(value.heldNonzero).toBe(true); }
		if (fault === 'detach-opaque') { expect(value.rejected).toBe(true); expect(value.primaryRetained).toBe(true); expect(value.cleanupRetained).toBe(true); }
		else if (fault !== 'held-loss') { expect(value.rejected).toBe(true); expect(value.exactReason).toBe(true); }
		if (test.info().project.name === 'lightscaper-software-gpu') { expect(value.backend).toBe('webgl2'); if (fault === 'held-loss') { expect(value.loss).toBe(true); expect(value.rejected).toBe(true); } }
	}
});

async function run(page, value) { await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source }));
	await page.goto(resolveBrowserProductTestUrl('/lightscaper/en/')); return page.evaluate(async ({ path, value }) => (await import(path)).qualifyNativeGpuSpatialCurrentV1(value), { path: PROGRAM, value }); }
function accepted(value, stages, positive = true) {
	expect(value.rejected).toBe(false); expect(value.callbacks).toBe(1); expect(value.sourceBits).toEqual(value.before); expect(value.sourceRetired).toBe(true); expect(value.outputRetired).toBe(true); retired(value.observation);
	expect(value.descriptor).toEqual(value.expected.descriptor); expect(value.byteOffset).toBe(0); expect(value.byteLength).toBe(value.descriptor.width * value.descriptor.height * 16);
	if (positive && (test.info().project.name === 'lightscaper-software-gpu' || value.observation.normalFloatSupported)) expect(value.backend, value.reason).toBe('webgl2');
	if (value.backend === 'cpu') { expect(typeof value.reason).toBe('string'); expect(value.bits).toEqual(value.expected.bits); return; }
	if (stages.some(([kind]) => kind >= 14)) expect(value.observation.spatialPrograms).toBeGreaterThan(0);
	const read = value.observation.readbacks.at(-1); expect(read).toBeTruthy(); expect([read.width, read.height]).toEqual([value.descriptor.width, value.descriptor.height]); expect(read.bits).toEqual(value.bits);
	expect(read.passes.map(pass => [pass.kind, pass.width, pass.height])).toEqual(stages);
	for (const pass of read.passes) if (pass.kind >= 10) expect(pass.extent).toEqual([pass.width, pass.height]);
	// Neighborhood reconstruction is not a same-index Original ancestry claim.
	// Keep the exact Original guard for pure pointwise stages;
	// explicit hidden/flat/protected/center cases above separately pin copied bits.
	const nonlocal = stages.some(([kind]) => [9, 10, 11, 14, 16, 17, 19].includes(kind))
		|| stages.some(([kind]) => kind === 20) && value.effects.some(row => row.enabled && row.type === 'dehaze-v1' && row.params.amount > 0);
	const sameIndexAncestor = !nonlocal;
	for (let at = 0; at < value.bits.length; at++) { const expected = value.expected.values[at], n = value.expected.bits[at];
		if (at % 4 === 3 || expected === 0 || Math.abs(expected) < 2 ** -60 || sameIndexAncestor && n === value.before[at]) expect(value.bits[at], `exact sample${at}`).toBe(n);
		else expect(Math.abs(ordered(value.bits[at]) - ordered(n)), `8ULP sample${at}`).toBeLessThanOrEqual(8); }
	expect(value.observation.sourceUploads.some(source => source.every((n, at) => n === value.before[at]))).toBe(true);
}
function retired(value) { expect(value.aliveHandles).toBe(0); expect(value.readbacksRetired).toBe(true); expect(value.uploadBackingsRetired).toBe(true); expect(value.changingReadbacksRetired).toBe(true); expect(value.spatialReadbacksRetired).toBe(true);
	for (const kind of Object.keys(value.created)) expect(value.deleted[kind], kind).toBe(value.created[kind]);
	if (test.info().project.name === 'lightscaper-software-gpu') for (const context of value.contexts) expect(context.renderer).toContain('SwiftShader'); }
function independentGrainNoise(x, y, spacing, roughness, seed) {
	const hash = h => (h * h + 31 * h + 17) % 65521;
	const lattice = (cx, cy) => { const h = hash((cx * 73 + cy * 151 + seed * 199 + 101) % 65521); return Math.floor((h % 257 + hash(h) % 257 - 255) / 2); };
	const octave = size => { const qx = Math.floor((2 * x + 1) * 32768 / size), qy = Math.floor((2 * y + 1) * 32768 / size), cx = Math.floor(qx / 256), cy = Math.floor(qy / 256), fx = qx % 256, fy = qy % 256;
		return Math.floor((lattice(cx, cy) * (256 - fx) * (256 - fy) + lattice(cx + 1, cy) * fx * (256 - fy) + lattice(cx, cy + 1) * (256 - fx) * fy + lattice(cx + 1, cy + 1) * fx * fy + 32768) / 65536); };
	return Math.floor((octave(spacing) * (256 - roughness) + octave(Math.floor(spacing / 2)) * roughness + 128) / 256);
}
function floatBits(values) { return [...new Uint32Array(Float32Array.from(values).buffer)]; }
function ordered(bits) { return bits & 0x80000000 ? 0x80000000 - (bits & 0x7fffffff) : 0x80000000 + bits; }
