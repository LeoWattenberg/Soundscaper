/* SPDX-License-Identifier: AGPL-3.0-only */

import { fileURLToPath } from 'node:url';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';

test.use({ browserCoverage: false });
test.skip(({ browserName }) => test.info().project.name !== 'lightscaper-software-gpu' && browserName !== 'firefox',
	'Native-color conformance requires pinned software Chromium or actual Firefox capability/fallback.');
const PROGRAM = '/__lightscaper_native_gpu_colors_current.js';
let program;
test.beforeAll(async () => {
	program = await compileNativeImageHandoffScript('native-gpu-colors-current.js', fileURLToPath(new URL('./helpers/lightscaper-native-gpu-colors-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]);
});
const effect = (type, params = {}, id = type) => ({ id, type, enabled: true, params });
const decode = value => Math.sign(value) * (Math.abs(value) <= .04045 ? Math.abs(value) / 12.92 : ((Math.abs(value) + .055) / 1.055) ** 2.4);
const encoded = (r, g, b, alpha = .375) => [decode(r), decode(g), decode(b), alpha];
const literals = [
	{ name: 'chroma retains signed and HDR saturation without byte intermediates', type: 'chroma-v1', kind: 3,
		params: { saturation: 100 }, values: [1, 0, 0, .375], expected: [decode(1.7890625), decode(-.2109375), decode(-.2109375), .375] },
	{ name: 'black and white uses continuous54/183/19 luma', type: 'black-white-mix-v1', kind: 4,
		params: {}, values: [1, 0, 0, 0], expected: [decode(54 / 256), decode(54 / 256), decode(54 / 256), 0] },
	{ name: 'HSL red hue rotates in the continuous encoded domain', type: 'hsl-mixer-v1', kind: 5,
		params: { redHue: 60 }, values: encoded(.75, .25, .25), expected: encoded(.75, .75, .25) },
	{ name: 'point curves apply master then channel without an intermediate Float32 store', type: 'point-curves-v1', kind: 6,
		params: { master: [{ x: 0, y: 0 }, { x: .5, y: .25 }, { x: 1, y: 1 }], red: [{ x: 0, y: 0 }, { x: 1, y: .5 }] },
		values: encoded(.75, .25, .75), expected: encoded(.3125, .125, .625) },
	{ name: 'parametric curves evaluate continuous knots', type: 'parametric-curves-v1', kind: 6,
		params: { masterShadows: 100 }, values: encoded(.125, .25, .0625), expected: encoded(.25, .3125, .125) },
	{ name: 'wheels use signed native powers', type: 'color-wheels-v1', kind: 7,
		params: { midtonesLuminance: 100 }, values: [-4, .25, 2, .625], expected: [-2, .5, Math.SQRT2, .625] },
];

for (const item of literals) test(`native Float32: ${item.name}`, async ({ page, browserName }) => {
	const value = await run(page, { values: item.values, effects: [effect(item.type, item.params)] });
	assertDelivery(value, browserName, [item.kind]);
	// These values were calculated independently from the native family owner.
	// Input capture is Float32; the separate whole-plane normative test uses8ULP.
	for (let at = 0; at < 4; at++) expect(Math.abs(value.expected[at] - item.expected[at]), `literal sample${at}`).toBeLessThan(2e-6);
	if (value.backend === 'webgl2') expect(value.bits).not.toEqual(value.before);
});

test('a parametric identity-segment boundary preserves its unchanged native channel through truthful fallback', async ({ page, browserName }) => {
	const value = await run(page, { values: encoded(.125, .25, .375), effects: [effect('parametric-curves-v1', { masterShadows: 100 })], broker: true });
	assertDelivery(value, browserName, [6], true, false);
	// At encoded.375 the native master enters a slope-one identity segment.
	// SwiftShader transfer rounding selects the adjacent segment and a two-ULP
	// inverse-transfer drift. Even though that is within8ULP, an unchanged
	// native channel requires exact bits and therefore the complete CPU result.
	expect(value.expectedBits[2]).toBe(value.before[2]); expect(value.bits[2]).toBe(value.before[2]);
	if (test.info().project.name === 'lightscaper-software-gpu') {
		expect(value.backend).toBe('cpu'); expect(value.reason).toBe('numeric-range'); expect(value.bits).toEqual(value.expectedBits);
		const read = value.observation.readbacks.at(-1); expect(read).toBeTruthy();
		expect(read.bits[2]).not.toBe(value.before[2]); expect(Math.abs(ordered(read.bits[2]) - ordered(value.before[2]))).toBeLessThanOrEqual(8);
	}
});

test('all eight families execute in authored order and the complete mixed stack is noncommutative', async ({ page, browserName }) => {
	const effects = mixedEffects(), request = { values: [.125, .25, .5, .375, .5, .375, .25, 0], effects, broker: true };
	const forward = await run(page, request); assertDelivery(forward, browserName, [1, 2, 3, 5, 6, 6, 7, 4], true);
	const reverse = await call(page, { ...request, effects: [...effects].reverse() });
	assertDelivery(reverse, browserName, [4, 7, 6, 6, 5, 3, 2, 1], true);
	expect(forward.expectedBits).not.toEqual(reverse.expectedBits);
});

test('all eight native hue-band boundaries, adjacent words and signed HDR survive the continuous families', async ({ page, browserName }) => {
	const bands = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];
	const colors = [[1, 0, 0], [1, .5, 0], [1, 1, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1], [.5, 0, 1], [1, 0, 1]];
	const values = colors.flatMap((rgb, at) => encoded(...rgb, at / 8));
	values.push(1024 / 65535, 1024 / 65535, 1024 / 65535, 1, 1025 / 65535, 1025 / 65535, 1025 / 65535, 1,
		-1, 3, -.25, 0, 3, 3, 3, 0, -1, -1, -1, .5);
	const effects = [effect('hsl-mixer-v1', Object.fromEntries(bands.map((band, at) => [`${band}Luminance`, at % 2 ? -10 : 10]))),
		effect('black-white-mix-v1', Object.fromEntries(bands.map((band, at) => [band, (at - 4) * 5])))];
	const value = await run(page, { values, effects, broker: true });
	assertDelivery(value, browserName, [5, 4], true, false);
	expect(value.expected[32]).not.toBe(value.expected[36]);
	expect(value.expected.some((n, at) => at % 4 !== 3 && (n < 0 || n > 1))).toBe(true);
});

test('32-knot curves use actual uniform capacity and preserve native endpoint extrapolation', async ({ page, browserName }) => {
	const master = Array.from({ length: 32 }, (_, n) => ({ x: n / 31, y: n / 62 }));
	const value = await run(page, { values: encoded(.125, .375, .75).concat(encoded(-.25, 1.25, 2, 0)), effects: [effect('point-curves-v1', { master })] });
	assertDelivery(value, browserName, [6]);
	expect(value.expected[4]).toBeLessThan(0); expect(value.expected[6]).toBeCloseTo(1, 5);
});

test('extreme valid parametric splits retain the complete CPU oracle on any numeric fallback', async ({ page, browserName }) => {
	const value = await run(page, { values: encoded(.0002, .25, .9998).concat(encoded(-.25, 2, .375, 0)), broker: true,
		effects: [effect('parametric-curves-v1', { shadowSplit: 2 ** -10, midtoneSplit: .5, highlightSplit: 1 - 2 ** -10,
			masterShadows: 100, masterDarks: -100, masterLights: 100, masterHighlights: -100 })] });
	assertDelivery(value, browserName, [6], true, false);
});

test('Float32 knot collapse refuses the entire stack before consumer delivery and CPU retains its narrow segment', async ({ page, browserName }) => {
	const request = { values: encoded(.5, .25, .75), broker: true, effects: [effect('white-balance-v1', { temperature: 100 }),
		effect('point-curves-v1', { master: [{ x: 0, y: 0 }, { x: .5, y: .25 }, { x: .5 + 2 ** -40, y: .75 }, { x: 1, y: 1 }] })] };
	const value = await run(page, request); assertDelivery(value, browserName, [1, 6], true, false);
	expect(value.backend).toBe('cpu'); expect(value.bits).toEqual(value.expectedBits); expect(value.bits).not.toEqual(value.before);
});

test('an ill-conditioned master-to-channel composition falls back without inserting a Float32 curve boundary', async ({ page, browserName }) => {
	const value = await run(page, { values: encoded(.25, .5, .75), broker: true, effects: [effect('point-curves-v1', {
		master: [{ x: 0, y: 0 }, { x: .25, y: .5 + 2 ** -26 }, { x: 1, y: 1 }],
		red: [{ x: 0, y: 0 }, { x: .5, y: .25 }, { x: .5 + 2 ** -22, y: .75 }, { x: 1, y: 1 }],
	})] });
	assertDelivery(value, browserName, [6], true, false);
	// Distinct native knots remain valid; rounding the master output to .5
	// before the narrow red segment would instead yield decode(.25).
	expect(Math.abs(value.expected[0] - decode(.25))).toBeGreaterThan(.001);
	expect(value.backend).toBe('cpu'); expect(value.bits).toEqual(value.expectedBits);
});

test('normal tiny values remain native while subnormal arithmetic selects truthful whole CPU fallback', async ({ page, browserName }) => {
	const effects = [effect('color-wheels-v1', { highlightsLuminance: 100 })];
	const normal = await run(page, { values: [1e-30, -(2 ** -126), 2 ** -126, .375], effects });
	assertDelivery(normal, browserName, [7]); expect(normal.expected.slice(0, 3)).toEqual([Math.fround(2e-30), -(2 ** -125), 2 ** -125]);
	const tiny = await call(page, { values: [2 ** -149, -(2 ** -149), 2 ** -148, .375], effects, broker: true });
	assertDelivery(tiny, browserName, [7], true, false);
	if (test.info().project.name === 'lightscaper-software-gpu') expect(tiny.backend).toBe('cpu');
	expect(tiny.bits).toEqual(tiny.expectedBits);
});

test('inactive and neutral families preserve hidden RGB, signed zero and alpha bits exactly', async ({ page, browserName }) => {
	const effects = [effect('white-balance-v1'), effect('tone-ladder-v1'), effect('chroma-v1'), effect('hsl-mixer-v1'),
		effect('point-curves-v1'), effect('parametric-curves-v1'), effect('color-wheels-v1'),
		{ ...effect('black-white-mix-v1'), enabled: false }];
	const value = await run(page, { values: [-0, .125, -2, 0, 1e-30, 4, -.5, .375], effects });
	assertDelivery(value, browserName, [0]); expect(value.bits).toEqual(value.before);
});

async function run(page, request) {
	await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source }));
	await page.goto(resolveBrowserProductTestUrl('/lightscaper/en/'));
	return call(page, request);
}
function call(page, request) { return page.evaluate(async ({ path, request }) => (await import(path)).qualifyNativeGpuColorsCurrentV1(request), { path: PROGRAM, request }); }
function assertDelivery(value, browserName, kinds, broker = false, positive = true) {
	expect(value.callbacks).toBe(1); expect(value.dedicated).toBe(true); expect(value.sourceBits).toEqual(value.before); expect(value.outputRetired).toBe(true);
	const observed = value.observation; expect(observed.aliveHandles).toBe(0); expect(observed.readbacksRetired).toBe(true);
	for (const kind of Object.keys(observed.created)) expect(observed.deleted[kind], kind).toBe(observed.created[kind]);
	expect(observed.contexts.every(context => context.native)).toBe(true);
	if (test.info().project.name === 'lightscaper-software-gpu') {
		if (positive) expect(value.backend, deliveryDiagnostic(value)).toBe('webgl2');
		for (const context of observed.contexts) expect(context.renderer).toContain('SwiftShader');
	} else if (positive && observed.normalFloatSupported) expect(value.backend, deliveryDiagnostic(value)).toBe('webgl2');
	if (value.backend === 'cpu') {
		expect(typeof value.reason).toBe('string'); expect(value.reason.length).toBeGreaterThan(0);
		expect(value.bits).toEqual(broker ? value.expectedBits : value.before); return;
	}
	expect(['chromium', 'firefox']).toContain(browserName); expect(observed.floatUploads).toBeGreaterThan(0); expect(observed.floatTargets).toBeGreaterThan(0);
	const readbacks = observed.readbacks.filter(read => read.passes.map(pass => pass.kind).join(',') === kinds.join(','));
	expect(readbacks.length).toBeGreaterThan(0); expect(readbacks.some(read => read.bits.every((n, at) => n === value.bits[at]))).toBe(true);
	assertNativeUlps(value.bits, value.expectedBits);
}
function deliveryDiagnostic(value) {
	const read = value.observation.readbacks.at(-1), mismatches = [], violations = [];
	if (read) for (let index = 0; index < Math.min(read.bits.length, value.expectedBits.length); index++) {
		const actualBits = read.bits[index], expectedBits = value.expectedBits[index];
		if (actualBits === expectedBits) continue;
		const expected = new Float32Array(Uint32Array.of(expectedBits).buffer)[0], ulps = Math.abs(ordered(actualBits) - ordered(expectedBits));
		const entry = { index, actualBits, expectedBits, sourceBits: value.before[index], ulps };
		if (mismatches.length < 4) mismatches.push(entry);
		if (violations.length < 4 && (index % 4 === 3 || expected === 0 || Math.abs(expected) < 2 ** -100 || ulps > 8)) violations.push(entry);
		if (violations.length === 4) break;
	}
	return `Native GPU delivery: ${JSON.stringify({ reason: value.reason, readbacks: value.observation.readbacks.length,
		mismatches: violations.length ? violations : mismatches })}`;
}
export function assertNativeUlps(actual, expected) {
	expect(actual.length).toBe(expected.length);
	for (let at = 0; at < expected.length; at++) {
		const n = expected[at], number = new Float32Array(Uint32Array.of(n).buffer)[0];
		if (at % 4 === 3 || number === 0 || Math.abs(number) < 2 ** -100) expect(actual[at], `exact native sample${at}`).toBe(n);
		else expect(Math.abs(ordered(actual[at]) - ordered(n)), `native8ULP sample${at}`).toBeLessThanOrEqual(8);
	}
}
function ordered(bits) { return bits & 0x80000000 ? 0x80000000 - (bits & 0x7fffffff) : 0x80000000 + bits; }
function mixedEffects() { return [effect('white-balance-v1', { temperature: 100 }), effect('tone-ladder-v1', { exposure: -1, contrast: 10 }),
	effect('chroma-v1', { saturation: 10, vibrance: 5 }), effect('hsl-mixer-v1', { redLuminance: 5, blueSaturation: -10 }),
	effect('point-curves-v1', { master: [{ x: 0, y: 0 }, { x: 1, y: .875 }] }), effect('parametric-curves-v1', { masterShadows: 10 }),
	effect('color-wheels-v1', { highlightsLuminance: 100 }), effect('black-white-mix-v1', { blue: 10 })]; }
