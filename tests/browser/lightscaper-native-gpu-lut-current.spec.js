/* SPDX-License-Identifier: AGPL-3.0-only */

import { fileURLToPath } from 'node:url';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';

test.use({ browserCoverage: false });
test.skip(({ browserName }) => test.info().project.name !== 'lightscaper-software-gpu' && browserName !== 'firefox',
	'Native LUT conformance requires pinned software Chromium or actual Firefox capability/fallback.');
const PROGRAM = '/__lightscaper_native_gpu_lut_current.js';
let program;
test.beforeAll(async () => {
	program = await compileNativeImageHandoffScript('native-gpu-lut-current.js', fileURLToPath(new URL('./helpers/lightscaper-native-gpu-lut-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]);
});

test('verified red-fastest2³ swap executes real3D sampling, hidden RGB, alpha and domain clamps', async ({ page }) => {
	const value = await run(page, { cube: 'swap2', values: [.125, .25, .5, .375, -.5, 2, .75, 0] });
	accepted(value, [8]); expect(value.reference.slice(0, 8)).toEqual([.5, .25, .125, .375, .75, 1, 0, 0]);
	actualUpload(value, 2); expect(value.sourceActiveAtDelivery).toBe(0);
});

test('nontrivial65³ multi-affine lattice retains signed HDR and independently bounded input domains', async ({ page }) => {
	test.setTimeout(120_000);
	const value = await run(page, { cube: 'analytic65', values: [-.5, .5, .75, .375, -2, -3, -1, 0, 2, 3, 2, .625] });
	accepted(value, [8]); actualUpload(value, 65);
	expect(value.reference.slice(0, 12)).toEqual([.390625, .953125, 1.2109375, .375, -.5, .25, 0, 0, 2.5, 1.75, 1.75, .625]);
});

test('native color→LUT→color order is noncommutative and never replaced with an encoded byte plane', async ({ page }) => {
	const value = await run(page, { cube: 'swap2', stack: 'mixed', values: [.125, .25, .5, .375, .25, .5, .75, 0] });
	accepted(value, [1, 8, 2]); actualUpload(value, 2);
	expect(value.reference.slice(0, 4)).toEqual([.5, .5, .5, .375]);
	// LUT before WB/exposure would instead yield[2,.5,.125,.375].
	expect(value.reference.slice(0, 4)).not.toEqual([2, .5, .125, .375]);
});

test('repeated immutable LUT identities and unique LUTs borrow bytes sequentially and preserve both stages', async ({ page }) => {
	const repeated = await run(page, { cube: 'swap2', stack: 'repeat', values: [.125, .25, .5, .375] });
	accepted(repeated, [8, 8]); expect(new Set(repeated.calls).size).toBe(1); expect(repeated.bits).toEqual(repeated.before);
	const unique = await call(page, { cube: 'swap2', stack: 'unique', values: [.125, .25, .5, 0] });
	accepted(unique, [8, 8]); expect(new Set(unique.calls).size).toBe(2); actualUpload(unique, 2);
	expect(unique.reference.slice(0, 4)).toEqual([-.125, .25, 1.5, 0]);
});

test('constant signed HDR LUT output and sub-byte source words are preserved at native precision', async ({ page }) => {
	const value = await run(page, { cube: 'constant2', values: [1024 / 65535, 1025 / 65535, 1026 / 65535, .375, 0, 0, 0, 0] });
	accepted(value, [8]); expect(value.reference.slice(0, 8)).toEqual([-.125, .25, 1.5, .375, -.125, .25, 1.5, 0]);
});

test('processed adjacent native words remain distinct through the actual swap lattice', async ({ page }) => {
	const value = await run(page, { cube: 'swap2', values: [1024 / 65535, 1025 / 65535, 1026 / 65535, .375, 1 / 65535, 2 / 65535, 3 / 65535, 0] });
	accepted(value, [8]);
	expect(value.bits.slice(0, 4)).toEqual([value.before[2], value.before[1], value.before[0], value.before[3]]);
	expect(new Set(value.bits.slice(0, 3)).size).toBe(3);
	expect(value.bits.slice(4, 8)).toEqual([value.before[6], value.before[5], value.before[4], value.before[7]]);
});

test('Double table cancellation falls back to the authentic nonzero CPU result rather than a rounded-upload oracle', async ({ page }) => {
	const value = await run(page, { cube: 'cancel2', values: [.5, .25, .5, .375] });
	accepted(value, [8], false);
	// Authenticated text stores1+2^-25 and-1+2^-25. AtR=.5 the
	// Double difference lerp is exactly2^-25; Float32 endpoints become1/-1.
	expect(value.reference.slice(0, 4)).toEqual([2 ** -25, .25, .5, .375]);
	expect(value.bits).toEqual(value.referenceBits); expect(value.values[0]).toBe(2 ** -25);
	if (test.info().project.name === 'lightscaper-software-gpu') {
		expect(value.backend).toBe('cpu'); expect(value.reason).toBe('numeric-range');
		const read = value.observation.readbacks.at(-1); expect(read).toBeTruthy(); expect(read.bits[0]).toBe(0);
		expect(value.observation.uploads.some(upload => upload.floating && upload.head.includes(1) && upload.head.includes(-1))).toBe(true);
	}
});

test('zero, tiny and unchanged samples require exact native delivery or exact complete CPU fallback', async ({ page }) => {
	const normal = await run(page, { cube: 'identity2', values: [0, 1e-30, .5, .375] });
	accepted(normal, [8], false); expect(normal.bits).toEqual(normal.referenceBits);
	const subnormal = await call(page, { cube: 'identity2', values: [2 ** -149, 2 ** -148, .25, 0] });
	accepted(subnormal, [8], false); expect(subnormal.bits).toEqual(subnormal.referenceBits);
	if (test.info().project.name === 'lightscaper-software-gpu') expect(subnormal.backend).toBe('cpu');
});

for (const fault of ['corrupt', 'double', 'cleanup']) test(`${fault}: body authentication and source retirement refuse before GL or consumer authority`, async ({ page }) => {
	const value = await run(page, { cube: 'swap2', values: [.125, .25, .5, .375], fault });
	expect(value.rejected).toBe(true); expect(value.callbacks).toBe(0); expect(value.sourceRetired).toBe(true);
	expect(value.sourceBits).toEqual(value.before); expect(value.observation.attempts).toBe(0); expect(value.observation.uploads).toEqual([]); retired(value.observation);
	if (fault === 'cleanup') expect(value.exactReason).toBe(true);
});

for (const fault of ['preabort', 'held-source-abort', 'held-consumer-abort', 'opaque']) test(`${fault}: exact opaque outcome joins all source, GPU and host buffers`, async ({ page }) => {
	const value = await run(page, { cube: 'constant2', values: [.125, .25, .5, .375], fault });
	expect(value.rejected).toBe(true); expect(value.exactReason).toBe(true); expect(value.sourceBits).toEqual(value.before); expect(value.sourceRetired).toBe(true); retired(value.observation);
	if (fault === 'preabort') { expect(value.callbacks).toBe(0); expect(value.calls).toEqual([]); expect(value.observation.attempts).toBe(0); }
	if (fault.startsWith('held-')) { expect(value.pending).toBe(true); expect(value.heldNonzero).toBe(true); }
	if (fault === 'held-source-abort') { expect(value.callbacks).toBe(0); expect(value.observation.attempts).toBe(0); }
	if (fault === 'held-consumer-abort' || fault === 'opaque') {
		expect(value.callbacks).toBe(1); expect(value.outputRetired).toBe(true);
		if (test.info().project.name === 'lightscaper-software-gpu') expect(value.backend).toBe('webgl2');
	}
});

test('actual context loss during a held consumer never replays CPU and still retires native resources', async ({ page }) => {
	const value = await run(page, { cube: 'constant2', values: [.125, .25, .5, .375], fault: 'held-loss' });
	expect(value.callbacks).toBe(1); expect(value.pending).toBe(true); expect(value.heldNonzero).toBe(true);
	expect(value.sourceRetired).toBe(true); expect(value.outputRetired).toBe(true); expect(value.sourceBits).toEqual(value.before); retired(value.observation);
	if (test.info().project.name === 'lightscaper-software-gpu') { expect(value.backend).toBe('webgl2'); expect(value.contextLossAvailable).toBe(true); expect(value.rejected).toBe(true); }
	else if (value.backend === 'webgl2') { expect(value.contextLossAvailable).toBe(true); expect(value.rejected).toBe(true); }
});

async function run(page, value) {
	await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source }));
	await page.goto(resolveBrowserProductTestUrl('/lightscaper/en/')); return call(page, value);
}
function call(page, value) { return page.evaluate(async ({ path, value }) => (await import(path)).qualifyNativeGpuLutCurrentV1(value), { path: PROGRAM, value }); }
function accepted(value, kinds, positive = true) {
	expect(value.rejected).toBe(false); expect(value.callbacks).toBe(1); expect(value.sourceBits).toEqual(value.before);
	expect(value.sourceRetired).toBe(true); expect(value.outputRetired).toBe(true); expect(value.maximumActive).toBe(1); expect(value.sourceActiveAtDelivery).toBe(0); retired(value.observation);
	if (positive && (test.info().project.name === 'lightscaper-software-gpu' || value.observation.normalFloatSupported)) expect(value.backend, value.reason).toBe('webgl2');
	if (value.backend === 'cpu') { expect(typeof value.reason).toBe('string'); expect(value.reason.length).toBeGreaterThan(0); expect(value.bits).toEqual(value.referenceBits); return; }
	const reads = value.observation.readbacks.filter(read => read.passes.map(pass => pass.kind).join(',') === kinds.join(','));
	expect(reads.length).toBeGreaterThan(0); expect(reads.some(read => read.bits.every((n, at) => n === value.bits[at]))).toBe(true);
	for (let at = 0; at < value.bits.length; at++) {
		const expected = value.reference[at], bits = value.referenceBits[at];
		if (at % 4 === 3 || expected === 0 || Math.abs(expected) < 2 ** -60 || bits === value.before[at]) expect(value.bits[at], `exact sample${at}`).toBe(bits);
		else expect(Math.abs(ordered(value.bits[at]) - ordered(bits)), `8ULP sample${at}`).toBeLessThanOrEqual(8);
	}
	actualUpload(value, value.observation.uploads.some(upload => upload.width === 65) ? 65 : 2);
}
function actualUpload(value, size) { if (value.backend !== 'webgl2') return;
	expect(value.observation.uploads.some(upload => upload.width === size && upload.height === size && upload.depth === size && upload.floating)).toBe(true); }
function retired(value) { expect(value.aliveHandles).toBe(0); expect(value.readbacksRetired).toBe(true); expect(value.uploadBackingsRetired).toBe(true);
	for (const kind of Object.keys(value.created)) expect(value.deleted[kind], kind).toBe(value.created[kind]);
	if (test.info().project.name === 'lightscaper-software-gpu') for (const context of value.contexts) expect(context.renderer).toContain('SwiftShader'); }
function ordered(bits) { return bits & 0x80000000 ? 0x80000000 - (bits & 0x7fffffff) : 0x80000000 + bits; }
