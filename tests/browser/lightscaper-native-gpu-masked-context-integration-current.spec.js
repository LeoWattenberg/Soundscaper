/* SPDX-License-Identifier: AGPL-3.0-only */
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { expect, test } from './helpers/browser-coverage-fixture.js';
test.use({ browserCoverage: false });
test.skip(({ browserName }) => test.info().project.name !== 'lightscaper-software-gpu' && browserName !== 'firefox',
	'Native masked integration requires pinned software Chromium or actual Firefox.');
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
const PROGRAM = '/__lightscaper_masked_context_integration.js', BLANK = '/lightscaper/__masked_context_integration_blank.html';
let compiled;
test.beforeAll(async () => { compiled = await compileNativeImageHandoffScript('masked-context-integration.js', fileURLToPath(new URL('./helpers/lightscaper-native-gpu-masked-context-integration-current-reference.ts', import.meta.url))); expect(compiled.assets).toEqual([]); });
const words = values => [...new Uint32Array(Float32Array.from(values).buffer)];
const rank = word => word >= 0x80000000 ? 0x100000000 - word : 0x80000000 + word;
const effect = (id, type, params, enabled = true) => ({ id, type, params, enabled });
const graph = node => ({ schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], nodes: [node], outputNodeId: 'a' });
const gradient = graph({ id: 'a', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } });
const binding = effectId => ({ maskId: 'mask', effectId });
async function run(page, request) {
	await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: compiled.source }));
	await page.route(`**${BLANK}`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Native masked context integration</title>' }));
	await page.goto(resolveBrowserProductTestUrl(BLANK));
	const value = await page.evaluate(`import(${JSON.stringify(PROGRAM)}).then(module=>module.runMaskedContextIntegrationCurrentV1(${JSON.stringify(request)}))`);
	const browserName = page.context().browser()?.browserType().name();
	if (browserName === 'chromium') { expect(value.renderers.length).toBeGreaterThan(0); for (const renderer of value.renderers) expect(renderer).toContain('SwiftShader'); }
	await test.info().attach('native-masked-context-integration-observation', { body: JSON.stringify({ browser: page.context().browser()?.version(), value }), contentType: 'application/json' });
	return value;
}
function accepted(value, banks = 3) {
	expect(value.privateRetired).toBe(true); expect(value.nativeScratchWiped).toBe(true); expect(value.sourceActiveAtGl).toBe(0);
	expect(value.source).toEqual(value.before); expect(value.readbackBeforeMaskRetired).toBe(false); expect(value.deliveryAfterResources).toBe(true);
	expect(value.imagePeak).toBeLessThanOrEqual(banks); expect(value.actualOverlay).toEqual(value.expectedOverlay);
	const expected = new Float32Array(Uint32Array.from(value.expected).buffer), actual = new Float32Array(Uint32Array.from(value.result).buffer);
	for (let index = 0; index < expected.length; index++) {
		if (index % 4 === 3 || expected[index] === 0 || Math.abs(expected[index]) < 2 ** -60) expect(value.result[index]).toBe(value.expected[index]);
		else { expect(Number.isFinite(actual[index])).toBe(true); expect(Math.abs(rank(value.result[index]) - rank(value.expected[index]))).toBeLessThanOrEqual(8); }
	}
}
test('one graph at two authored tone inputs recomputes native range and rotates a genuine third image bank', async ({ page }) => {
	const value = await run(page, { width: 2, height: 1, words: words([.125, .125, .125, 1, .375, .375, .375, 1]),
		effects: [effect('up', 'tone-ladder-v1', { exposure: 1 }), effect('down', 'tone-ladder-v1', { exposure: -1 })],
		masks: [graph({ id: 'a', kind: 'luminance-range', lower: .25, upper: .5, falloff: 0 })], maskBindings: [binding('up'), binding('down')] });
	accepted(value); expect(value.imagePeak).toBe(3); expect(value.result).toEqual(words([.125, .125, .125, 1, .75, .75, .75, 1]));
});
test('crop before bound tone uses incoming extent and selected coverage follows the later integer quarterturn', async ({ page }) => {
	const value = await run(page, { width: 4, height: 1, words: words([.125, .25, .5, 1, .25, .5, .75, 1, .375, .5, .75, 1, .5, .75, 1, 1]),
		effects: [effect('crop', 'develop-geometry-v1', { cropWidth: .5 }), effect('tone', 'tone-ladder-v1', { exposure: 1 }), effect('rotate', 'develop-geometry-v1', { rotationDegrees: 90 })],
		masks: [gradient], maskBindings: [binding('tone')], selected: binding('tone') });
	accepted(value); expect(value.actualOverlay).toEqual([64, 191]); expect(value.result).toHaveLength(8);
});
test('selected disabled observation preserves hidden native RGB, tiny words and alpha negative zero without candidate', async ({ page }) => {
	const source = words([.125, -0, 1e-30, -0, .25, -0, -1e-30, -0, .5, -0, 1e-30, -0]);
	const value = await run(page, { width: 3, height: 1, words: source, effects: [effect('off', 'tone-ladder-v1', { exposure: 3 }, false)],
		masks: [gradient], maskBindings: [binding('off')], selected: binding('off') });
	accepted(value, 2); expect(value.result).toEqual(source); expect(value.actualOverlay).toEqual([43, 128, 213]);
});
test('partial CA mask preserves exact Green and raw-zero Blue through the actual family finisher', async ({ page }) => {
	const source = words([.25, -0, 1e-30, 1, .5, -.25, -1e-30, 1, .75, .125, 1e-30, 1]);
	const value = await run(page, { width: 3, height: 1, words: source, effects: [effect('ca', 'chromatic-aberration-v1', { red: 50, blue: 0 })], masks: [gradient], maskBindings: [binding('ca')] });
	accepted(value); for (let at = 0; at < source.length; at++) if (at % 4 !== 0) expect(value.result[at]).toBe(source[at]);
});
test('active optical unchanged-component mask retains signed-zero hidden RGB at fractional coverage', async ({ page }) => {
	const source = words([-0, .25, .5, 0, -0, .5, 1, 0, -0, 1, 2, 0]);
	const value = await run(page, { width: 3, height: 1, words: source, effects: [effect('optical', 'optical-vignette-v1', { amount: 100 })], masks: [gradient], maskBindings: [binding('optical')] });
	accepted(value); expect(value.result).toEqual(source);
});
test('active neighborhood candidate runs the actual spatial program before partial masking and two-plane proof', async ({ page }) => {
	const source = words(Array.from({ length: 3 }, () => [.25, .5, .75, 1]).flat());
	const value = await run(page, { width: 3, height: 1, words: source, effects: [effect('clarity', 'clarity-v1', { amount: 50 })], masks: [gradient], maskBindings: [binding('clarity')] });
	accepted(value); expect(value.spatialKinds).toContain(16); expect(value.imagePeak).toBe(3);
});
test('authenticated Double LUT candidate stays ordered before a later native flip and source scope retires before GL', async ({ page }) => {
	const body = new TextEncoder().encode('LUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1');
	const sha256 = createHash('sha256').update(body).digest('hex'), reference = { storageKey: `lut-sha256:${sha256}`, sha256, byteLength: body.length, size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
	const value = await run(page, { width: 2, height: 1, words: words([.125, .25, .5, 1, .75, .5, .25, 1]),
		effects: [effect('lut', 'cube-lut-profile-v1', { lut: reference }), effect('flip', 'develop-geometry-v1', { flipHorizontal: 1 })],
		masks: [graph({ id: 'a', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: .5, height: 1 })], maskBindings: [binding('lut')], lutBody: [...body] });
	accepted(value); expect(value.sourceReads).toBeGreaterThan(0); expect(value.result).toEqual(words([.75, .5, .25, 1, .5, .25, .125, 1]));
});
