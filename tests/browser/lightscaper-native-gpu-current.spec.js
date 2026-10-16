/* SPDX-License-Identifier: AGPL-3.0-only */

import { fileURLToPath } from 'node:url';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';

test.use({ browserCoverage: false });
test.skip(({ browserName }) => test.info().project.name !== 'lightscaper-software-gpu' && browserName !== 'firefox',
	'Native GPU conformance requires pinned software Chromium or actual Firefox capability/fallback.');
const PATH = '/__lightscaper_native_gpu_current.js';
const FALLBACKS = ['canvas-unavailable', 'context-unavailable', 'float-target-unavailable', 'float-conformance-failed',
	'texture-capacity', 'working-set', 'numeric-range', 'context-lost', 'execution-unavailable'];
let program;
test.beforeAll(async () => {
	program = await compileNativeImageHandoffScript('native-gpu-current.js', fileURLToPath(new URL('./helpers/lightscaper-native-gpu-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]);
});

// This packet qualifies the lower native Float32 owner and its WB/tone passes.
// It does not establish whole-recipe Photo Develop or persisted UI integration.
test('native GPU globals preserve complete oriented Float32 planes, signed HDR, tiny normals, hidden RGB and alpha', async ({ page, browserName }) => {
	await prepare(page, browserName);
	const source = [-.25, 2, .125, .375, 1e-30, -(2 ** -126), 4, 0, .125, .25, .5, 1,
		.25, .5, 1, .5, -.5, 4, 2, .25, 2, 1, .5, -0];
	for (const primaries of ['srgb', 'bt709']) {
		const result = await render(page, { width: 3, height: 2, values: source, primaries, effects: [wb({ temperature: 100, tint: 0 })] });
		assertDelivery(result, browserName); expect(result.descriptor).toEqual({ schemaVersion: 1, width: 3, height: 2, sampleFormat: 'float32', primaries, transfer: 'linear' });
		if (result.backend === 'webgl2') {
			const expected = source.map((n, at) => at % 4 === 3 ? n : at % 4 === 0 ? Math.fround(Math.fround(n) * 2) : at % 4 === 2 ? Math.fround(Math.fround(n) / 2) : Math.fround(n));
			expect(result.bits).toEqual(floatBits(expected)); nativeOutput(result, 3, 2);
		} else expect(result.bits).toEqual(floatBits(source));
	}
});

test('native GPU six-control tone and noncommuting WB/tone order match independent normal-value literals', async ({ page, browserName }) => {
	await prepare(page, browserName);
	const cases = [
		{ values: [0, .125, .25, .375], effects: [tone({ exposure: 1, contrast: 50, highlights: 40, shadows: 20, whites: -20, blacks: 60 })], expected: [.02, .3347744, .8808864, .375] },
		{ values: [.125, .25, .5, .75], effects: [wb({ temperature: 100 }), tone({ contrast: 50 })], expected: [.32, .32, .32, .75] },
		{ values: [.125, .25, .5, .75], effects: [tone({ contrast: 50 }), wb({ temperature: 100 })], expected: [.14, .32, .41, .75] },
		{ values: [.125, -.25, 4, .5], effects: [tone({ exposure: 1 }, 'up'), tone({ exposure: -1 }, 'down')], expected: [.125, -.25, 4, .5], exact: true },
	];
	for (const entry of cases) {
		const result = await render(page, { width: 1, height: 1, values: entry.values, effects: entry.effects }); assertDelivery(result, browserName);
		if (result.backend === 'cpu') { expect(result.bits).toEqual(floatBits(entry.values)); continue; }
		// Only this normal finite full-tone corpus allows8 ULPs. Alpha and
		// dyadic exposure remain exact; this is no near-zero absolute epsilon.
		for (let at = 0; at < 4; at++) {
			if (at === 3 || entry.exact) expect(result.bits[at]).toBe(floatBits(entry.expected)[at]);
			else expect(ulpDistance(result.bits[at], floatBits(entry.expected)[at]), `tone component ${at}`).toBeLessThanOrEqual(8);
		}
		nativeOutput(result, 1, 1);
	}
});

test('native GPU identity and exact alpha bypass retain adjacent Float32 values and signed zero without an encoded intermediate', async ({ page, browserName }) => {
	await prepare(page, browserName);
	const source = [-0, .10000000149011612, .10000000894069672, -0, -.25, 2, 4, 0, 1e-30, -(2 ** -126), .5, 1];
	const result = await render(page, { width: 3, height: 1, values: source, effects: [] }); assertDelivery(result, browserName);
	expect(result.bits).toEqual(floatBits(source)); expect(result.bits[1]).not.toBe(result.bits[2]);
	if (result.backend === 'webgl2') nativeOutput(result, 3, 1);
});

test('arithmetic subnormals receive exact owned CPU fallback instead of silently flushed GPU output', async ({ page, browserName }) => {
	await prepare(page, browserName);
	const source = [2 ** -149, -(2 ** -149), 2 ** -148, .375, 2 ** -126, 1e-30, 4, 0];
	const result = await render(page, { width: 2, height: 1, values: source, effects: [tone({ exposure: 1 })] });
	assertDelivery(result, browserName, true);
	if (browserName === 'chromium') { expect(result.backend).toBe('cpu'); expect(result.reason).toBe('numeric-range'); }
	if (result.backend === 'cpu') {
		expect(result.bits).toEqual(floatBits(source)); expect(result.liveHandlesAtDelivery).toBe(0);
	} else {
		const expected = source.map((n, at) => at % 4 === 3 ? n : Math.fround(n * 2));
		expect(result.bits).toEqual(floatBits(expected)); nativeOutput(result, 2, 1);
	}
});

test('native GPU pivot cancellation and newly produced subnormals preserve precision or take exact numeric fallback', async ({ page, browserName }) => {
	await prepare(page, browserName);
	const source = [.135, .135, .135, .375], control = await render(page, { width: 1, height: 1, values: source, effects: [] });
	assertDelivery(control, browserName); expect(control.bits).toEqual(floatBits(source));
	const expected = Math.fround(Math.fround(.135) * 4 + .18 * (1 - 4)); expect(expected).toBeGreaterThan(0);
	const pivot = await render(page, { width: 1, height: 1, values: source, effects: [tone({ contrast: 100 })] });
	assertDelivery(pivot, browserName, true);
	if (pivot.backend === 'cpu') {
		expect(pivot.bits).toEqual(floatBits(source));
		expect(pivot.reason).toBe(control.backend === 'webgl2' ? 'numeric-range' : control.reason);
	} else {
		for (let channel = 0; channel < 3; channel++) {
			expect(pivot.pixels[channel]).toBeGreaterThan(0);
			expect(ulpDistance(pivot.bits[channel], floatBits([expected])[0])).toBeLessThanOrEqual(8);
		}
		expect(pivot.bits[3]).toBe(floatBits(source)[3]); nativeOutput(pivot, 1, 1);
	}
	const minimum = [2 ** -126, -(2 ** -126), 1, .375];
	const underflow = await render(page, { width: 1, height: 1, values: minimum, effects: [tone({ exposure: -1 })] });
	assertDelivery(underflow, browserName, true);
	if (browserName === 'chromium') expect(underflow.backend).toBe('cpu');
	if (underflow.backend === 'cpu') {
		expect(underflow.bits).toEqual(floatBits(minimum));
		expect(underflow.reason).toBe(control.backend === 'webgl2' ? 'numeric-range' : control.reason);
	} else {
		expect(underflow.bits).toEqual(floatBits([2 ** -127, -(2 ** -127), .5, .375]));
		expect(underflow.pixels[0]).not.toBe(0); expect(underflow.pixels[1]).not.toBe(0); nativeOutput(underflow, 1, 1);
	}
});

test('native GPU preabort and post-read abort preserve opaque reasons and never invoke the consumer', async ({ page, browserName }) => {
	await prepare(page, browserName);
	const early = await call(page, 'qualifyNativeGpuLifetimeCurrentV1', 'preabort');
	expect(early.rejected).toBe(true); expect(early.exactAbort).toBe(true); expect(early.callbacks).toBe(0); expect(early.pixelReads).toBe(0);
	expect(early.native.contexts).toEqual([]); expect(early.native.draws).toBe(0); expect(early.sourceUnchanged).toBe(true); handlesRetired(early.native);
	const late = await call(page, 'qualifyNativeGpuLifetimeCurrentV1', 'abort-after-read');
	if (late.native.abortTriggered) { expect(late.rejected).toBe(true); expect(late.exactAbort).toBe(true); expect(late.callbacks).toBe(0); }
	else { expect(browserName).toBe('firefox'); expect(late.backend).toBe('cpu'); expect(FALLBACKS).toContain(late.fallbackReason); expect(late.callbacks).toBe(1); }
	expect(late.sourceUnchanged).toBe(true); expect(late.native.readbacksRetired).toBe(true); handlesRetired(late.native);
});

test('native GPU cancellation joins the held consumer before wiping its owned output and never replays it', async ({ page, browserName }) => {
	await prepare(page, browserName); const result = await call(page, 'qualifyNativeGpuLifetimeCurrentV1', 'held-abort');
	if (browserName === 'chromium') expect(result.backend).toBe('webgl2');
	expect(result.heldPending).toBe(true); expect(result.heldNonzero).toBe(true); expect(result.callbacks).toBe(1);
	expect(result.rejected).toBe(true); expect(result.exactAbort).toBe(true); expect(result.outputRetired).toBe(true);
	expect(result.sourceUnchanged).toBe(true); handlesRetired(result.native);
});

test('native GPU precision preflight yields to cancellation before image readback or consumer delivery', async ({ page, browserName }) => {
	await prepare(page, browserName); const result = await call(page, 'qualifyNativeGpuPreflightCancellationCurrentV1');
	if (result.native.abortTriggered) {
		expect(result.rejected).toBe(true); expect(result.exactAbort).toBe(true); expect(result.callbacks).toBe(0);
		expect(result.native.reads.some(read => read.width === 64 && read.height === 64)).toBe(false);
	} else { expect(browserName).toBe('firefox'); expect(result.backend).toBe('cpu'); }
	expect(result.sourceUnchanged).toBe(true); handlesRetired(result.native);
});

test('native GPU queued rendering yields to cancellation before the blocking native image readback', async ({ page, browserName }) => {
	await prepare(page, browserName); const result = await call(page, 'qualifyNativeGpuPreflightCancellationCurrentV1', 'draw');
	if (result.native.abortTriggered) {
		expect(result.rejected).toBe(true); expect(result.exactAbort).toBe(true); expect(result.callbacks).toBe(0);
		expect(result.native.reads.some(read => read.width === 64 && read.height === 64)).toBe(false);
	} else { expect(browserName).toBe('firefox'); expect(result.backend).toBe('cpu'); }
	expect(result.sourceUnchanged).toBe(true); handlesRetired(result.native);
});

test('real context loss before delivery falls back once after GL cleanup; loss after delivery cannot replay the consumer', async ({ page, browserName }) => {
	await prepare(page, browserName); const before = await call(page, 'qualifyNativeGpuContextLossCurrentV1');
	expect(before.backend).toBe('cpu'); expect(before.callbacks).toBe(1); expect(before.bits).toEqual(before.beforeBits);
	if (before.native.lossTriggered) expect(before.reason).toBe('context-lost');
	else { expect(browserName).toBe('firefox'); expect(FALLBACKS).toContain(before.reason); }
	expect(before.liveHandlesAtDelivery).toBe(0); expect(before.outputRetired).toBe(true); expect(before.sourceUnchanged).toBe(true); handlesRetired(before.native);
	const held = await call(page, 'qualifyNativeGpuLifetimeCurrentV1', 'held-loss');
	expect(held.heldPending).toBe(true); expect(held.heldNonzero).toBe(true); expect(held.callbacks).toBe(1); expect(held.outputRetired).toBe(true);
	if (held.backend === 'webgl2') { expect(held.contextLossAvailable).toBe(true); expect(held.rejected).toBe(true); }
	else { expect(browserName).toBe('firefox'); expect(held.rejected).toBe(false); expect(FALLBACKS).toContain(held.fallbackReason); }
	expect(held.sourceUnchanged).toBe(true); handlesRetired(held.native);
});

test('native GPU physical output transfer and opaque consumer failures cannot report successful retirement or trigger replay', async ({ page, browserName }) => {
	await prepare(page, browserName);
	for (const mode of ['detach', 'opaque']) {
		const result = await call(page, 'qualifyNativeGpuLifetimeCurrentV1', mode);
		if (browserName === 'chromium') expect(result.backend).toBe('webgl2');
		expect(result.callbacks).toBe(1); expect(result.rejected).toBe(true); expect(result.sourceUnchanged).toBe(true); handlesRetired(result.native);
		if (mode === 'detach') { expect(result.detachedFailure).toBe(true); expect(result.transferNonzero).toBe(true); }
		else { expect(result.exactAbort).toBe(true); expect(result.outputRetired).toBe(true); }
	}
});

function assertDelivery(result, browserName, numeric = false) {
	expect(result.callbacks).toBe(1); expect(result.dedicated).toBe(true); expect(result.sourceBits).toEqual(result.beforeBits); expect(result.outputRetired).toBe(true);
	if (test.info().project.name === 'lightscaper-software-gpu') {
		expect(result.native.contexts.length).toBeGreaterThan(0);
		for (const context of result.native.contexts) expect(context.renderer).toContain('SwiftShader');
	}
	if (result.backend === 'cpu') {
		expect(FALLBACKS).toContain(result.reason); expect(result.liveHandlesAtDelivery).toBe(0);
		if (browserName === 'chromium') expect(numeric).toBe(true);
	} else { expect(result.backend).toBe('webgl2'); expect(result.reason).toBeNull(); }
	handlesRetired(result.native);
}
function handlesRetired(native) {
	expect(native.aliveHandles).toBe(0);
	for (const key of Object.keys(native.created)) expect(native.deleted[key], key).toBe(native.created[key]);
}
function nativeOutput(result, width, height) {
	expect(result.native.contexts.length).toBeGreaterThan(0); expect(result.native.contexts.every(value => value.floatTarget && value.nativeReceiver)).toBe(true);
	expect(result.native.floatTargets).toBeGreaterThan(0); expect(result.native.floatUploads).toBeGreaterThan(0); expect(result.native.draws).toBeGreaterThan(0);
	const readbacks = result.native.reads.filter(value => value.floating && value.width === width && value.height === height);
	expect(readbacks.length).toBeGreaterThan(0);
	// The lower owner may invert rows at its transfer boundary; the delivered
	// plane's top-left orientation is independently asserted by every literal.
	expect(readbacks.some(value => same(value.bits, result.bits) || same(flipRows(value.bits, width, height), result.bits))).toBe(true);
	expect(result.native.errors.every(value => value === 0)).toBe(true);
}
function wb(params, id = 'wb') { return { id, type: 'white-balance-v1', enabled: true, params }; }
function tone(params, id = 'tone') { return { id, type: 'tone-ladder-v1', enabled: true, params }; }
function floatBits(values) { return [...new Uint32Array(Float32Array.from(values).buffer)]; }
function ulpDistance(a, b) { const ordered = n => n & 0x80000000 ? 0x80000000 - (n & 0x7fffffff) : 0x80000000 + n; return Math.abs(ordered(a) - ordered(b)); }
function same(a, b) { return a.length === b.length && a.every((value, at) => value === b[at]); }
function flipRows(values, width, height) { return Array.from({ length: height }, (_, y) => values.slice((height - y - 1) * width * 4, (height - y) * width * 4)).flat(); }
async function prepare(page, browserName) {
	test.skip(browserName === 'webkit', 'This lower native GPU packet qualifies pinned software Chromium and actual Firefox capability/fallback.'); test.setTimeout(90_000);
	await page.route(`**${PATH}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source }));
	await page.goto(resolveBrowserProductTestUrl('/lightscaper/en/'));
}
function render(page, value) { return call(page, 'qualifyNativeGpuCurrentV1', value); }
function call(page, method, value) { return page.evaluate(async ({ path, method, value }) => (await import(path))[method](value), { path: PATH, method, value }); }
